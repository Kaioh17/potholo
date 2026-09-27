"""Real street geometry for the few blocks around Union Station.

    python data/analysis/fetch_downtown_streets.py

The forecast map had no basemap, so its potholes floated on an empty grid and
the viewer had to take "Chicago" on trust. Chicago publishes its own street
centrelines, so the map can show the actual streets instead of a decorative
grid -- and the synthetic potholes can then be placed *on* those streets rather
than scattered near them.

The window is deliberately small: about 1.5 km by 1.4 km around Chicago Union
Station, which is where the project's real corridor detections sit. A map of the
whole city at this size is a cloud of dots; a few blocks of the West Loop is a
place you can recognise.

Writes `web/src/forecast/streets.js`, which is committed -- it is a few hundred
kilobytes of public geometry that does not change, and having the map work
offline at demo time is worth more than the bytes.
"""
from __future__ import annotations

import json
import math
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parent.parent / "web" / "src" / "forecast" / "streets.js"

# Chicago Union Station, 225 S Canal St.
UNION_STATION = (41.8789, -87.6397)

# The drawn window, deliberately wide and short: about 930 m north-south by
# 3.2 km east-west, a 3.45:1 strip. The map is a wide panel, and a square window
# inside it would leave two thirds of the frame empty and shrink the streets to
# a stamp in the middle. This strip runs from Halsted across the river and into
# the Loop, with Union Station near its centre.
NORTH, SOUTH = 41.8832, 41.8748
WEST, EAST = -87.6590, -87.6200

# Chicago's street class: 1 expressway, 2 arterial, 3 collector, 4 local,
# 5 alley, 9 ramp. Alleys and ramps are dropped -- they triple the geometry and
# nobody navigates by them.
KEEP_CLASSES = {"1", "2", "3", "4"}

SIMPLIFY_M = 6.0  # drop points closer together than this
M_PER_DEG_LAT = 111_320.0


def fetch() -> list[dict]:
    query = urllib.parse.urlencode(
        {
            "$select": "street_nam,street_typ,pre_dir,class,the_geom",
            "$where": f"within_box(the_geom, {NORTH}, {WEST}, {SOUTH}, {EAST})",
            "$limit": "6000",
        },
        safe="(),*:'",
    )
    url = f"https://data.cityofchicago.org/resource/pr57-gg9e.json?{query}"
    print("fetching street centrelines ...", flush=True)
    request = urllib.request.Request(url, headers={"User-Agent": "potholo-research/1.0"})
    with urllib.request.urlopen(request, timeout=180) as response:
        return json.load(response)


def simplify(points: list[list[float]], lat0: float) -> list[list[float]]:
    """Drop points that add less than `SIMPLIFY_M` of detail.

    Street centrelines carry survey-grade vertices; at the zoom this map draws,
    anything finer than a few metres is invisible and costs bytes.
    """
    if len(points) < 3:
        return points
    m_lon = M_PER_DEG_LAT * math.cos(math.radians(lat0))
    kept = [points[0]]
    for lon, lat in points[1:-1]:
        plon, plat = kept[-1]
        dx = (lon - plon) * m_lon
        dy = (lat - plat) * M_PER_DEG_LAT
        if dx * dx + dy * dy >= SIMPLIFY_M * SIMPLIFY_M:
            kept.append([lon, lat])
    kept.append(points[-1])
    return kept


def clip(points: list[list[float]]) -> bool:
    """Keep a segment if any part of it is inside the window."""
    return any(WEST <= lon <= EAST and SOUTH <= lat <= NORTH for lon, lat in points)


def main() -> None:
    raw = fetch()
    print(f"segments returned              {len(raw):>7,}")

    lat0 = (NORTH + SOUTH) / 2
    streets: list[dict] = []
    skipped = 0
    for row in raw:
        cls = str(row.get("class", ""))
        if cls not in KEEP_CLASSES:
            skipped += 1
            continue
        geom = row.get("the_geom") or {}
        lines = geom.get("coordinates") or []
        if geom.get("type") == "LineString":
            lines = [lines]
        name = " ".join(
            part
            for part in (row.get("pre_dir"), row.get("street_nam"), row.get("street_typ"))
            if part
        ).title()
        for line in lines:
            pts = [[round(float(x), 6), round(float(y), 6)] for x, y in line]
            if len(pts) < 2 or not clip(pts):
                continue
            streets.append({"n": name, "c": int(cls), "p": simplify(pts, lat0)})

    print(f"alleys and ramps dropped       {skipped:>7,}")
    print(f"segments kept                  {len(streets):>7,}")
    points = sum(len(s["p"]) for s in streets)
    print(f"points after simplifying       {points:>7,}")

    by_class: dict[int, int] = {}
    for s in streets:
        by_class[s["c"]] = by_class.get(s["c"], 0) + 1
    print("by class:", ", ".join(f"{k}: {v}" for k, v in sorted(by_class.items())))

    named = sorted({s["n"] for s in streets if s["n"]})
    print(f"named streets                  {len(named):>7,}")
    print("  e.g.", ", ".join(named[:8]))

    payload = {
        "source": "Chicago Street Center Lines (Socrata pr57-gg9e), public domain",
        "bounds": {"north": NORTH, "south": SOUTH, "east": EAST, "west": WEST},
        "landmarks": [
            {"name": "Union Station", "lat": UNION_STATION[0], "lon": UNION_STATION[1]},
        ],
        "streets": streets,
    }
    banner = (
        "// Generated by data/analysis/fetch_downtown_streets.py -- do not edit by hand.\n"
        "// Real street centrelines around Chicago Union Station, from the city's\n"
        "// own open data. Public domain.\n\n"
    )
    OUT.write_text(banner + "export default " + json.dumps(payload, separators=(",", ":")) + "\n")
    size = OUT.stat().st_size / 1024
    print(f"\nwritten to {OUT} ({size:.0f} KB)")


if __name__ == "__main__":
    main()
