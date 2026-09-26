"""One row per phone that has ever uploaded a batch.

Detections alone cannot describe a fleet: a phone on a smooth road uploads
plenty of data and never produces one, and a phone sampling too slowly to see a
strike looks exactly the same. This table records what every batch looked like,
so the admin view can tell "quiet" from "not working".
"""

from __future__ import annotations

from sqlalchemy import Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class Device(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """`created_at` is the first upload, `updated_at` the latest one."""

    __tablename__ = "devices"

    device_id: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    last_trip_id: Mapped[str] = mapped_column(String(128))
    batch_count: Mapped[int] = mapped_column(Integer, default=0)
    sample_count: Mapped[int] = mapped_column(Integer, default=0)
    # Properties of the most recent batch, since these describe the device now.
    sample_rate_hz: Mapped[float] = mapped_column(Float, default=0.0)
    warning_count: Mapped[int] = mapped_column(Integer, default=0)
    gps_fix_count: Mapped[int] = mapped_column(Integer, default=0)
