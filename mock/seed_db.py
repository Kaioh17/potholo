"""Seed the database with a synthetic fleet, through the real pipeline.

    python mock/seed_db.py --reset

Two things are written:

  1. the scenario catalogue -- every test and edge case in scenarios.py, run
     through the genuine detector and stored in `scenario_runs` with what was
     expected beside what actually happened, so seeding is also an evaluation
  2. a corridor -- ten mixed vehicles plus six clean trips over three potholes
     on one street, which is what produces confirmed clusters for the map

Nothing mock-specific enters the service. Batches are built in exactly the wire
format a phone sends, validated by the same `SensorBatch` schema the HTTP route
uses, and persisted through the same `process_batch` and repository calls, so
swapping these payloads for real phone uploads changes nothing downstream.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "api"))
sys.path.insert(0, str(ROOT / "mock"))

from app.database import SessionLocal, engine  # noqa: E402
from app.models import Base  # noqa: E402
from app.models.detection import (  # noqa: E402
    ClusterPass,
    PotholeCluster,
    PotholeDetection,
)
from app.models.scenario import ScenarioRun  # noqa: E402
from app.pipeline import process_batch  # noqa: E402
from app.repository import add_detection, record_passes  # noqa: E402
from app.schemas import SensorBatch  # noqa: E402
from phone import RoadEvent, build_batch  # noqa: E402
from scenarios import (  # noqa: E402
    CATALOGUE,
    CORRIDOR_CLEAN_TRIPS,
    CORRIDOR_FLEET,
    CORRIDOR_LAT,
    CORRIDOR_LENGTH_M,
    CORRIDOR_LON,
    CORRIDOR_POTHOLES,
)
from vehicles import FLEET  # noqa: E402

RULE = "-" * 78


def to_batch(raw: dict) -> SensorBatch:
    return SensorBatch(**{k: v for k, v in raw.items() if not k.startswith("_")})


def reset(session) -> None:
    """Clear generated data, leaving the schema alone."""
    for model in (ClusterPass, PotholeDetection, PotholeCluster, ScenarioRun):
        session.query(model).delete()
    session.commit()


# --------------------------------------------------------------------------- #


def run_catalogue(session) -> list[ScenarioRun]:
    print(
        f"{RULE}\nScenario catalogue: {len(CATALOGUE)} cases through the real detector"
        f"\n{RULE}"
    )
    runs = []
    for index, sc in enumerate(CATALOGUE):
        lat, lon = sc.location(index)
        raw = build_batch(
            device_id=f"scn-{sc.vehicle.name}-{sc.name}",
            trip_id=f"scn-trip-{sc.name}",
            duration_s=sc.duration_s,
            fs=sc.fs,
            speed=sc.speed,
            roughness=sc.roughness,
            vehicle=sc.vehicle,
            events=sc.events,
            actions=sc.actions,
            gps_accuracy=sc.gps_accuracy,
            gps_dropout=sc.gps_dropout,
            seed=1000 + index,
            start_lat=lat,
            start_lon=lon,
        )
        result = process_batch(to_batch(raw))
        observed = len(result.detections)

        if sc.expect_potholes is None:
            outcome = "observed"
        else:
            outcome = "pass" if observed == sc.expect_potholes else "fail"

        run = ScenarioRun(
            name=sc.name,
            category=sc.category,
            description=sc.description,
            why=sc.why,
            vehicle=sc.vehicle.name,
            speed_ms=sc.speed,
            sample_rate_hz=sc.fs,
            duration_s=sc.duration_s,
            roughness=sc.roughness,
            lat=lat,
            lon=lon,
            expected_potholes=sc.expect_potholes,
            observed_potholes=observed,
            outcome=outcome,
            truth=raw["_truth"],
            warnings=result.warnings,
            detections=[
                {
                    "t": round(d.t, 2),
                    "severity": d.severity,
                    "delta_v": d.delta_v,
                    "confidence": d.confidence,
                    "speed": d.speed,
                    "error_m": d.location_error_m,
                }
                for d in result.detections
            ],
        )
        session.add(run)
        runs.append(run)

        # Catalogue detections are persisted too, so the map shows the edge
        # cases rather than only the tidy corridor.
        record_passes(session, raw["trip_id"], to_batch(raw).gps)
        for det in result.detections:
            add_detection(session, det)
        session.commit()
        print("  " + run.summary())
    return runs


def run_corridor(session) -> None:
    print(
        f"\n{RULE}\nCorridor: {len(CORRIDOR_FLEET)} vehicles plus "
        f"{CORRIDOR_CLEAN_TRIPS} clean trips over {len(CORRIDOR_POTHOLES)} potholes"
        f"\n{RULE}"
    )

    def drive(speed: float) -> tuple[list[RoadEvent], float]:
        """A pothole sits at a fixed place, so when it arrives depends on speed."""
        evs = [
            RoadEvent(
                "pothole",
                p["distance_m"] / speed,
                depth_m=p["depth_m"],
                length_m=p["length_m"],
            )
            for p in CORRIDOR_POTHOLES
        ]
        return evs, CORRIDOR_LENGTH_M / speed + 6.0

    for k, (vehicle, speed) in enumerate(CORRIDOR_FLEET):
        events, duration = drive(speed)
        raw = build_batch(
            device_id=f"fleet-{vehicle.name}-{k:02d}",
            trip_id=f"fleet-trip-{k:02d}",
            duration_s=duration,
            fs=100.0,
            speed=speed,
            vehicle=vehicle,
            events=events,
            seed=2000 + k,
            start_lat=CORRIDOR_LAT,
            start_lon=CORRIDOR_LON,
        )
        batch = to_batch(raw)
        result = process_batch(batch)
        record_passes(session, batch.trip_id, batch.gps)
        for det in result.detections:
            add_detection(session, det)
        session.commit()
        print(
            f"  {vehicle.name:<6} at {speed:4.1f} m/s -> "
            f"{len(result.detections)} detections"
        )

    # Vehicles that drive the same street and hit nothing. Without these the hit
    # rate has no denominator and every busy road looks broken.
    for k in range(CORRIDOR_CLEAN_TRIPS):
        raw = build_batch(
            device_id=f"fleet-clean-{k:02d}",
            trip_id=f"fleet-clean-trip-{k:02d}",
            duration_s=CORRIDOR_LENGTH_M / 11.0 + 6.0,
            fs=100.0,
            speed=11.0,
            events=[],
            seed=3000 + k,
            start_lat=CORRIDOR_LAT,
            start_lon=CORRIDOR_LON,
        )
        batch = to_batch(raw)
        result = process_batch(batch)
        record_passes(session, batch.trip_id, batch.gps)
        for det in result.detections:
            add_detection(session, det)
        session.commit()
    print(f"  {CORRIDOR_CLEAN_TRIPS} clean trips recorded as passes")


# --------------------------------------------------------------------------- #


def report(session, runs: list[ScenarioRun]) -> int:
    scored = [r for r in runs if r.outcome in ("pass", "fail")]
    failed = [r for r in scored if r.outcome == "fail"]
    observed = [r for r in runs if r.outcome == "observed"]

    print(f"\n{RULE}\nResult\n{RULE}")
    print(
        f"  {len(scored) - len(failed)}/{len(scored)} scored scenarios passed, "
        f"{len(observed)} recorded for observation"
    )

    if failed:
        print("\n  Disagreements:")
        for r in failed:
            print(
                f"    {r.name:<26} expected {r.expected_potholes}, "
                f"got {r.observed_potholes}"
            )
            if r.why:
                print(f"      {r.why}")

    if observed:
        print("\n  Observed (no asserted answer):")
        for r in observed:
            print(f"    {r.name:<26} {r.observed_potholes} detections")

    clusters = session.query(PotholeCluster).all()
    confirmed = [c for c in clusters if c.status == "confirmed"]
    print(f"\n  {len(clusters)} clusters, {len(confirmed)} confirmed")
    for c in sorted(confirmed, key=lambda c: -c.confidence):
        print(
            f"    ({c.lat:.5f}, {c.lon:.5f})  {c.detection_count} detections / "
            f"{c.device_count} devices / {c.pass_count} passes "
            f"-> hit rate {c.hit_rate:.0%}, severity {c.severity:.0f}, "
            f"confidence {c.confidence:.2f}"
        )
    return len(failed)


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--reset", action="store_true", help="clear previously seeded rows first"
    )
    p.add_argument("--catalogue-only", action="store_true")
    args = p.parse_args()

    Base.metadata.create_all(engine)
    print("Fleet:")
    for v in FLEET.values():
        print("  " + v.describe())
    print()

    with SessionLocal() as session:
        if args.reset:
            reset(session)
        runs = run_catalogue(session)
        if not args.catalogue_only:
            run_corridor(session)
        return report(session, runs)


if __name__ == "__main__":
    raise SystemExit(0 if main() == 0 else 1)
