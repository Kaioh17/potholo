"""Wire format for the API.

The field names and units mirror what Android's `SensorEventListener` and
`FusedLocationProvider` hand to the React Native app, so the mock generator and a
real phone produce byte-identical payloads and the API cannot tell them apart.

Units, fixed by the Android sensor API:
  TYPE_ACCELEROMETER -> m/s^2, including gravity
  TYPE_GYROSCOPE     -> rad/s
  Location           -> degrees, speed in m/s, accuracy in m
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class ImuSample(BaseModel):
    """One accelerometer + gyroscope reading."""

    t: float = Field(..., description="Seconds since trip start, monotonic.")
    ax: float
    ay: float
    az: float
    gx: float = 0.0
    gy: float = 0.0
    gz: float = 0.0


class GpsFix(BaseModel):
    """One location update. Phones deliver these ~1 Hz, far slower than the IMU."""

    t: float = Field(
        ..., description="Seconds since trip start, same clock as ImuSample.t"
    )
    lat: float = Field(..., ge=-90, le=90)
    lon: float = Field(..., ge=-180, le=180)
    speed: float = Field(..., ge=0, description="Ground speed, m/s")
    accuracy: float = Field(15.0, gt=0, description="Horizontal 68% error radius, m")
    heading: float | None = Field(None, ge=0, lt=360)


class SensorBatch(BaseModel):
    """A few seconds of a trip, as uploaded by the phone."""

    device_id: str = Field(..., min_length=4, max_length=128)
    trip_id: str = Field(..., min_length=4, max_length=128)
    imu: list[ImuSample] = Field(..., min_length=16)
    gps: list[GpsFix] = Field(default_factory=list)
    sample_rate_hint: float | None = Field(
        None, gt=0, description="Nominal IMU rate the phone requested, Hz."
    )

    @field_validator("imu")
    @classmethod
    def _monotonic(cls, v: list[ImuSample]) -> list[ImuSample]:
        if any(b.t <= a.t for a, b in zip(v, v[1:], strict=False)):
            raise ValueError("imu timestamps must be strictly increasing")
        return v


class Detection(BaseModel):
    """A single suspected road defect from one vehicle on one pass."""

    device_id: str
    trip_id: str
    t: float
    lat: float
    lon: float
    location_error_m: float
    kind: Literal["pothole", "bump", "rough", "rejected"]
    severity: float = Field(..., ge=0, le=100)
    peak_to_peak: float = Field(..., description="m/s^2, band-passed vertical")
    delta_v: float = Field(..., description="Vertical velocity change, m/s")
    speed: float = Field(..., description="Vehicle speed at impact, m/s")
    confidence: float = Field(..., ge=0, le=1)
    reason: str = ""


class BatchResult(BaseModel):
    trip_id: str
    samples: int
    effective_rate_hz: float
    detections: list[Detection]
    warnings: list[str] = Field(default_factory=list)


class ClusterOut(BaseModel):
    """A location that several independent vehicles flagged."""

    cluster_id: str
    lat: float
    lon: float
    radius_m: float
    detections: int
    devices: int
    passes: int
    hit_rate: float
    severity: float
    confidence: float
    status: Literal["candidate", "confirmed", "reported"]
    first_seen: datetime
    last_seen: datetime
    service_request_id: str | None = None


class DeviceOut(BaseModel):
    """One phone in the fleet: is it working, and what has it found."""

    device_id: str
    activity: Literal["active", "idle", "offline"]
    first_seen: datetime
    last_seen: datetime
    last_trip_id: str
    batches: int
    samples: int
    sample_rate_hz: float = Field(
        ..., description="Effective IMU rate of the latest batch"
    )
    warnings: int = Field(..., description="Detector warnings on the latest batch")
    gps_fixes: int = Field(..., description="GPS fixes in the latest batch")
    detections: int
    clusters: int
    confirmed_clusters: int
    mean_severity: float | None = None
    max_severity: float | None = None
    mean_confidence: float | None = None
    mean_gps_error_m: float | None = None
