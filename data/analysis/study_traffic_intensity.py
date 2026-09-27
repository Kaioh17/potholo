"""Does traffic create potholes, or only deepen the ones freeze-thaw started?

Q4 of the main study found traffic volume barely predicts *how many* pothole
requests appear near a counter (r = +0.03). Abed et al. (2023) suggest why that
is not the end of the story: freeze-thaw and water ingress initiate a pothole,
while "repeated traffic loads deepen the depression by removing the fragmented
stones." Incidence and intensity are different outcomes.

311 does not record a hole's depth, but it records
`number_of_potholes_filled_on_block` -- how much damage the crew found when they
arrived. That is an intensity measure, and it is the closest thing available to
"how bad had it got."

So: incidence (requests per counter) against intensity (holes per block visit),
both versus traffic volume. If the propagation story holds, intensity should
track traffic even where incidence does not.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

CACHE = Path(__file__).resolve().parent / "cache"
R = 250.0


def main() -> None:
    df = pd.read_csv(
        CACHE / "chicago_311_potholes.csv",
        parse_dates=["creation_date"],
        dtype={"status": "string", "current_activity": "string"},
        low_memory=False,
    )
    activity = df["current_activity"].fillna("")
    dup = activity.str.contains("Dup", case=False, na=False) | df["status"].str.contains(
        "Dup", case=False, na=False
    )
    df = df[~dup]
    df = df.dropna(subset=["latitude", "longitude"])
    df["holes"] = pd.to_numeric(df["number_of_potholes_filled_on_block"], errors="coerce")

    traffic = pd.read_csv(CACHE / "chicago_traffic.csv").dropna(
        subset=["latitude", "longitude", "total_passing_vehicle_volume"]
    )
    traffic = traffic[traffic["total_passing_vehicle_volume"] > 0]

    lat0 = np.radians(float(df["latitude"].mean()))
    m_lat, m_lon = 111_320.0, 111_320.0 * np.cos(lat0)
    px = df["longitude"].to_numpy() * m_lon
    py = df["latitude"].to_numpy() * m_lat
    holes = df["holes"].to_numpy()
    order = np.argsort(px)
    px, py, holes = px[order], py[order], holes[order]

    incidence, intensity = [], []
    for _, site in traffic.iterrows():
        sx, sy = site["longitude"] * m_lon, site["latitude"] * m_lat
        lo, hi = np.searchsorted(px, [sx - R, sx + R])
        if hi <= lo:
            incidence.append(0)
            intensity.append(np.nan)
            continue
        near = (px[lo:hi] - sx) ** 2 + (py[lo:hi] - sy) ** 2 <= R * R
        incidence.append(int(near.sum()))
        block = holes[lo:hi][near]
        block = block[np.isfinite(block) & (block > 0) & (block < 500)]
        intensity.append(float(np.median(block)) if len(block) >= 5 else np.nan)

    t = traffic.assign(incidence=incidence, intensity=intensity)
    t = t[(t["incidence"] > 0) & t["intensity"].notna()]
    vol = t["total_passing_vehicle_volume"]
    print(f"counters usable                 {len(t):>9,}")

    print("\ncorrelation with traffic volume:")
    print(f"  incidence (requests nearby)   r = {np.corrcoef(vol, t['incidence'])[0,1]:+.3f}")
    print(f"  intensity (holes per block)   r = {np.corrcoef(vol, t['intensity'])[0,1]:+.3f}")
    print(f"  intensity, log volume         r = {np.corrcoef(np.log10(vol), t['intensity'])[0,1]:+.3f}")

    t = t.assign(band=pd.qcut(vol, 5, labels=["lowest", "low", "mid", "high", "highest"]))
    g = t.groupby("band", observed=True).agg(
        volume=("total_passing_vehicle_volume", "median"),
        incidence=("incidence", "median"),
        intensity=("intensity", "median"),
        n=("incidence", "size"),
    )
    print("\nby traffic quintile:")
    print(f"  {'band':<8} {'veh/day':>9} {'requests':>10} {'holes/block':>13}   n")
    for band, row in g.iterrows():
        print(f"  {band:<8} {row.volume:>9,.0f} {row.incidence:>10.0f} {row.intensity:>13.1f}   {int(row.n)}")

    inc_lift = g["incidence"].iloc[-1] / max(g["incidence"].iloc[0], 1e-9)
    int_lift = g["intensity"].iloc[-1] / max(g["intensity"].iloc[0], 1e-9)
    print(f"\nhighest vs lowest quintile:")
    print(f"  incidence lift                {inc_lift:>9.2f}x")
    print(f"  intensity lift                {int_lift:>9.2f}x")

    # Spearman as well: the relationship need not be linear, and volume is skewed.
    def spearman(a, b):
        return np.corrcoef(pd.Series(a).rank(), pd.Series(b).rank())[0, 1]

    print(f"\nSpearman (rank) correlations:")
    print(f"  volume vs incidence           {spearman(vol, t['incidence']):+.3f}")
    print(f"  volume vs intensity           {spearman(vol, t['intensity']):+.3f}")

    print("\nRange restriction check -- these counters are all on busy roads:")
    print(f"  volume p5   {vol.quantile(0.05):>8,.0f} veh/day")
    print(f"  volume p50  {vol.quantile(0.50):>8,.0f} veh/day")
    print(f"  volume p95  {vol.quantile(0.95):>8,.0f} veh/day")
    print("  A residential side street (~500-2,000 veh/day) is not in this sample at all,")
    print("  so this tests arterial-vs-arterial, not quiet-vs-busy.")


if __name__ == "__main__":
    main()
