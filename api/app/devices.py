"""What the fleet of phones looks like, for the admin view.

A device is judged on two separate things.  Whether it is *working* comes from
every batch it uploaded (`Device`): how recently, how fast it samples, whether
the detector complained.  Whether it is *useful* comes from what it found
(`PotholeDetection`).  A phone on a smooth road is working and finds nothing,
and the two must not be confused.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.detection import PotholeCluster, PotholeDetection
from app.models.device import Device
from app.schemas import BatchResult, DeviceOut, SensorBatch

ACTIVE_WITHIN = timedelta(minutes=5)
IDLE_WITHIN = timedelta(hours=1)


def record_device(session: Session, batch: SensorBatch, result: BatchResult) -> Device:
    """Note that this device uploaded a batch, and what the batch looked like."""
    device = session.scalar(select(Device).where(Device.device_id == batch.device_id))
    if device is None:
        device = Device(device_id=batch.device_id, batch_count=0, sample_count=0)
        session.add(device)
    device.last_trip_id = batch.trip_id
    device.batch_count = (device.batch_count or 0) + 1
    device.sample_count = (device.sample_count or 0) + result.samples
    device.sample_rate_hz = result.effective_rate_hz
    device.warning_count = len(result.warnings)
    device.gps_fix_count = len(batch.gps)
    # onupdate only fires when a column changes, and a repeat of the same batch
    # changes none, so the "last seen" time is set explicitly.
    device.updated_at = datetime.now(UTC)
    return device


Activity = Literal["active", "idle", "offline"]


def as_utc(moment: datetime) -> datetime:
    """SQLite hands timestamps back without a zone. They were stored as UTC, and
    a client reading a bare timestamp would take it for local time."""
    return moment.replace(tzinfo=UTC) if moment.tzinfo is None else moment


def activity(last_seen: datetime, now: datetime | None = None) -> Activity:
    """`active` within minutes, `idle` within the hour, otherwise `offline`."""
    age = (now or datetime.now(UTC)) - as_utc(last_seen)
    if age <= ACTIVE_WITHIN:
        return "active"
    return "idle" if age <= IDLE_WITHIN else "offline"


@dataclass
class DeviceRow:
    device: Device
    detections: int
    clusters: int
    confirmed_clusters: int
    mean_severity: float | None
    max_severity: float | None
    mean_confidence: float | None
    mean_gps_error_m: float | None


def device_rows(session: Session, device_id: str | None = None) -> list[DeviceRow]:
    """Every device (or just `device_id`), most recently seen first, with totals
    over what it found."""
    found = (
        select(
            PotholeDetection.device_id,
            func.count(PotholeDetection.id).label("detections"),
            func.count(func.distinct(PotholeDetection.cluster_id)).label("clusters"),
            func.avg(PotholeDetection.severity).label("mean_severity"),
            func.max(PotholeDetection.severity).label("max_severity"),
            func.avg(PotholeDetection.confidence).label("mean_confidence"),
            func.avg(PotholeDetection.location_error_m).label("mean_gps_error_m"),
        )
        .group_by(PotholeDetection.device_id)
        .subquery()
    )
    confirmed = (
        select(
            PotholeDetection.device_id,
            func.count(func.distinct(PotholeDetection.cluster_id)).label("confirmed"),
        )
        .join(PotholeCluster, PotholeCluster.id == PotholeDetection.cluster_id)
        .where(PotholeCluster.status.in_(("confirmed", "reported")))
        .group_by(PotholeDetection.device_id)
        .subquery()
    )
    stmt = (
        select(
            Device,
            found.c.detections,
            found.c.clusters,
            confirmed.c.confirmed,
            found.c.mean_severity,
            found.c.max_severity,
            found.c.mean_confidence,
            found.c.mean_gps_error_m,
        )
        .outerjoin(found, found.c.device_id == Device.device_id)
        .outerjoin(confirmed, confirmed.c.device_id == Device.device_id)
        .order_by(Device.updated_at.desc())
    )
    if device_id is not None:
        stmt = stmt.where(Device.device_id == device_id)
    return [
        DeviceRow(
            device=row[0],
            detections=row[1] or 0,
            clusters=row[2] or 0,
            confirmed_clusters=row[3] or 0,
            mean_severity=row[4],
            max_severity=row[5],
            mean_confidence=row[6],
            mean_gps_error_m=row[7],
        )
        for row in session.execute(stmt)
    ]


def _round(value: float | None, digits: int) -> float | None:
    return None if value is None else round(value, digits)


def device_out(row: DeviceRow) -> DeviceOut:
    return DeviceOut(
        device_id=row.device.device_id,
        activity=activity(row.device.updated_at),
        first_seen=as_utc(row.device.created_at),
        last_seen=as_utc(row.device.updated_at),
        last_trip_id=row.device.last_trip_id,
        batches=row.device.batch_count,
        samples=row.device.sample_count,
        sample_rate_hz=row.device.sample_rate_hz,
        warnings=row.device.warning_count,
        gps_fixes=row.device.gps_fix_count,
        detections=row.detections,
        clusters=row.clusters,
        confirmed_clusters=row.confirmed_clusters,
        mean_severity=_round(row.mean_severity, 1),
        max_severity=_round(row.max_severity, 1),
        mean_confidence=_round(row.mean_confidence, 3),
        mean_gps_error_m=_round(row.mean_gps_error_m, 1),
    )
