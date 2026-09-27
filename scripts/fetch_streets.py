"""Fetch real Chicago street centre lines from OpenStreetMap into mock/streets.json.

    python scripts/fetch_streets.py

The mock phones drive along these lines so that the pins on the map sit on real
streets. The output is committed, so seeding never needs the network; run this
only to change the street list. Data (c) OpenStreetMap contributors, ODbL.
"""

from __future__ import annotations

import json
import math
import re
import statistics
import urllib.parse
import urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "mock" / "streets.json"

# East-west streets across the Loop, West Loop and River North.
STREETS = [
    "Roosevelt Road", "Polk Street", "Harrison Street", "Van Buren Street",
    "Jackson Boulevard", "Adams Street", "Monroe Street", "Madison Street",
    "Randolph Street", "Lake Street", "Kinzie Street",
    "Hubbard Street", "Grand Avenue", "Ohio Street", "Erie Street",
    "Superior Street", "Chicago Avenue",
]
BBOX = (41.865, -87.670, 41.900, -87.624)  # south, west, north, east
STEP_M = 20.0
M_LAT = 111_320.0


def fetch() -> list[dict]:
    names = "|".join(re.escape(s) for s in STREETS)
    query = (
        '[out:json][timeout:90];way["highway"~"^(primary|secondary|tertiary|residential)$"]'
        f'["name"~"^(West|East) ({names})$"]({",".join(map(str, BBOX))});out geom;'
    )
    req = urllib.request.Request(
        "https://overpass-api.de/api/interpreter",
        data=urllib.parse.urlencode({"data": query}).encode(),
        headers={"User-Agent": "potholo-dev"},
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)["elements"]


def centre_line(ways: list[list[dict]]) -> list[list[float]]:
    """West to east polyline, one point per STEP_M, the median of nearby nodes.

    Binning by distance east and taking the median latitude collapses the two
    carriageways of a divided street into one line and ignores stray nodes.
    """
    cos = math.cos(math.radians(41.88))
    nodes = [(p["lon"], p["lat"]) for w in ways for p in w]
    west = min(x for x, _ in nodes)
    bins: dict[int, list[tuple[float, float]]] = {}
    for x, y in nodes:
        bins.setdefault(int((x - west) * M_LAT * cos // STEP_M), []).append((x, y))
    line = []
    for k in sorted(bins):
        xs, ys = zip(*bins[k], strict=True)
        line.append([round(statistics.median(ys), 6), round(statistics.median(xs), 6)])
    return line


def main() -> None:
    by_name: dict[str, list[list[dict]]] = {}
    for e in fetch():
        if "geometry" in e:
            key = re.sub(r"^(West|East) ", "", e["tags"]["name"])
            by_name.setdefault(key, []).append(e["geometry"])
    streets = {name: centre_line(ways) for name, ways in sorted(by_name.items())}
    OUT.write_text(json.dumps(streets, separators=(",", ":")) + "\n")
    for name, line in streets.items():
        print(f"{name:20} {len(line):4} points")


if __name__ == "__main__":
    main()
