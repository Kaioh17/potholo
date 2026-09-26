"""Stand in for the React Native app's SensorEventListener.

Only the phone is mocked; everything downstream of these samples is the real
service.  The point of the generator is that its *noise* is not invented: the
ride model below is fitted to an instrumented drive recorded on 2024-11-29 with
an MPU6050, digitised in data/analysis/ and kept in data/drive_2024-11-29.csv.

What that drive established, and what is reproduced here:

  * the car's sprung mass resonates at 1.1-1.5 Hz and carries most of the
    vertical energy (74% of the measured 1-4 Hz band power)
  * background vertical acceleration on ordinary Chicago pavement has a
    standard deviation near 0.20 m/s^2
  * a real device sits at an arbitrary tilt (12.8 deg in that recording) and
    its accelerometer carried ~4% of scale error (|g| read 9.42, not 9.81)

What that drive could *not* establish, and is therefore taken from vehicle
dynamics rather than measurement: the 8-15 Hz wheel-hop resonance where a
pothole strike actually lives.  It logged at 8.34 Hz, so everything above
4.17 Hz was folded back rather than recorded.  That gap is the main reason the
phone app must sample at 100 Hz or better.
"""
from __future__ import annotations

import argparse
import json
import math
import uuid

import numpy as np
from scipy import signal

G = 9.80665
BODY_HZ, BODY_ZETA = 1.3, 0.35          # sprung mass, measured
WHEEL_HZ, WHEEL_ZETA = 11.0, 0.15       # unsprung mass, from vehicle dynamics
ROAD_STD = 0.20                          # m/s^2, measured
WHEELBASE_M = 2.75

# The road is a continuous signal; a phone samples it.  Everything is therefore
# built at this rate and then decimated to the requested one, so that asking for
# a low rate reproduces real aliasing instead of quietly inventing a slower,
# smoother pothole that a low rate could represent perfectly well.
FS_INTERNAL = 500.0


def _resonator(x: np.ndarray, fs: float, f0: float, zeta: float) -> np.ndarray:
    """Drive a second-order resonance with the road input."""
    w0 = 2 * math.pi * f0
    b, a = signal.bilinear([w0 ** 2], [1, 2 * zeta * w0, w0 ** 2], fs)
    return signal.lfilter(b, a, x)


def road_background(n: int, fs: float, rng: np.random.Generator,
                    roughness: float = 1.0) -> np.ndarray:
    """Vertical acceleration of ordinary pavement, shaped to the measured spectrum."""
    drive = rng.standard_normal(n)
    body = _resonator(drive, fs, BODY_HZ, BODY_ZETA)
    wheel = 0.35 * _resonator(rng.standard_normal(n), fs, WHEEL_HZ, WHEEL_ZETA)
    out = body + wheel
    out *= ROAD_STD * roughness / (out.std() or 1.0)
    return out


def pothole_waveform(fs: float, speed: float, depth_m: float, length_m: float) -> np.ndarray:
    """One wheel dropping into a hole and striking the far edge.

    The wheel is unsupported for the time it takes to cross the hole, so it
    falls under gravity; if the hole is deep enough it never reaches the bottom
    and hits the far wall at g*tau.  That strike excites the wheel-hop mode,
    which is the ring that follows.
    """
    tau = min(length_m / max(speed, 1.0), math.sqrt(2 * depth_m / G))
    impact_v = G * tau                       # vertical speed at the strike, m/s
    delta_v = impact_v * 1.3                 # plus a little rebound

    n_drop = max(2, int(round(tau * fs)))
    drop = -0.9 * G * np.sin(np.pi * np.arange(n_drop) / n_drop)

    w = 2 * math.pi * WHEEL_HZ
    n_ring = int(round(0.6 * fs))
    tt = np.arange(n_ring) / fs
    ring = np.exp(-WHEEL_ZETA * w * tt) * np.sin(w * tt)
    ring *= (delta_v * w / 2.0) / (np.abs(ring).max() or 1.0)
    return np.concatenate([drop, ring])


def _rotation(rng: np.random.Generator) -> np.ndarray:
    """A random but fixed phone attitude -- a cupholder, not a lab bench."""
    q = rng.standard_normal(4)
    q /= np.linalg.norm(q)
    w, x, y, z = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])


def simulate(duration_s: float = 60.0, fs: float = 100.0, speed: float = 11.0,
             potholes: list[float] | None = None, depth_m: float = 0.08,
             length_m: float = 0.5, roughness: float = 1.0, seed: int = 7,
             start_lat: float = 41.8781, start_lon: float = -87.6298,
             heading_deg: float = 90.0, scale_error: float = 0.96):
    """Return (imu samples, gps fixes, truth) exactly as the phone would send them."""
    rng = np.random.default_rng(seed)
    hi = max(fs, FS_INTERNAL)
    n_hi = int(duration_s * hi)
    vert = road_background(n_hi, hi, rng, roughness)

    truth = []
    for t0 in potholes or []:
        wave = pothole_waveform(hi, speed, depth_m, length_m)
        for axle, gain in ((0.0, 1.0), (WHEELBASE_M / max(speed, 1.0), 0.75)):
            i = int(round((t0 + axle) * hi))
            j = min(n_hi, i + len(wave))
            if 0 <= i < n_hi:
                vert[i:j] += gain * wave[: j - i]
        truth.append(t0)

    # Body frame: vertical plus small lateral/longitudinal motion, then gravity,
    # then rotate into the phone's arbitrary attitude.
    lat_acc = 0.25 * road_background(n_hi, hi, rng, roughness)
    lon_acc = 0.25 * road_background(n_hi, hi, rng, roughness)
    world = np.column_stack([lon_acc, lat_acc, vert + G])
    R = _rotation(rng)
    acc = world @ R.T
    acc *= scale_error                                   # sensor scale error
    acc += rng.standard_normal(acc.shape) * 0.02         # sensor noise

    gyro = rng.standard_normal((n_hi, 3)) * 0.01
    for t0 in truth:                                     # a strike also pitches the car
        i = int(round(t0 * hi))
        gyro[i:i + int(0.3 * hi), 1] += 0.15

    # Nearest-sample decimation, with no anti-alias filter: a sketch that reads
    # the sensor register once per loop folds high-frequency energy back exactly
    # like this, which is what the 2024-11-29 rig was doing at 8.34 Hz.
    n = int(duration_s * fs)
    idx = np.minimum(np.round(np.arange(n) * (hi / fs)).astype(int), n_hi - 1)
    t = np.arange(n) / fs
    acc, gyro = acc[idx], gyro[idx]

    imu = [{"t": round(float(tt), 4), "ax": round(float(a[0]), 5),
            "ay": round(float(a[1]), 5), "az": round(float(a[2]), 5),
            "gx": round(float(g[0]), 5), "gy": round(float(g[1]), 5),
            "gz": round(float(g[2]), 5)} for tt, a, g in zip(t, acc, gyro)]

    gps = []
    hdg = math.radians(heading_deg)
    for k in range(int(duration_s) + 1):
        d = speed * k
        gps.append({
            "t": float(k),
            "lat": start_lat + (d * math.cos(hdg)) / 111_320.0,
            "lon": start_lon + (d * math.sin(hdg)) / (111_320.0 * math.cos(math.radians(start_lat))),
            "speed": speed + float(rng.normal(0, 0.3)),
            "accuracy": 8.0,
            "heading": heading_deg,
        })
    return imu, gps, truth


def build_batch(device_id: str | None = None, trip_id: str | None = None, **kw) -> dict:
    imu, gps, truth = simulate(**kw)
    return {
        "device_id": device_id or "mock-" + uuid.uuid4().hex[:8],
        "trip_id": trip_id or "trip-" + uuid.uuid4().hex[:8],
        "imu": imu, "gps": gps, "sample_rate_hint": kw.get("fs", 100.0),
        "_truth_pothole_times": truth,
    }


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="Generate a mock phone sensor batch.")
    p.add_argument("--duration", type=float, default=60.0)
    p.add_argument("--fs", type=float, default=100.0)
    p.add_argument("--speed", type=float, default=11.0)
    p.add_argument("--potholes", type=float, nargs="*", default=[12.0, 31.0, 47.5])
    p.add_argument("--depth", type=float, default=0.08)
    p.add_argument("--seed", type=int, default=7)
    p.add_argument("--out", default="-")
    a = p.parse_args()
    batch = build_batch(duration_s=a.duration, fs=a.fs, speed=a.speed,
                        potholes=a.potholes, depth_m=a.depth, seed=a.seed)
    text = json.dumps(batch)
    if a.out == "-":
        print(text)
    else:
        with open(a.out, "w") as fh:
            fh.write(text)
        print("wrote " + a.out + ": " + str(len(batch["imu"])) + " samples")
