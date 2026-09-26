"""A record of one synthetic scenario and what the detector made of it.

Seeding the database is also an evaluation run, so the outcome of each scenario
is stored rather than just printed: `expected_potholes` is the label the
scenario asserts, `observed_potholes` is what the real pipeline produced, and
`outcome` compares them.

Scenarios whose right answer is genuinely arguable carry `expected_potholes`
NULL and an outcome of "observed". They are recorded, not scored -- inventing a
label there would only prove the detector agrees with whatever we guessed.
"""

from __future__ import annotations

from sqlalchemy import JSON, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class ScenarioRun(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "scenario_runs"

    name: Mapped[str] = mapped_column(String(64), index=True)
    category: Mapped[str] = mapped_column(String(32), index=True)
    description: Mapped[str] = mapped_column(Text)
    why: Mapped[str] = mapped_column(Text, default="")

    vehicle: Mapped[str] = mapped_column(String(16), index=True)
    speed_ms: Mapped[float] = mapped_column(Float)
    sample_rate_hz: Mapped[float] = mapped_column(Float)
    duration_s: Mapped[float] = mapped_column(Float)
    roughness: Mapped[float] = mapped_column(Float, default=1.0)

    lat: Mapped[float] = mapped_column(Float)
    lon: Mapped[float] = mapped_column(Float)

    expected_potholes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    observed_potholes: Mapped[int] = mapped_column(Integer, default=0)
    outcome: Mapped[str] = mapped_column(String(16), index=True)  # pass|fail|observed

    # Kept as JSON because their shape is a property of the scenario, not of the
    # schema: the ground truth a scenario carries and the detections it produced
    # are for a human reading a failure, not for the service to query.
    truth: Mapped[list] = mapped_column(JSON, default=list)
    detections: Mapped[list] = mapped_column(JSON, default=list)
    warnings: Mapped[list] = mapped_column(JSON, default=list)

    def summary(self) -> str:
        expected = (
            "-" if self.expected_potholes is None else str(self.expected_potholes)
        )
        return (
            f"{self.outcome:<8} {self.name:<26} {self.vehicle:<6} "
            f"expected {expected:>2}  observed {self.observed_potholes:>2}"
        )
