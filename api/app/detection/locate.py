"""Put an impact on the map.

The IMU runs at 100 Hz and GPS at about 1 Hz, so an impact almost never
coincides with a fix.  Interpolating between the two surrounding fixes is worth
roughly a car length; taking the nearest fix instead can be out by 15 m at
40 mph, which is the difference between two potholes and one.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

EARTH_R = 6_371_000.0
DEFAULT_ACCURACY_M = 15.0


@dataclass
class Located:
    lat: float
    lon: float
    speed: float
    error_m: float


def interpolate(gps: list, t: float) -> Located | None:
    """Position at time `t`, with an honest error bar."""
    if not gps:
        return None
    times = np.array([f.t for f in gps])
    if t <= times[0]:
        f = gps[0]
        gap = times[0] - t
        return Located(f.lat, f.lon, f.speed, f.accuracy + f.speed * gap)
    if t >= times[-1]:
        f = gps[-1]
        gap = t - times[-1]
        return Located(f.lat, f.lon, f.speed, f.accuracy + f.speed * gap)

    j = int(np.searchsorted(times, t))
    a, b = gps[j - 1], gps[j]
    span = b.t - a.t
    w = 0.0 if span <= 0 else (t - a.t) / span
    speed = a.speed + w * (b.speed - a.speed)
    # The interpolation itself is only as good as how far the car moved between
    # fixes, so fold that distance into the error rather than hiding it.
    err = max(a.accuracy, b.accuracy) + 0.5 * speed * span
    return Located(a.lat + w * (b.lat - a.lat), a.lon + w * (b.lon - a.lon), speed, err)


def speed_series(gps: list, t: np.ndarray) -> np.ndarray:
    if not gps:
        return np.zeros_like(t)
    return np.interp(t, [f.t for f in gps], [f.speed for f in gps])


def metres_between(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Equirectangular distance -- exact enough over the tens of metres we cluster."""
    phi = np.radians((lat1 + lat2) / 2.0)
    dx = np.radians(lon2 - lon1) * np.cos(phi) * EARTH_R
    dy = np.radians(lat2 - lat1) * EARTH_R
    return float(np.hypot(dx, dy))
