"""What changes when the vehicle changes.

A sedan and a loaded semi disagree about the same pothole: how far the wheel
falls into it, how much of the strike reaches the cab, and how many times the
hole gets hit. These pin the behaviour the synthetic fleet exposed.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "api"))
sys.path.insert(0, str(ROOT / "mock"))

from phone import DriverAction, RoadEvent, build_batch  # noqa: E402
from vehicles import BUS, FLEET, SEDAN, SEMI, SUV  # noqa: E402

from app.pipeline import process_batch  # noqa: E402
from app.schemas import SensorBatch  # noqa: E402


def run(vehicle, events=(), actions=(), speed=11.0, seed=5, **kw):
    raw = build_batch(
        duration_s=40,
        fs=100.0,
        speed=speed,
        vehicle=vehicle,
        events=list(events),
        actions=list(actions),
        seed=seed,
        **kw,
    )
    return process_batch(
        SensorBatch(**{k: v for k, v in raw.items() if not k.startswith("_")})
    )


def hole(depth=0.08, length=0.60, t=20.0):
    return RoadEvent("pothole", t, depth_m=depth, length_m=length)


# --------------------------------------------------------------------------- #
# Quarter-car parameters must stay physical


def test_body_and_wheel_frequencies_are_plausible():
    for v in FLEET.values():
        assert 1.0 <= v.body_hz <= 2.0, f"{v.name} body bounce {v.body_hz:.2f} Hz"
        assert 8.0 <= v.wheel_hz <= 15.0, f"{v.name} wheel hop {v.wheel_hz:.2f} Hz"


def test_sedan_matches_the_measured_drive():
    """The real 2024-11-29 recording peaked at 1.1-1.5 Hz."""
    assert 1.1 <= SEDAN.body_hz <= 1.5


def test_big_wheels_bridge_short_holes():
    short = 0.25
    assert SEMI.reachable_depth(short, 0.08) < SEDAN.reachable_depth(short, 0.08)
    # ...but a long hole swallows any wheel
    assert SEMI.reachable_depth(1.5, 0.08) == pytest.approx(0.08)


# --------------------------------------------------------------------------- #
# Every vehicle finds a real pothole


@pytest.mark.parametrize("name", sorted(FLEET))
def test_every_vehicle_detects_a_real_pothole(name):
    vehicle = FLEET[name]
    speed = 9.0 if name in ("bus", "semi") else 11.0
    result = run(vehicle, events=[hole(depth=0.10, length=0.90)], speed=speed)
    assert len(result.detections) == 1, f"{name} missed it"


@pytest.mark.parametrize("name", sorted(FLEET))
def test_no_vehicle_reports_a_speed_bump(name):
    """A bump lifts the wheel before it drops. The most important rejection."""
    vehicle = FLEET[name]
    speed = 7.0 if name in ("bus", "semi") else 8.0
    result = run(
        vehicle,
        speed=speed,
        events=[RoadEvent("speed_bump", 20.0, height_m=0.09, length_m=3.0)],
    )
    assert result.detections == [], f"{name} reported a speed bump"


@pytest.mark.parametrize("name", sorted(FLEET))
def test_no_vehicle_reports_a_raised_joint(name):
    result = run(
        FLEET[name],
        speed=12.0,
        events=[RoadEvent("joint", t, height_m=0.02) for t in (18.0, 21.0)],
    )
    assert result.detections == [], f"{name} reported an expansion joint"


# --------------------------------------------------------------------------- #
# One hole is one detection, however many axles cross it


def test_five_axles_are_one_pothole():
    """A tractor-trailer must not look like five independent witnesses."""
    assert len(SEMI.axles) == 5
    result = run(SEMI, speed=10.0, events=[hole(depth=0.15, length=1.40)])
    assert len(result.detections) == 1


def test_six_metre_wheelbase_is_one_pothole():
    assert (
        len(run(BUS, speed=9.0, events=[hole(depth=0.10, length=0.90)]).detections) == 1
    )


# --------------------------------------------------------------------------- #
# Severity is vehicle-dependent, and that is a calibration problem


def test_truck_under_rates_the_same_pothole():
    """The measured gap, which a truck-heavy sample would bake into the map.

    A semi's cab sits on its own air suspension and its sprung mass is ten times
    a car's, so the same hole arrives at the phone at roughly half strength.
    Until severity is calibrated per vehicle, this is a known bias and not a
    detector fault -- both vehicles do find the hole.
    """
    car = run(SEDAN, events=[hole()], speed=11.0)
    truck = run(SEMI, events=[hole()], speed=11.0)
    assert car.detections and truck.detections
    ratio = truck.detections[0].delta_v / car.detections[0].delta_v
    assert 0.3 < ratio < 0.8, f"expected roughly half, got {ratio:.2f}"


# --------------------------------------------------------------------------- #
# Driver behaviour is still rejected whatever the vehicle


@pytest.mark.parametrize("name", sorted(FLEET))
def test_phone_handling_is_never_a_pothole(name):
    result = run(
        FLEET[name],
        actions=[DriverAction("handle_phone", 18.0, duration_s=3.0, magnitude=1.3)],
    )
    assert result.detections == [], f"{name} reported the driver's hand"


def test_bus_stopping_at_a_stop_is_not_a_pothole():
    result = run(BUS, speed=9.0, actions=[DriverAction("stop", 15.0, duration_s=3.0)])
    assert result.detections == []


def test_suv_cornering_is_rejected():
    result = run(
        SUV, actions=[DriverAction("corner", 18.0, duration_s=3.0, magnitude=1.2)]
    )
    assert result.detections == []
