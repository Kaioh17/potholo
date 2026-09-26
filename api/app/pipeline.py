"""One batch of phone samples in, located detections out."""

from __future__ import annotations

import numpy as np

from .detection import locate
from .detection import severity as sev
from .detection import signal_ops as so
from .detection.detector import find_events
from .schemas import BatchResult, Detection, SensorBatch


def process_batch(batch: SensorBatch, z_threshold: float | None = None) -> BatchResult:
    t = np.array([s.t for s in batch.imu], dtype=float)
    acc = np.array([[s.ax, s.ay, s.az] for s in batch.imu], dtype=float)
    gyro = np.array([[s.gx, s.gy, s.gz] for s in batch.imu], dtype=float)

    vert = so.to_vertical(t, acc, gyro)
    speed = locate.speed_series(batch.gps, vert.t)
    events, warns = find_events(vert, speed, z_threshold or 6.0)

    detections: list[Detection] = []
    for ev in events:
        if ev.kind in ("rejected", "rough", "bump"):
            continue
        fix = locate.interpolate(batch.gps, ev.t)
        if fix is None:
            continue
        s = sev.severity_index(ev.delta_v, fix.speed)
        detections.append(
            Detection(
                device_id=batch.device_id,
                trip_id=batch.trip_id,
                t=ev.t,
                lat=fix.lat,
                lon=fix.lon,
                location_error_m=round(fix.error_m, 1),
                kind="pothole",
                severity=s,
                peak_to_peak=round(ev.peak_to_peak, 3),
                delta_v=round(ev.delta_v, 4),
                speed=round(fix.speed, 2),
                confidence=sev.detection_confidence(
                    ev.z, ev.drop, ev.hit, ev.features["drop_to_hit_s"], fix.speed
                ),
                reason=sev.bucket(s),
            )
        )

    return BatchResult(
        trip_id=batch.trip_id,
        samples=len(batch.imu),
        effective_rate_hz=round(vert.fs, 2),
        detections=detections,
        warnings=vert.warnings + warns,
    )
