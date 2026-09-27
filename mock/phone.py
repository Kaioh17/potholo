"""Stand in for the React Native app's SensorEventListener.

Only the phone is mocked; everything downstream of these samples is the real
service.  The point of the generator is that its *noise* is not invented: the
ride model is fitted to an instrumented drive recorded on 2024-11-29 with an
MPU6050, digitised in data/analysis/ and kept in data/drive_2024-11-29.csv.

What that drive established, and what is reproduced here:

  * the car's sprung mass resonates at 1.1-1.5 Hz and carries most of the
    vertical energy (74% of the measured 1-4 Hz band power) -- the quarter-car
    model in vehicles.py puts the sedan at 1.25 Hz from its masses and spring
    rates, independently of that measurement
  * background vertical acceleration on ordinary Chicago pavement has a
    standard deviation near 0.20 m/s^2
  * a real device sits at an arbitrary tilt (12.8 deg in that recording) and
    its accelerometer carried ~4% of scale error (|g| read 9.42, not 9.81)

What that drive could *not* establish, and is therefore taken from vehicle
dynamics rather than measurement: the 8-15 Hz wheel-hop resonance where a
pothole strike actually lives.  It logged at 8.34 Hz, so everything above
4.17 Hz was folded back rather than recorded.  That gap is the main reason the
phone app must sample at 100 Hz or better.

The road is a continuous signal and a phone samples it, so everything is built
at FS_INTERNAL and decimated to the requested rate.  Asking for a low rate then
reproduces real aliasing instead of quietly inventing a slower, smoother
pothole that a low rate could represent perfectly well.
"""

from __future__ import annotations

import argparse
import json
import math
import uuid
from dataclasses import dataclass

import numpy as np
from scipy import signal
from vehicles import FLEET, SEDAN, Vehicle

G = 9.80665
FS_INTERNAL = 500.0


# --------------------------------------------------------------------------- #
# What the road does to the vehicle, and what the driver does to the phone


@dataclass
class RoadEvent:
    """A feature in the pavement the wheels pass over."""

    kind: str  # pothole | speed_bump | manhole | joint | rail_crossing
    t: float  # when the FRONT axle reaches it
    depth_m: float = 0.08  # potholes and sunken covers
    height_m: float = 0.08  # bumps and raised lips
    length_m: float = 0.50


@dataclass
class DriverAction:
    """Something the vehicle or the driver does that is not the road."""

    kind: str  # brake | corner | handle_phone | stop
    t: float
    duration_s: float = 2.0
    magnitude: float = 1.0


# --------------------------------------------------------------------------- #
# Waveforms


def _resonator(x: np.ndarray, fs: float, f0: float, zeta: float) -> np.ndarray:
    """Drive a second-order resonance with the road input."""
    w0 = 2 * math.pi * f0
    b, a = signal.bilinear([w0**2], [1, 2 * zeta * w0, w0**2], fs)
    return signal.lfilter(b, a, x)


def road_background(
    n: int,
    fs: float,
    rng: np.random.Generator,
    vehicle: Vehicle = SEDAN,
    roughness: float = 1.0,
) -> np.ndarray:
    """Vertical acceleration of ordinary pavement, at this vehicle's resonances."""
    body = _resonator(rng.standard_normal(n), fs, vehicle.body_hz, vehicle.body_zeta)
    wheel = 0.35 * _resonator(
        rng.standard_normal(n), fs, vehicle.wheel_hz, vehicle.wheel_zeta
    )
    out = body + wheel
    return out * (vehicle.road_std * roughness / (out.std() or 1.0))


def _ring(fs: float, vehicle: Vehicle, peak: float, seconds: float = 0.6) -> np.ndarray:
    """The unsprung mass ringing after it is struck."""
    w = 2 * math.pi * vehicle.wheel_hz
    tt = np.arange(int(round(seconds * fs))) / fs
    r = np.exp(-vehicle.wheel_zeta * w * tt) * np.sin(w * tt)
    return r * (peak / (np.abs(r).max() or 1.0))


def pothole_waveform(
    fs: float, vehicle: Vehicle, speed: float, depth_m: float, length_m: float
) -> np.ndarray:
    """One wheel dropping into a hole and striking the far edge.

    The wheel is unsupported for the time it takes to cross the hole, so it
    falls under gravity; if the hole is deep enough it never reaches the bottom
    and hits the far wall at g*tau.  That strike excites the wheel-hop mode,
    which is the ring that follows.

    How far it can fall is limited by the wheel's own radius, not just by the
    hole -- which is why a truck feels far less of a short pothole than a car.
    """
    reach = vehicle.reachable_depth(length_m, depth_m)
    if reach <= 0.002:
        return np.zeros(1)
    tau = min(length_m / max(speed, 1.0), math.sqrt(2 * reach / G))
    delta_v = G * tau * 1.3  # impact speed plus a little rebound

    n_drop = max(2, int(round(tau * fs)))
    drop = -0.9 * G * np.sin(np.pi * np.arange(n_drop) / n_drop)
    ring = _ring(fs, vehicle, delta_v * (2 * math.pi * vehicle.wheel_hz) / 2.0)
    return np.concatenate([drop, ring]) * vehicle.strike_transfer


def bump_waveform(
    fs: float, vehicle: Vehicle, speed: float, height_m: float, length_m: float
) -> np.ndarray:
    """A speed hump: the wheel is lifted first, then goes light over the crest.

    The mirror image of a pothole, and the single most important thing the
    detector must not report.
    """
    period = max(length_m / max(speed, 1.0), 2.0 / fs)
    n = max(4, int(round(period * fs)))
    peak = height_m * (2 * math.pi / period) ** 2 / 2.0
    peak = min(peak, 3.0 * G)  # the tyre deforms rather than launch
    lift = peak * np.sin(2 * np.pi * np.arange(n) / n)  # up, then down
    ring = _ring(fs, vehicle, 0.3 * peak, seconds=0.4)
    return np.concatenate([lift, ring]) * vehicle.strike_transfer


def joint_waveform(
    fs: float, vehicle: Vehicle, speed: float, height_m: float
) -> np.ndarray:
    """A raised expansion joint or rail lip: a short sharp kick, upward first."""
    peak = min(height_m * (speed**2) * 12.0, 2.5 * G)
    return _ring(fs, vehicle, peak, seconds=0.35) * vehicle.strike_transfer


def _event_waveform(
    ev: RoadEvent, fs: float, vehicle: Vehicle, speed: float
) -> np.ndarray:
    if ev.kind == "pothole":
        return pothole_waveform(fs, vehicle, speed, ev.depth_m, ev.length_m)
    if ev.kind == "speed_bump":
        return bump_waveform(fs, vehicle, speed, ev.height_m, ev.length_m)
    if ev.kind == "manhole":
        # A cover sunk below grade: the same shape as a pothole, much shallower,
        # and deliberately close to the detection boundary.
        return pothole_waveform(fs, vehicle, speed, ev.depth_m, ev.length_m)
    if ev.kind in ("joint", "rail_crossing"):
        return joint_waveform(fs, vehicle, speed, ev.height_m)
    raise ValueError(f"unknown road event: {ev.kind}")


# --------------------------------------------------------------------------- #
# Vehicle path


def _speed_profile(
    n: int, fs: float, base: float, actions: list[DriverAction]
) -> np.ndarray:
    """Base speed, with braking and stops carved out of it."""
    v = np.full(n, float(base))
    for act in actions:
        if act.kind not in ("brake", "stop"):
            continue
        i = int(round(act.t * fs))
        j = min(n, i + int(round(act.duration_s * fs)))
        if i >= n:
            continue
        target = 0.0 if act.kind == "stop" else max(0.0, base - 4.0 * act.magnitude)
        v[i:j] = np.linspace(v[i], target, j - i)
        k = min(n, j + int(round(4.0 * fs)))  # pull away again
        v[j:k] = np.linspace(target, base, k - j)
        v[k:] = base
    return np.clip(v, 0.0, None)


def _rotation(rng: np.random.Generator) -> np.ndarray:
    """A random but fixed phone attitude -- a cupholder, not a lab bench."""
    q = rng.standard_normal(4)
    q /= np.linalg.norm(q)
    w, x, y, z = q
    return np.array(
        [
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
        ]
    )


# --------------------------------------------------------------------------- #
# The simulation


def simulate(
    duration_s: float = 60.0,
    fs: float = 100.0,
    speed: float = 11.0,
    potholes: list[float] | None = None,
    depth_m: float = 0.08,
    length_m: float = 0.5,
    roughness: float = 1.0,
    seed: int = 7,
    start_lat: float = 41.8781,
    start_lon: float = -87.6298,
    heading_deg: float = 90.0,
    route=None,
    scale_error: float = 0.96,
    vehicle: Vehicle = SEDAN,
    events: list[RoadEvent] | None = None,
    actions: list[DriverAction] | None = None,
    gps_accuracy: float = 8.0,
    gps_dropout: tuple[float, float] | None = None,
):
    """Return (imu samples, gps fixes, truth) exactly as the phone would send them."""
    rng = np.random.default_rng(seed)
    actions = list(actions or [])
    events = list(events or [])
    for t0 in potholes or []:  # the simple, older calling style
        events.append(RoadEvent("pothole", t0, depth_m=depth_m, length_m=length_m))

    hi = max(fs, FS_INTERNAL)
    n_hi = int(duration_s * hi)
    vert = road_background(n_hi, hi, rng, vehicle, roughness)
    speed_hi = _speed_profile(n_hi, hi, speed, actions)

    truth: list[dict] = []
    for ev in sorted(events, key=lambda e: e.t):
        i0 = int(round(ev.t * hi))
        v_here = float(speed_hi[min(i0, n_hi - 1)])
        wave = _event_waveform(ev, hi, vehicle, v_here)
        strikes = []
        for delay, gain in vehicle.axle_delays(v_here):
            i = int(round((ev.t + delay) * hi))
            j = min(n_hi, i + len(wave))
            if 0 <= i < n_hi and j > i:
                vert[i:j] += gain * wave[: j - i]
                strikes.append(round(ev.t + delay, 3))
        truth.append(
            {
                "kind": ev.kind,
                "t": ev.t,
                "depth_m": ev.depth_m,
                "length_m": ev.length_m,
                "speed": round(v_here, 2),
                "axle_strikes": strikes,
                "reached_m": round(vehicle.reachable_depth(ev.length_m, ev.depth_m), 4),
            }
        )

    # Lateral and longitudinal motion, plus whatever the driver is doing.
    lat_acc = 0.25 * road_background(n_hi, hi, rng, vehicle, roughness)
    lon_acc = 0.25 * road_background(n_hi, hi, rng, vehicle, roughness)
    lon_acc += np.gradient(speed_hi, 1.0 / hi)
    gyro = rng.standard_normal((n_hi, 3)) * 0.01

    for act in actions:
        i = int(round(act.t * hi))
        j = min(n_hi, i + int(round(act.duration_s * hi)))
        if i >= n_hi or j <= i:
            continue
        if act.kind == "corner":
            lat_acc[i:j] += 3.5 * act.magnitude
            gyro[i:j, 2] += 0.55 * act.magnitude  # yaw
            gyro[i:j, 0] += 0.08 * act.magnitude  # roll into the turn
        elif act.kind == "handle_phone":
            # Picked up and looked at: large, incoherent motion on every axis.
            span = j - i
            vert[i:j] += rng.standard_normal(span) * 4.0 * act.magnitude
            lat_acc[i:j] += rng.standard_normal(span) * 4.0 * act.magnitude
            lon_acc[i:j] += rng.standard_normal(span) * 4.0 * act.magnitude
            gyro[i:j] += rng.standard_normal((span, 3)) * 1.8 * act.magnitude

    for rec in truth:  # a strike also pitches the vehicle
        i = int(round(rec["t"] * hi))
        gyro[i : i + int(0.3 * hi), 1] += 0.15

    world = np.column_stack([lon_acc, lat_acc, vert + G])
    acc = world @ _rotation(rng).T
    acc *= scale_error  # sensor scale error
    acc += rng.standard_normal(acc.shape) * 0.02  # sensor noise

    # Nearest-sample decimation, with no anti-alias filter: a sketch that reads
    # the sensor register once per loop folds high-frequency energy back exactly
    # like this, which is what the 2024-11-29 rig was doing at 8.34 Hz.
    n = int(duration_s * fs)
    idx = np.minimum(np.round(np.arange(n) * (hi / fs)).astype(int), n_hi - 1)
    t = np.arange(n) / fs
    acc, gyro = acc[idx], gyro[idx]

    imu = [
        {
            "t": round(float(tt), 4),
            "ax": round(float(a[0]), 5),
            "ay": round(float(a[1]), 5),
            "az": round(float(a[2]), 5),
            "gx": round(float(g[0]), 5),
            "gy": round(float(g[1]), 5),
            "gz": round(float(g[2]), 5),
        }
        for tt, a, g in zip(t, acc, gyro, strict=True)
    ]

    # GPS follows the same speed profile, so a stop really stops.
    distance = np.concatenate([[0.0], np.cumsum(speed_hi) / hi])
    hdg = math.radians(heading_deg)
    cos_lat = math.cos(math.radians(start_lat))
    gps = []
    for k in range(int(duration_s) + 1):
        if gps_dropout and gps_dropout[0] <= k <= gps_dropout[1]:
            continue
        d = float(distance[min(int(k * hi), len(distance) - 1)])
        if route is not None:
            # Follow a real street polyline (see streets.py) instead of a
            # straight line from the start point.
            lat, lon, heading = route.point_at(d)
        else:
            lat = start_lat + (d * math.cos(hdg)) / 111_320.0
            lon = start_lon + (d * math.sin(hdg)) / (111_320.0 * cos_lat)
            heading = heading_deg
        gps.append(
            {
                "t": float(k),
                "lat": lat,
                "lon": lon,
                "speed": float(
                    max(0.0, speed_hi[min(int(k * hi), n_hi - 1)] + rng.normal(0, 0.3))
                ),
                "accuracy": gps_accuracy,
                "heading": heading,
            }
        )
    return imu, gps, truth


def build_batch(device_id: str | None = None, trip_id: str | None = None, **kw) -> dict:
    imu, gps, truth = simulate(**kw)
    vehicle = kw.get("vehicle", SEDAN)
    return {
        "device_id": device_id or "mock-" + uuid.uuid4().hex[:8],
        "trip_id": trip_id or "trip-" + uuid.uuid4().hex[:8],
        "imu": imu,
        "gps": gps,
        "sample_rate_hint": kw.get("fs", 100.0),
        "_truth": truth,
        "_truth_pothole_times": [r["t"] for r in truth if r["kind"] == "pothole"],
        "_vehicle": vehicle.name,
    }


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="Generate a mock phone sensor batch.")
    p.add_argument("--duration", type=float, default=60.0)
    p.add_argument("--fs", type=float, default=100.0)
    p.add_argument("--speed", type=float, default=11.0)
    p.add_argument("--potholes", type=float, nargs="*", default=[12.0, 31.0, 47.5])
    p.add_argument("--depth", type=float, default=0.08)
    p.add_argument("--vehicle", choices=sorted(FLEET), default="sedan")
    p.add_argument("--seed", type=int, default=7)
    p.add_argument("--out", default="-")
    a = p.parse_args()
    batch = build_batch(
        duration_s=a.duration,
        fs=a.fs,
        speed=a.speed,
        potholes=a.potholes,
        depth_m=a.depth,
        seed=a.seed,
        vehicle=FLEET[a.vehicle],
    )
    text = json.dumps({k: v for k, v in batch.items() if not k.startswith("_")})
    if a.out == "-":
        print(text)
    else:
        with open(a.out, "w") as fh:
            fh.write(text)
        print(f"wrote {a.out}: {len(batch['imu'])} samples from a {a.vehicle}")
