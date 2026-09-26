"""Ingest trips, serve cross-checked potholes, prepare CDOT reports.

The phone does no detection of its own.  It streams raw motion and location,
exactly as Android's SensorEventListener delivers it, and every decision is made
here -- so the model can be retuned across the whole fleet without shipping an
app update, and so an old trip can be re-analysed when the thresholds improve.
"""

from __future__ import annotations

import os
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.database import SessionDep
from app.detection import severity as sev
from app.detection.locate import metres_between
from app.models.detection import PotholeCluster
from app.pipeline import process_batch
from app.reporting import chicago311
from app.repository import add_detection, list_clusters, record_passes
from app.schemas import BatchResult, ClusterOut, SensorBatch

router = APIRouter(prefix="/v1", tags=["detection"])


def _to_out(cluster: PotholeCluster) -> ClusterOut:
    dets = cluster.detections
    radius = max(
        (metres_between(cluster.lat, cluster.lon, d.lat, d.lon) for d in dets),
        default=0.0,
    )
    if len(dets) < 2 and dets:
        radius = dets[0].location_error_m
    return ClusterOut(
        cluster_id=str(cluster.id),
        lat=round(cluster.lat, 6),
        lon=round(cluster.lon, 6),
        radius_m=round(radius, 1),
        detections=cluster.detection_count,
        devices=cluster.device_count,
        passes=cluster.pass_count,
        hit_rate=round(cluster.hit_rate, 3),
        severity=round(cluster.severity, 1),
        confidence=cluster.confidence,
        status=cluster.status,
        first_seen=cluster.created_at,
        last_seen=cluster.updated_at,
        service_request_id=cluster.service_request_id,
    )


@router.post("/batches", response_model=BatchResult)
def ingest(
    batch: SensorBatch,
    session: SessionDep,
    z_threshold: Annotated[float | None, Query(ge=2.0, le=20.0)] = None,
) -> BatchResult:
    """Ingest a few seconds of a trip and return what was found in it."""
    try:
        result = process_batch(batch, z_threshold)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    # Passes first: a trip that drove past an existing cluster without hitting
    # anything is evidence too, and it has to land before the hit rate is read.
    record_passes(session, batch.trip_id, batch.gps)
    for det in result.detections:
        add_detection(session, det)
    session.commit()
    return result


@router.get("/clusters", response_model=list[ClusterOut])
def clusters(
    session: SessionDep,
    status: str | None = None,
    min_confidence: Annotated[float, Query(ge=0, le=1)] = 0.0,
) -> list[ClusterOut]:
    """Cross-checked locations, best evidence first."""
    return [_to_out(c) for c in list_clusters(session, status, min_confidence)]


class ReportRequest(BaseModel):
    lane: str = "Traffic Lane"
    alley: bool = False
    confirm: bool = False
    use_production: bool = False


@router.post("/clusters/{cluster_id}/report")
def report(cluster_id: str, body: ReportRequest, session: SessionDep) -> dict:
    """Prepare a CDOT service request for a confirmed cluster.

    A dry run against the City's test endpoint by default.  Filing for real
    needs CHI311_API_KEY in the environment and confirm=true from an operator,
    because each request opens a work order against a real crew's queue.
    """
    import uuid as _uuid

    try:
        cluster = session.get(PotholeCluster, _uuid.UUID(cluster_id))
    except ValueError:
        raise HTTPException(400, "malformed cluster id") from None
    if cluster is None:
        raise HTTPException(404, "unknown cluster")
    if cluster.status == "candidate":
        raise HTTPException(
            409,
            f"cluster not confirmed: {cluster.device_count} devices, "
            f"{cluster.detection_count} detections, hit rate {cluster.hit_rate:.0%}",
        )

    endpoint = chicago311.PRODUCTION if body.use_production else chicago311.TEST
    view = _to_out(cluster)
    request = chicago311.build_request(
        view,
        sev.bucket(cluster.severity),
        lane=body.lane,
        alley=body.alley,
        endpoint=endpoint,
    )
    outcome = chicago311.submit(
        request, api_key=os.environ.get("CHI311_API_KEY"), confirm=body.confirm
    )
    if outcome.get("submitted"):
        cluster.status = "reported"
        cluster.service_request_id = (
            str(outcome.get("response", [{}])[0].get("service_request_id", "")) or None
        )
        session.commit()
    return {
        "cluster_id": cluster_id,
        "endpoint": endpoint,
        "curl": request.as_curl(),
        **outcome,
    }
