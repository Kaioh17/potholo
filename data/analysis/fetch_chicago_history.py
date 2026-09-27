"""Download the real Chicago history the lifecycle model is calibrated against.

Nothing in this repo has a time dimension: every cluster in `potholo.db` was
created in the last few hours by the mock fleet, and `drive_2024-11-29.csv` is a
single 418-second drive. A pothole lifecycle therefore cannot be fitted from our
own data -- the parameters have to come from somewhere that has watched Chicago
roads for years.

Three public sources, no API keys:

- Chicago 311 "Pot Holes Reported" (Socrata `7as2-ds3y`): every pothole request
  2011-2018 with the date it was reported, the date it was filled, where it was,
  and how many holes were filled on that block. This is the only public record
  of a Chicago pothole being born and dying.
- Open-Meteo's ERA5 archive: daily min/max temperature at Chicago, which gives
  freeze-thaw cycles -- the physical mechanism the whole hypothesis rests on.
- Chicago "Average Daily Traffic Counts" (Socrata `pfsx-4n4m`): vehicle counts
  at ~1,300 locations, for the loading half of the mechanism.

Raw pulls are cached so re-running is cheap and offline-safe.
"""
from __future__ import annotations

import csv
import io
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

CACHE = Path(__file__).resolve().parent / "cache"
SODA = "https://data.cityofchicago.org/resource"

# 2011-2018 is the window where the dedicated pothole dataset is complete. The
# 311 system was replaced in Dec 2018 and the schema changed with it, so mixing
# the two would put a reporting-process change in the middle of the series and
# read it as a change in the roads.
START, END = "2011-01-01", "2018-12-31"


def _fetch(url: str, dest: Path, binary: bool = False) -> Path:
    """Download to `dest` once, then reuse it."""
    if dest.exists() and dest.stat().st_size > 0:
        print(f"  cached  {dest.name} ({dest.stat().st_size / 1e6:.1f} MB)")
        return dest
    print(f"  fetching {dest.name} ...", flush=True)
    req = urllib.request.Request(url, headers={"User-Agent": "potholo-research/1.0"})
    with urllib.request.urlopen(req, timeout=300) as response:
        data = response.read()
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    print(f"  saved   {dest.name} ({len(data) / 1e6:.1f} MB)")
    return dest


def soda_csv(dataset: str, dest: Path, **params) -> Path:
    query = urllib.parse.urlencode({f"${k}": v for k, v in params.items()}, safe="(),*:'")
    return _fetch(f"{SODA}/{dataset}.csv?{query}", dest)


def potholes() -> Path:
    """Every pothole request with its report and fill dates, and where it was.

    Pulled in pages: Socrata caps a single response, and the full window is
    about 600k rows.
    """
    dest = CACHE / "chicago_311_potholes.csv"
    if dest.exists() and dest.stat().st_size > 0:
        print(f"  cached  {dest.name} ({dest.stat().st_size / 1e6:.1f} MB)")
        return dest

    fields = (
        "creation_date,completion_date,status,latitude,longitude,"
        "number_of_potholes_filled_on_block,ward,community_area,current_activity"
    )
    rows: list[list[str]] = []
    header: list[str] | None = None
    page, limit = 0, 50000
    while True:
        part = CACHE / f"_potholes_p{page}.csv"
        soda_csv(
            "7as2-ds3y",
            part,
            select=fields,
            where=f"creation_date >= '{START}T00:00:00' AND creation_date <= '{END}T23:59:59'",
            order="creation_date",
            limit=limit,
            offset=page * limit,
        )
        text = part.read_text(encoding="utf-8", errors="replace")
        block = list(csv.reader(io.StringIO(text)))
        if not block:
            break
        head, body = block[0], block[1:]
        header = header or head
        rows.extend(body)
        print(f"    page {page}: {len(body)} rows (total {len(rows)})")
        if len(body) < limit:
            break
        page += 1
        if page > 40:  # a guard, not a limit we expect to reach
            print("    stopping at 40 pages", file=sys.stderr)
            break

    dest.parent.mkdir(parents=True, exist_ok=True)
    with dest.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(header)
        writer.writerows(rows)
    for stale in CACHE.glob("_potholes_p*.csv"):
        stale.unlink()
    print(f"  saved   {dest.name}: {len(rows)} rows")
    return dest


def weather() -> Path:
    """Daily min/max temperature for Chicago, for freeze-thaw cycle counting."""
    query = urllib.parse.urlencode(
        {
            "latitude": 41.8781,
            "longitude": -87.6298,
            "start_date": START,
            "end_date": END,
            "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum",
            "timezone": "America/Chicago",
        }
    )
    return _fetch(
        f"https://archive-api.open-meteo.com/v1/archive?{query}",
        CACHE / "chicago_weather.json",
    )


def traffic() -> Path:
    """Average daily traffic counts, with the coordinates to join them on."""
    return soda_csv(
        "pfsx-4n4m",
        CACHE / "chicago_traffic.csv",
        select="traffic_volume_count_location_address,street,date_of_count,"
        "total_passing_vehicle_volume,latitude,longitude",
        limit=50000,
    )


def main() -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    print("311 pothole requests (2011-2018):")
    potholes()
    print("Chicago daily weather:")
    weather()
    print("Average daily traffic counts:")
    traffic()
    print("\nAll sources cached in", CACHE)


if __name__ == "__main__":
    main()
