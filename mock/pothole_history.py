"""Generate a synthetic multi-year pothole history for Chicago.

    python mock/pothole_history.py

Why this exists: the forecaster needs a past to forecast from, and this project
has none. Every cluster in `potholo.db` was created in the last few hours, and
`drive_2024-11-29.csv` is a single 418-second drive. Without a history the map
can only draw one dot and a projection, which demonstrates nothing.

So this writes a history that is synthetic in its *locations* but real in its
*timing*: potholes appear month by month in proportion to the freeze-thaw damage
index measured from eight years of Chicago weather, and each winter is scaled by
that winter's actual freeze-thaw day count, which ranged from 35 to 96. A mild
winter really does produce fewer holes here, because a mild winter really did.

This is deliberately NOT run through the detection pipeline. `seed_db.py` does
that, and should: it proves the detector works. This file answers a different
question -- what does a city's worth of potholes look like over three winters --
and pushing three years of synthetic IMU through the detector to find out would
take hours and prove nothing the corridor seed does not already prove.

Everything it emits is marked `synthetic: true`. Nothing here is a measurement.
"""
from __future__ import annotations

import argparse
import json
import math
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CALIBRATION = ROOT / "web" / "src" / "forecast" / "calibration.js"
OUT = ROOT / "web" / "src" / "forecast" / "history.js"

STREETS = ROOT / "web" / "src" / "forecast" / "streets.js"

# Potholes are placed on real Chicago street centrelines around Union Station,
# not scattered at random: a hole sits on a road, and a cloud of uniform noise
# stops looking like a city the moment it is drawn on one.
#
# Chicago's street class: 1 expressway, 2 arterial, 3 collector, 4 local. Busier
# roads get proportionally more holes. That weighting is a presentation choice
# and the forecaster never reads it -- Q4 of the study found no usable traffic
# signal in the 311 data, so a weight here would be unsupported if the model
# leaned on it. It is here so the map looks like a city, and nothing more.
CLASS_WEIGHT = {1: 0.6, 2: 3.0, 3: 2.0, 4: 1.0}


def load_damage_index() -> tuple[list[float], dict]:
    """Read the monthly damage index out of the generated calibration module."""
    text = CALIBRATION.read_text(encoding="utf-8")
    payload = json.loads(text[text.index("{") :].rstrip().rstrip(";"))
    months = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()
    index = payload["damage_driver"]["monthly_damage_index"]
    return [index[m] for m in months], payload


def load_streets() -> list[dict]:
    """Read the street centrelines the map draws, so holes land on them."""
    text = STREETS.read_text(encoding="utf-8")
    payload = json.loads(text[text.index("{") :].rstrip().rstrip(";"))
    return payload["streets"]


def build_placements(streets: list[dict]) -> tuple[list[tuple], list[float]]:
    """Every drawable span of street, with a weight for how often it breaks.

    Weighting by length as well as class matters: sampling segments uniformly
    would pile potholes onto short stubs near intersections, because a 20 m
    connector would draw as often as a 300 m block.
    """
    spans: list[tuple] = []
    weights: list[float] = []
    for street in streets:
        points = street["p"]
        klass = street["c"]
        for (lon_a, lat_a), (lon_b, lat_b) in zip(points, points[1:]):
            # Rough metres; good enough to weight by, at this latitude.
            dx = (lon_b - lon_a) * 82_700
            dy = (lat_b - lat_a) * 111_320
            length = math.hypot(dx, dy)
            if length < 1:
                continue
            spans.append((lon_a, lat_a, lon_b, lat_b, street["n"], klass))
            weights.append(length * CLASS_WEIGHT.get(klass, 1.0))
    return spans, weights


def sample_on_street(rng: random.Random, spans, weights) -> tuple[float, float, str, bool]:
    """A point somewhere along a real street, and which street it was."""
    lon_a, lat_a, lon_b, lat_b, name, klass = rng.choices(spans, weights=weights, k=1)[0]
    t = rng.random()
    lon = lon_a + (lon_b - lon_a) * t
    lat = lat_a + (lat_b - lat_a) * t
    # A little jitter across the carriageway, so holes are not all on the
    # centreline. About 4 m, which is roughly a lane.
    lat += rng.gauss(0, 0.000035)
    lon += rng.gauss(0, 0.000045)
    return lat, lon, name, klass in (1, 2)


def winter_strength(rng: random.Random, calibration: dict) -> dict[int, float]:
    """Scale each winter by how hard it actually was.

    Chicago saw between 35 and 96 freeze-thaw days a year over 2011-2018. Using
    that real spread means the synthetic history has mild and harsh winters in
    realistic proportion, instead of three identical ones.
    """
    driver = calibration["damage_driver"]
    lo, hi = driver["ft_days_per_year_min"], driver["ft_days_per_year_max"]
    mean = driver["ft_days_per_year_mean"]
    return {"lo": lo, "hi": hi, "mean": mean}


def generate(years: int, count: int, seed: int) -> dict:
    rng = random.Random(seed)
    damage, calibration = load_damage_index()
    spans, span_weights = build_placements(load_streets())
    ft = winter_strength(rng, calibration)

    now = datetime.now(timezone.utc).replace(hour=12, minute=0, second=0, microsecond=0)
    start = (now - timedelta(days=365 * years)).replace(day=1)

    # Build the month-by-month emission weights across the whole window, then
    # draw pothole birth months from them. A month's weight is the damage index
    # for that calendar month times how hard that particular winter was.
    months: list[datetime] = []
    weights: list[float] = []
    season_scale: dict[int, float] = {}
    cursor = start
    while cursor < now:
        # A winter season runs July-June, so December and the following March
        # belong to the same winter and get the same severity multiplier.
        season = cursor.year + (1 if cursor.month >= 7 else 0)
        if season not in season_scale:
            days = rng.triangular(ft["lo"], ft["hi"], ft["mean"])
            season_scale[season] = days / ft["mean"]
        months.append(cursor)
        weights.append(damage[cursor.month - 1] * season_scale[season])
        cursor = (cursor.replace(day=28) + timedelta(days=8)).replace(day=1)

    # Every month needs a floor: potholes do appear in August, just rarely, and
    # a zero weight would make August impossible rather than unlikely.
    floor = 0.04 * (sum(weights) / len(weights))
    weights = [w + floor for w in weights]

    potholes = []
    for i in range(count):
        birth_month = rng.choices(months, weights=weights, k=1)[0]
        # Spread within the month so the map does not step in monthly jumps.
        span = 28
        born = birth_month + timedelta(
            days=rng.uniform(0, span), hours=rng.uniform(0, 24)
        )
        if born > now:
            born = now - timedelta(hours=rng.uniform(1, 72))

        lat, lon, street, arterial = sample_on_street(rng, spans, span_weights)

        # Severity at first detection. Our detector picks a hole up once it is
        # big enough to register on an accelerometer, so the distribution starts
        # well above zero -- we never see them newborn. That censoring is real
        # and the forecaster inherits it.
        base = rng.betavariate(2.4, 3.2) * 55 + 25
        if arterial:
            base = min(100.0, base * 1.12)

        devices = max(1, int(rng.betavariate(1.6, 4.0) * 12) + 1)
        passes = devices + int(rng.expovariate(1 / 6.0))
        detections = max(1, min(passes, int(devices * rng.uniform(0.6, 1.4))))
        hit_rate = detections / max(passes, 1)

        if devices >= 3 and detections >= 4 and hit_rate >= 0.35:
            status = "reported" if rng.random() < 0.18 else "confirmed"
        else:
            status = "candidate"

        potholes.append(
            {
                "cluster_id": f"syn-{i:04d}",
                "lat": round(lat, 6),
                "lon": round(lon, 6),
                "severity": round(base, 1),
                "confidence": round(min(0.99, 0.45 + hit_rate * 0.5), 3),
                "radius_m": round(rng.uniform(0.8, 6.5), 1),
                "detections": detections,
                "devices": devices,
                "passes": passes,
                "hit_rate": round(hit_rate, 3),
                "status": status,
                "first_seen": born.isoformat().replace("+00:00", "Z"),
                "last_seen": now.isoformat().replace("+00:00", "Z"),
                "street": street,
                "arterial": arterial,
                "synthetic": True,
            }
        )

    potholes.sort(key=lambda p: p["first_seen"])
    by_month: dict[str, int] = {}
    for p in potholes:
        key = p["first_seen"][:7]
        by_month[key] = by_month.get(key, 0) + 1

    return {
        "synthetic": True,
        "generated": now.date().isoformat(),
        "seed": seed,
        "years": years,
        "note": (
            "Locations are synthetic but sit on real Chicago street centrelines around "
            "Union Station. Timing is driven by the freeze-thaw damage index "
            "measured from Chicago weather 2011-2018, with each winter scaled by a "
            "freeze-thaw day count drawn from the real 35-96 range. Not a measurement."
        ),
        "window": {"from": start.date().isoformat(), "to": now.date().isoformat()},
        "season_scale": {str(k): round(v, 3) for k, v in sorted(season_scale.items())},
        "births_by_month": dict(sorted(by_month.items())),
        "potholes": potholes,
    }


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--years", type=int, default=3)
    p.add_argument("--count", type=int, default=260)
    p.add_argument("--seed", type=int, default=20260927)
    args = p.parse_args()

    data = generate(args.years, args.count, args.seed)

    print(f"{len(data['potholes'])} synthetic potholes over {args.years} years")
    on_arterial = sum(1 for p in data["potholes"] if p["arterial"])
    print(f"on arterials: {on_arterial} ({on_arterial/len(data['potholes']):.0%})")
    from collections import Counter
    top = Counter(p["street"] for p in data["potholes"]).most_common(6)
    print("busiest streets:", ", ".join(f"{n} ({c})" for n, c in top))
    print("\nwinter severity multipliers (1.00 = an average Chicago winter):")
    for season, scale in data["season_scale"].items():
        print(f"  {int(season)-1}-{season}   x{scale:.2f}")

    print("\nbirths per month:")
    peak = max(data["births_by_month"].values())
    for month, n in data["births_by_month"].items():
        print(f"  {month}  {n:>3}  {'#' * int(n / peak * 40)}")

    statuses: dict[str, int] = {}
    for hole in data["potholes"]:
        statuses[hole["status"]] = statuses.get(hole["status"], 0) + 1
    print("\nstatus mix:", ", ".join(f"{k} {v}" for k, v in sorted(statuses.items())))

    banner = (
        "// Generated by mock/pothole_history.py -- do not edit by hand.\n"
        "// SYNTHETIC pothole locations with weather-driven timing. Not a measurement.\n\n"
    )
    OUT.write_text(banner + "export default " + json.dumps(data, indent=2) + "\n")
    print(f"\nwritten to {OUT}")


if __name__ == "__main__":
    main()
