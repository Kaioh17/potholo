"""Database-backed clustering.

Detections arrive as a stream, so a cluster has to be chosen on contact -- there
is no point at which the whole city could be re-clustered from scratch.  Each
new detection is matched against existing clusters inside a small bounding box,
which the (lat, lon) index makes cheap, and the exact distance test is applied
only to that handful of candidates.
"""

from __future__ import annotations

import math

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.detection.cluster import (
    CLUSTER_RADIUS_M,
    PASS_RADIUS_M,
    cluster_confidence,
    evaluate_status,
)
from app.detection.locate import metres_between
from app.devices import record_device
from app.models.detection import ClusterPass, PotholeCluster, PotholeDetection
from app.schemas import BatchResult, SensorBatch
from app.schemas import Detection as DetectionSchema

DEG_LAT_M = 111_320.0


def _bbox(lat: float, lon: float, radius_m: float):
    dlat = radius_m / DEG_LAT_M
    dlon = radius_m / (DEG_LAT_M * max(math.cos(math.radians(lat)), 1e-6))
    return lat - dlat, lat + dlat, lon - dlon, lon + dlon


def _nearby(
    session: Session, lat: float, lon: float, radius_m: float
) -> list[PotholeCluster]:
    lo_lat, hi_lat, lo_lon, hi_lon = _bbox(lat, lon, radius_m)
    stmt = select(PotholeCluster).where(
        PotholeCluster.lat.between(lo_lat, hi_lat),
        PotholeCluster.lon.between(lo_lon, hi_lon),
    )
    return [
        c
        for c in session.scalars(stmt)
        if metres_between(c.lat, c.lon, lat, lon) <= radius_m
    ]


def refresh(session: Session, cluster: PotholeCluster) -> None:
    """Recompute a cluster's standing from the detections it holds."""
    dets = cluster.detections
    cluster.detection_count = len(dets)
    cluster.device_count = len({d.device_id for d in dets})
    cluster.detecting_trip_count = len({d.trip_id for d in dets})
    cluster.pass_count = max(len(cluster.passes), len({d.trip_id for d in dets}))

    if dets:
        sev = sorted(d.severity for d in dets)
        mid = len(sev) // 2
        cluster.severity = sev[mid] if len(sev) % 2 else (sev[mid - 1] + sev[mid]) / 2
        mean_single = sum(d.confidence for d in dets) / len(dets)
    else:
        cluster.severity, mean_single = 0.0, 0.0

    cluster.confidence = cluster_confidence(
        cluster.device_count, cluster.hit_rate, mean_single
    )
    cluster.status = evaluate_status(
        cluster.device_count, cluster.detection_count, cluster.hit_rate, cluster.status
    )


def _already_recorded(session: Session, det: DetectionSchema) -> bool:
    """Has this exact strike been uploaded before?

    Phones retry failed uploads, so the same batch can arrive twice.  Without
    this check a single device could inflate a cluster's detection count and hit
    rate just by losing signal at the wrong moment -- which is precisely the
    evidence the confirmation thresholds are meant to weigh.
    """
    stmt = select(PotholeDetection).where(
        PotholeDetection.device_id == det.device_id,
        PotholeDetection.trip_id == det.trip_id,
        PotholeDetection.t.between(det.t - 0.5, det.t + 0.5),
    )
    return session.scalar(stmt) is not None


def add_detection(session: Session, det: DetectionSchema) -> PotholeCluster | None:
    if _already_recorded(session, det):
        return None

    candidates = _nearby(session, det.lat, det.lon, CLUSTER_RADIUS_M)
    cluster = min(
        candidates,
        key=lambda c: metres_between(c.lat, c.lon, det.lat, det.lon),
        default=None,
    )
    if cluster is None:
        cluster = PotholeCluster(lat=det.lat, lon=det.lon)
        session.add(cluster)
        session.flush()
    else:
        # Running centroid: every fix carries roughly the same GPS error, so
        # there is nothing to weight the average by.
        n = cluster.detection_count
        cluster.lat = (cluster.lat * n + det.lat) / (n + 1)
        cluster.lon = (cluster.lon * n + det.lon) / (n + 1)

    session.add(
        PotholeDetection(
            cluster_id=cluster.id,
            device_id=det.device_id,
            trip_id=det.trip_id,
            t=det.t,
            lat=det.lat,
            lon=det.lon,
            location_error_m=det.location_error_m,
            severity=det.severity,
            peak_to_peak=det.peak_to_peak,
            delta_v=det.delta_v,
            speed=det.speed,
            confidence=det.confidence,
        )
    )
    session.flush()
    _touch_pass(session, cluster, det.trip_id)
    session.refresh(cluster)
    refresh(session, cluster)
    return cluster


def _touch_pass(session: Session, cluster: PotholeCluster, trip_id: str) -> None:
    exists = session.scalar(
        select(ClusterPass).where(
            ClusterPass.cluster_id == cluster.id, ClusterPass.trip_id == trip_id
        )
    )
    if exists is None:
        session.add(ClusterPass(cluster_id=cluster.id, trip_id=trip_id))
        session.flush()


def record_passes(session: Session, trip_id: str, track: list) -> int:
    """Note every cluster this trip drove over, hit or not.

    This is what stops a busy street from always outranking a broken one: a
    cluster that fifty cars drive over and three report is a much weaker signal
    than one that four cars drive over and three report.
    """
    seen: set = set()
    for fix in track:
        for cluster in _nearby(session, fix.lat, fix.lon, PASS_RADIUS_M):
            if cluster.id in seen:
                continue
            seen.add(cluster.id)
            _touch_pass(session, cluster, trip_id)
    for cluster_id in seen:
        cluster = session.get(PotholeCluster, cluster_id)
        if cluster is not None:
            session.refresh(cluster)
            refresh(session, cluster)
    return len(seen)


def list_clusters(
    session: Session, status: str | None = None, min_confidence: float = 0.0
) -> list[PotholeCluster]:
    stmt = select(PotholeCluster).where(PotholeCluster.confidence >= min_confidence)
    if status:
        stmt = stmt.where(PotholeCluster.status == status)
    rows = list(session.scalars(stmt))
    return sorted(rows, key=lambda c: (-c.confidence, -c.severity))


def store_batch(session: Session, batch: SensorBatch, result: BatchResult) -> None:
    """Persist everything one processed batch contributes. The caller commits.

    The HTTP route and the seed script both go through here, so a seeded
    database is built by exactly the code a phone upload runs.  Anything the
    route learns to record has to land in this function, not next to it.
    """
    # Passes first: a trip that drove past an existing cluster without hitting
    # anything is evidence too, and it has to land before the hit rate is read.
    record_passes(session, batch.trip_id, batch.gps)
    for det in result.detections:
        add_detection(session, det)
    record_device(session, batch, result)
