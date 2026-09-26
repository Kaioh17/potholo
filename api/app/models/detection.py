"""Persistent shape of the pothole data.

Three tables, because the interesting quantity needs all three:

  PotholeCluster   a place several vehicles flagged
  PotholeDetection one vehicle's strike, kept so a cluster can be re-scored
                   when the detector is retuned
  ClusterPass      a trip that drove over a cluster, whether or not it hit
                   anything -- the denominator of the hit rate

Without ClusterPass, ranking by detection count just ranks by traffic volume,
and a genuinely broken side street never outranks a busy arterial.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Float, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class PotholeCluster(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "pothole_clusters"

    lat: Mapped[float] = mapped_column(Float)
    lon: Mapped[float] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(16), default="candidate")
    severity: Mapped[float] = mapped_column(Float, default=0.0)
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    detection_count: Mapped[int] = mapped_column(Integer, default=0)
    device_count: Mapped[int] = mapped_column(Integer, default=0)
    pass_count: Mapped[int] = mapped_column(Integer, default=0)
    service_request_id: Mapped[str | None] = mapped_column(String(64), nullable=True)

    detections: Mapped[list[PotholeDetection]] = relationship(
        back_populates="cluster", cascade="all, delete-orphan"
    )
    passes: Mapped[list[ClusterPass]] = relationship(
        back_populates="cluster", cascade="all, delete-orphan"
    )

    # Clusters are always looked up by a small bounding box around a new
    # detection, so the index has to cover both coordinates.
    __table_args__ = (Index("ix_cluster_latlon", "lat", "lon"),)

    @property
    def hit_rate(self) -> float:
        return self.detection_count / self.pass_count if self.pass_count else 0.0


class PotholeDetection(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "pothole_detections"

    cluster_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("pothole_clusters.id", ondelete="CASCADE"), index=True
    )
    device_id: Mapped[str] = mapped_column(String(128), index=True)
    trip_id: Mapped[str] = mapped_column(String(128), index=True)
    t: Mapped[float] = mapped_column(Float)
    lat: Mapped[float] = mapped_column(Float)
    lon: Mapped[float] = mapped_column(Float)
    location_error_m: Mapped[float] = mapped_column(Float)
    severity: Mapped[float] = mapped_column(Float)
    peak_to_peak: Mapped[float] = mapped_column(Float)
    delta_v: Mapped[float] = mapped_column(Float)
    speed: Mapped[float] = mapped_column(Float)
    confidence: Mapped[float] = mapped_column(Float)

    cluster: Mapped[PotholeCluster] = relationship(back_populates="detections")


class ClusterPass(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "cluster_passes"

    cluster_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("pothole_clusters.id", ondelete="CASCADE"), index=True
    )
    trip_id: Mapped[str] = mapped_column(String(128))
    seen_at: Mapped[datetime | None] = mapped_column(nullable=True)

    cluster: Mapped[PotholeCluster] = relationship(back_populates="passes")

    # One row per trip per cluster: a trip that drives over the same hole twice
    # is still one vehicle's worth of evidence.
    __table_args__ = (
        UniqueConstraint("cluster_id", "trip_id", name="uq_cluster_trip"),
    )
