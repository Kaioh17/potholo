"""What the detector must get right.

The positive case is easy and not very interesting.  Most of these tests are
about what must *not* be reported, because a pothole map that cries wolf is
worse than no map: a crew sent to a speed bump stops trusting the whole feed.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "api"))
sys.path.insert(0, str(ROOT / "mock"))

from phone import build_batch, simulate  # noqa: E402

from app.detection import signal_ops as so  # noqa: E402
from app.detection.cluster import ClusterIndex  # noqa: E402
from app.pipeline import process_batch  # noqa: E402
from app.schemas import Detection, SensorBatch  # noqa: E402


def to_batch(raw: dict) -> SensorBatch:
    return SensorBatch(**{k: v for k, v in raw.items() if not k.startswith("_")})


def run(**kw):
    raw = build_batch(**kw)
    return process_batch(to_batch(raw)), raw["_truth_pothole_times"]


# --------------------------------------------------------------------------- #
# It finds real potholes


def test_finds_every_injected_pothole():
    result, truth = run(
        duration_s=60,
        fs=100,
        speed=11.0,
        potholes=[12.0, 31.0, 47.5],
        depth_m=0.08,
        seed=7,
    )
    assert len(result.detections) == len(truth)
    for det, t0 in zip(result.detections, truth, strict=True):
        # the strike lands a few tens of ms after the wheel enters the hole
        assert 0.0 <= det.t - t0 <= 0.35


def test_axle_echo_is_one_pothole_not_two():
    """Front and rear wheels hit the same hole; that is one defect."""
    result, _ = run(duration_s=40, fs=100, speed=11.0, potholes=[15.0], seed=3)
    assert len(result.detections) == 1


def test_severity_rises_with_depth():
    shallow, _ = run(
        duration_s=40,
        fs=100,
        speed=11.0,
        potholes=[15.0],
        depth_m=0.02,
        length_m=0.25,
        seed=5,
    )
    deep, _ = run(
        duration_s=40,
        fs=100,
        speed=11.0,
        potholes=[15.0],
        depth_m=0.12,
        length_m=0.9,
        seed=5,
    )
    assert shallow.detections and deep.detections
    assert deep.detections[0].severity > shallow.detections[0].severity


# --------------------------------------------------------------------------- #
# It stays quiet when it should


def test_smooth_road_reports_nothing():
    for seed in range(8):
        result, _ = run(duration_s=60, fs=100, speed=11.0, potholes=[], seed=seed)
        assert result.detections == [], f"false positive on clean road, seed {seed}"


def test_rough_road_is_not_a_pothole_field():
    """Bad pavement should raise the bar, not generate hundreds of reports."""
    result, _ = run(
        duration_s=60, fs=100, speed=11.0, potholes=[], roughness=4.0, seed=11
    )
    assert len(result.detections) == 0


def test_speed_bump_is_not_reported():
    """A bump lifts the wheel first, so the two lobes arrive in the other order."""
    imu, gps, _ = simulate(duration_s=30, fs=100, speed=8.0, potholes=[], seed=4)
    i = int(15.0 * 100)
    w = 2 * np.pi * 11.0
    tt = np.arange(60) / 100.0
    lift = 14.0 * np.exp(-0.15 * w * tt) * np.sin(w * tt)  # positive lobe first
    for k, v in enumerate(lift):
        imu[i + k]["az"] += float(v)
    batch = SensorBatch(device_id="bump-test", trip_id="bump-trip", imu=imu, gps=gps)
    result = process_batch(batch)
    assert all(d.kind != "pothole" for d in result.detections)


def test_stationary_vehicle_is_rejected():
    imu, gps, _ = simulate(duration_s=30, fs=100, speed=0.2, potholes=[10.0], seed=6)
    for fix in gps:
        fix["speed"] = 0.2
    batch = SensorBatch(device_id="parked", trip_id="parked-trip", imu=imu, gps=gps)
    result = process_batch(batch)
    assert result.detections == []


# --------------------------------------------------------------------------- #
# It does not care how the phone is lying


@pytest.mark.parametrize("seed", [1, 2, 3, 4, 5])
def test_detection_survives_arbitrary_phone_orientation(seed):
    """Each seed draws a different random attitude for the phone."""
    result, truth = run(duration_s=40, fs=100, speed=11.0, potholes=[15.0], seed=seed)
    assert len(result.detections) == 1, f"orientation seed {seed} lost the pothole"


def test_scale_error_is_corrected_from_measured_gravity():
    raw = build_batch(duration_s=30, fs=100, potholes=[], scale_error=0.90, seed=2)
    batch = to_batch(raw)
    t = np.array([s.t for s in batch.imu])
    acc = np.array([[s.ax, s.ay, s.az] for s in batch.imu])
    vert = so.to_vertical(t, acc)
    assert vert.scale == pytest.approx(1 / 0.90, rel=0.02)


# --------------------------------------------------------------------------- #
# Low sample rates are called out rather than silently degraded


def test_low_rate_warns_about_aliasing():
    """The 8.34 Hz Arduino rig cannot see a strike; the API must say so."""
    result, _ = run(duration_s=60, fs=8.34, speed=11.0, potholes=[20.0], seed=1)
    assert any("Nyquist" in w for w in result.warnings)


# --------------------------------------------------------------------------- #
# Confirmation across vehicles


def _det(lat, lon, device, trip, sev=60.0):
    return Detection(
        device_id=device,
        trip_id=trip,
        t=1.0,
        lat=lat,
        lon=lon,
        location_error_m=8.0,
        kind="pothole",
        severity=sev,
        peak_to_peak=20.0,
        delta_v=0.5,
        speed=11.0,
        confidence=0.8,
    )


def test_one_vehicle_is_never_enough():
    idx = ClusterIndex()
    for k in range(6):
        idx.add(_det(41.8781, -87.6298, "device-A", f"trip-{k}"))
    assert all(c.status == "candidate" for c in idx.clusters.values())


def test_independent_vehicles_confirm():
    idx = ClusterIndex()
    for k in range(4):
        idx.add(_det(41.8781 + k * 1e-6, -87.6298, f"device-{k}", f"trip-{k}"))
    assert any(c.status == "confirmed" for c in idx.clusters.values())


def test_hit_rate_falls_when_most_cars_pass_cleanly():
    """Many passes with few detections means the road is fine."""
    idx = ClusterIndex()
    for k in range(4):
        idx.add(_det(41.8781, -87.6298, f"device-{k}", f"trip-{k}"))
    cluster = next(iter(idx.clusters.values()))
    assert cluster.status == "confirmed"

    class Fix:
        lat, lon = 41.8781, -87.6298

    for k in range(50):
        idx.record_pass(f"clean-trip-{k}", [Fix()])
    assert cluster.hit_rate < 0.35
    assert cluster.status == "candidate"


def test_far_apart_detections_do_not_merge():
    idx = ClusterIndex()
    idx.add(_det(41.8781, -87.6298, "a", "t1"))
    idx.add(_det(41.8791, -87.6298, "b", "t2"))  # ~110 m north
    assert len(idx.clusters) == 2
