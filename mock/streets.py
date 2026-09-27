"""Real Chicago streets for the mock phones to drive along.

`streets.json` holds centre lines from OpenStreetMap (see
`scripts/fetch_streets.py`). A `Route` is a stretch of one of them, so a
simulated phone reports GPS fixes that sit on a real street and the pins on the
admin map land where a pothole could actually be.

This is mock sensor data only: the API still just receives lat/lon fixes, the
same as it would from a real phone.
"""

from __future__ import annotations

import bisect
import json
import math
from pathlib import Path

M_LAT = 111_320.0

_LINES: dict[str, list[list[float]]] = json.loads(
    (Path(__file__).with_name("streets.json")).read_text()
)

# East-west streets from south to north. Trips run west to east.
STREET_NAMES = sorted(_LINES, key=lambda n: _LINES[n][0][0])

# Three stretches per street, far enough apart that no two share a pothole.
# A trip is under a kilometre long.
SECTION_START_M = (200.0, 1300.0, 2400.0)


class Route:
    """A point that moves along a street polyline, west to east."""

    def __init__(self, street: str, start_m: float):
        line = _LINES[street]
        self.street = street
        mid_lat = line[0][0]
        self._m_lon = M_LAT * math.cos(math.radians(mid_lat))
        self._xy = [(lon * self._m_lon, lat * M_LAT) for lat, lon in line]
        self._cum = [0.0]
        for a, b in zip(self._xy, self._xy[1:], strict=False):
            self._cum.append(self._cum[-1] + math.dist(a, b))
        self.start_m = start_m

    def point_at(self, d: float) -> tuple[float, float, float]:
        """(lat, lon, heading in degrees) after driving `d` metres."""
        s = self.start_m + d
        i = min(max(bisect.bisect_right(self._cum, s) - 1, 0), len(self._xy) - 2)
        (x0, y0), (x1, y1) = self._xy[i], self._xy[i + 1]
        seg = self._cum[i + 1] - self._cum[i] or 1.0
        t = (s - self._cum[i]) / seg  # may pass 1 past the last node: carry straight on
        x, y = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
        heading = math.degrees(math.atan2(x1 - x0, y1 - y0)) % 360
        return y / M_LAT, x / self._m_lon, heading


def route_for(slot: int, section: int = 0) -> Route:
    """The `slot`-th street, cycling through the list, on the given section."""
    street = STREET_NAMES[slot % len(STREET_NAMES)]
    return Route(street, SECTION_START_M[section % len(SECTION_START_M)])
