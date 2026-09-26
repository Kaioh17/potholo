"""Evidence that the detector works, and evidence for the 100 Hz requirement.

Run from the repository root:

    python data/analysis/validate.py

Three things are measured:

  1. what the detector does on the real 2024-11-29 drive, at the 8.34 Hz the
     Arduino rig actually logged
  2. how the detection rate collapses as the sample rate falls
  3. detection and false-positive rates over a sweep of depths, speeds,
     roughness levels and phone orientations
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "api"))
sys.path.insert(0, str(ROOT / "mock"))

from app.detection import signal_ops as so  # noqa: E402
from app.detection.detector import find_events  # noqa: E402
from app.pipeline import process_batch  # noqa: E402
from app.schemas import SensorBatch  # noqa: E402
from phone import build_batch  # noqa: E402

DRIVE = ROOT / "data" / "drive_2024-11-29.csv"
RULE = "-" * 74


def section(title: str) -> None:
    print(f"\n{RULE}\n{title}\n{RULE}")


def real_drive() -> None:
    section("1. The real drive (2024-11-29, MPU6050 at 8.34 Hz)")
    df = pd.read_csv(DRIVE)
    acc = df[["ax", "ay", "az"]].interpolate(limit_direction="both").to_numpy()
    gyro = df[["gx", "gy", "gz"]].interpolate(limit_direction="both").to_numpy()
    t = df["t"].to_numpy()

    vert = so.to_vertical(t, acc, gyro)
    print(
        f"  {len(df)} samples over {t[-1]:.0f}s at {vert.fs:.2f} Hz "
        f"(dt {1000 / vert.fs:.1f} ms)"
    )
    print(
        f"  resting |g| = {np.median(vert.g_mag):.3f} m/s2 "
        f"-> scale correction x{vert.scale:.4f}"
    )
    print(
        f"  vertical acceleration: std {vert.a_vert.std():.3f}, "
        f"range {vert.a_vert.min():.2f} to {vert.a_vert.max():.2f} m/s2"
    )

    # 30 mph is a fair guess for this drive; no GPS was logged alongside it.
    speed = np.full(len(vert.t), 11.0)
    events, warnings = find_events(vert, speed)
    for w in warnings:
        print(f"  WARNING: {w}")
    kinds = pd.Series([e.kind for e in events]).value_counts().to_dict()
    print(f"  candidate shocks: {len(events)} -> {kinds}")
    for e in [e for e in events if e.kind == "pothole"][:5]:
        print(
            f"    t={e.t:7.1f}s  drop {e.drop:+.2f}  strike {e.hit:+.2f}  "
            f"dv {e.delta_v:.3f} m/s"
        )


def rate_sweep() -> None:
    section("2. Why the phone has to sample at 100 Hz")
    print("  One 8 cm pothole at 11 m/s, identical otherwise, at each rate:\n")
    print(f"  {'rate':>8} {'found':>6} {'severity':>9} {'dv (m/s)':>9}  note")
    for fs in (200.0, 100.0, 50.0, 25.0, 12.5, 8.34):
        raw = build_batch(
            duration_s=40, fs=fs, speed=11.0, potholes=[15.0], depth_m=0.08, seed=7
        )
        batch = SensorBatch(**{k: v for k, v in raw.items() if not k.startswith("_")})
        res = process_batch(batch)
        found = len(res.detections)
        sev = res.detections[0].severity if found else 0.0
        dv = res.detections[0].delta_v if found else 0.0
        note = "aliased" if any("Nyquist" in w for w in res.warnings) else ""
        print(f"  {fs:>7.1f}H {found:>6} {sev:>9.1f} {dv:>9.3f}  {note}")
    print("\n  The strike rings the unsprung mass at 8-15 Hz. Once Nyquist drops")
    print("  below that, the peak is folded back rather than measured, and the")
    print("  severity reads low even though the pothole is identical.")


def sweep() -> None:
    section("3. Detection and false-positive rates")
    rows = []
    for depth, length, label in (
        (0.03, 0.25, "shallow"),
        (0.06, 0.45, "moderate"),
        (0.10, 0.80, "deep"),
    ):
        for speed in (7.0, 11.0, 16.0):
            hits = 0
            trials = 8
            for seed in range(trials):
                raw = build_batch(
                    duration_s=40,
                    fs=100.0,
                    speed=speed,
                    potholes=[15.0],
                    depth_m=depth,
                    length_m=length,
                    seed=seed,
                )
                b = SensorBatch(
                    **{k: v for k, v in raw.items() if not k.startswith("_")}
                )
                hits += len(process_batch(b).detections) > 0
            rows.append((label, speed, hits / trials))
    print(
        f"  {'pothole':>9} {'speed':>7} {'detected':>9}"
        "   (8 random phone orientations each)"
    )
    for label, speed, rate in rows:
        print(f"  {label:>9} {speed:>6.0f}m/s {rate:>8.0%}")

    print("\n  False positives on roads with no pothole at all:")
    for rough, name in ((1.0, "ordinary"), (2.5, "poor"), (4.0, "very poor")):
        false = 0
        km = 0.0
        for seed in range(12):
            raw = build_batch(
                duration_s=60.0,
                fs=100.0,
                speed=11.0,
                potholes=[],
                roughness=rough,
                seed=seed,
            )
            b = SensorBatch(**{k: v for k, v in raw.items() if not k.startswith("_")})
            false += len(process_batch(b).detections)
            km += 60.0 * 11.0 / 1000.0
        print(f"  {name:>10} pavement: {false} false positives over {km:.1f} km")


if __name__ == "__main__":
    real_drive()
    rate_sweep()
    sweep()
    print()
