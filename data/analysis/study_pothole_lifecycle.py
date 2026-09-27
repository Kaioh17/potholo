"""What 560k real Chicago pothole requests say about how a pothole lives.

This is the evidence the forecasting model is built on. It is written to *test*
the hypothesis that potholes follow a weather-driven lifecycle, not to confirm
it -- where the data does not support a claim, the report says so, because a
forecast calibrated on a flattering read of the data will be wrong in exactly
the season it matters.

Four questions:

  Q1  Time sequence. Do reports follow a repeatable annual cycle?
  Q2  Weather.       Do freeze-thaw cycles lead reports, and at what lag?
  Q3  Lifecycle.     How long does a pothole live once reported?
  Q4  Traffic.       Does traffic volume predict where potholes appear?

Run `fetch_chicago_history.py` first.

A caveat that shapes every number below, stated once here and carried through:
311 counts *reports*, not potholes. A report is a person noticing a hole and
choosing to call. That makes every series here a product of road condition and
human behaviour, and the two cannot be fully separated from this data alone.
Where that distinction changes an interpretation, the report flags it.
"""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

CACHE = Path(__file__).resolve().parent / "cache"
OUT = Path(__file__).resolve().parent.parent / "lifecycle_findings.json"

# A freeze-thaw day: water in a crack melts and refreezes, and the ~9% expansion
# levers the crack open. The standard pavement-engineering definition is a day
# that crosses 0 C in both directions.
FREEZE, THAW = 0.0, 0.0


def rule(title: str) -> None:
    print(f"\n{'=' * 78}\n{title}\n{'=' * 78}")


def load_potholes() -> pd.DataFrame:
    df = pd.read_csv(
        CACHE / "chicago_311_potholes.csv",
        parse_dates=["creation_date", "completion_date"],
        dtype={"status": "string", "current_activity": "string"},
        low_memory=False,
    )
    print(f"rows as downloaded              {len(df):>9,}")

    # 311 records the same hole many times: neighbours each call it in, and the
    # city marks the later ones duplicates. Counting them as separate potholes
    # would inflate exactly the busy streets the model cares about most.
    activity = df["current_activity"].fillna("")
    dup = activity.str.contains("Dup", case=False, na=False) | df["status"].str.contains(
        "Dup", case=False, na=False
    )
    print(f"marked duplicate by the city    {dup.sum():>9,}  ({dup.mean():.1%})")
    df = df[~dup].copy()

    bad_geo = df["latitude"].isna() | df["longitude"].isna()
    print(f"missing coordinates             {bad_geo.sum():>9,}")
    df["has_geo"] = ~bad_geo
    print(f"distinct requests kept          {len(df):>9,}")
    return df


def load_weather() -> pd.DataFrame:
    raw = json.loads((CACHE / "chicago_weather.json").read_text())["daily"]
    wx = pd.DataFrame(
        {
            "day": pd.to_datetime(raw["time"]),
            "tmax": raw["temperature_2m_max"],
            "tmin": raw["temperature_2m_min"],
            "precip": raw["precipitation_sum"],
            "snow": raw["snowfall_sum"],
        }
    )
    wx["freeze_thaw"] = ((wx.tmin < FREEZE) & (wx.tmax > THAW)).astype(int)
    # Water has to be present for the ice lever to exist at all.
    wx["wet_freeze_thaw"] = (
        wx.freeze_thaw & ((wx.precip.fillna(0) > 0.5) | (wx.snow.fillna(0) > 0))
    ).astype(int)
    print(f"weather days                    {len(wx):>9,}")
    print(f"freeze-thaw days                {wx.freeze_thaw.sum():>9,}  ({wx.freeze_thaw.mean():.1%})")
    print(f"  of those, with moisture       {wx.wet_freeze_thaw.sum():>9,}")
    return wx


def q1_seasonality(df: pd.DataFrame) -> dict:
    rule("Q1  Time sequence: is there a repeatable annual cycle?")
    daily = df.set_index("creation_date").resample("D").size().rename("reports")
    monthly = daily.resample("MS").sum()

    by_month = daily.groupby(daily.index.month).mean()
    overall = daily.mean()
    index = (by_month / overall).round(3)

    print("\nmean reports per day, by calendar month (1.00 = annual average):")
    names = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()
    for m, name in enumerate(names, start=1):
        bar = "#" * int(index[m] * 22)
        print(f"  {name}  {by_month[m]:7.1f}/day   x{index[m]:5.2f}  {bar}")

    peak, trough = int(index.idxmax()), int(index.idxmin())
    ratio = index.max() / index.min()
    print(f"\npeak {names[peak-1]} (x{index.max():.2f})  trough {names[trough-1]} (x{index.min():.2f})")
    print(f"peak-to-trough ratio            {ratio:>9.1f}x")

    # Is the cycle repeatable, or is one bad winter carrying the average?
    per_year = daily.groupby([daily.index.year, daily.index.month]).sum().unstack()
    share = per_year.div(per_year.sum(axis=1), axis=0)
    spring = share[[2, 3, 4]].sum(axis=1)
    print("\nshare of each year's reports falling in Feb-Apr:")
    for year, value in spring.items():
        print(f"  {year}   {value:6.1%}")
    print(f"\nmean {spring.mean():.1%}, standard deviation {spring.std():.1%}")

    annual = monthly.groupby(monthly.index.year).sum()
    print("\ntotal reports per year:")
    for year, value in annual.items():
        print(f"  {year}   {value:>8,}")
    print(f"\nyear-to-year swing              {annual.max() / annual.min():>9.1f}x")
    return {
        "monthly_index": {names[m - 1]: float(index[m]) for m in range(1, 13)},
        "peak_month": names[peak - 1],
        "trough_month": names[trough - 1],
        "peak_trough_ratio": float(ratio),
        "spring_share_mean": float(spring.mean()),
        "spring_share_sd": float(spring.std()),
        "annual_totals": {int(y): int(v) for y, v in annual.items()},
        "annual_swing": float(annual.max() / annual.min()),
    }


def q2_weather(df: pd.DataFrame, wx: pd.DataFrame) -> dict:
    rule("Q2  Weather: do freeze-thaw cycles lead reports?")
    daily = df.set_index("creation_date").resample("D").size().rename("reports")
    joined = wx.set_index("day").join(daily).fillna({"reports": 0})

    # Monthly, because a single day's reports are dominated by day-of-week and
    # weather-of-the-day effects (nobody reports a pothole in a blizzard), while
    # the damage itself accumulates over weeks.
    m = joined.resample("MS").agg(
        reports=("reports", "sum"),
        ft=("freeze_thaw", "sum"),
        wet_ft=("wet_freeze_thaw", "sum"),
        tmin=("tmin", "mean"),
        precip=("precip", "sum"),
    )

    print("\ncorrelation of monthly reports with freeze-thaw count, by lag:")
    print("  lag   Pearson r   (lag = months AFTER the freeze-thaw)")
    best = (0, -9.0)
    lags = {}
    for lag in range(0, 5):
        r = m["reports"].corr(m["ft"].shift(lag))
        lags[lag] = float(r)
        flag = ""
        if r > best[1]:
            best = (lag, r)
            flag = "  <- strongest"
        print(f"   {lag}      {r:+.3f}{flag}")
    print(f"\nstrongest at lag {best[0]} month(s): r = {best[1]:+.3f}")

    r_wet = m["reports"].corr(m["wet_ft"].shift(best[0]))
    print(f"same lag, moisture-gated freeze-thaw:  r = {r_wet:+.3f}")

    # Winter-only, to check the correlation is not just "it is cold in winter
    # and people report potholes in winter". If freeze-thaw carries real
    # information, it should still rank bad winters against mild ones.
    winters = m[m.index.month.isin([12, 1, 2, 3, 4])]
    r_winter = winters["reports"].corr(winters["ft"].shift(best[0]))
    print(f"restricted to Dec-Apr only:            r = {r_winter:+.3f}")

    season = m.copy()
    season["season"] = season.index.year + (season.index.month >= 7)
    per = season.groupby("season").agg(reports=("reports", "sum"), ft=("ft", "sum"))
    per = per[(per.index > per.index.min()) & (per.index < per.index.max())]
    print("\nby winter season (July-June), freeze-thaw days vs reports:")
    for year, row in per.iterrows():
        print(f"  {int(year)-1}-{int(year)}   {int(row.ft):3d} FT days   {int(row.reports):>7,} reports")
    r_season = per["reports"].corr(per["ft"])
    print(f"\nseason-level correlation        {r_season:>+9.3f}  (n = {len(per)})")
    return {
        "lag_correlations": lags,
        "best_lag_months": int(best[0]),
        "best_lag_r": float(best[1]),
        "wet_gated_r": float(r_wet),
        "winter_only_r": float(r_winter),
        "season_level_r": float(r_season),
        "season_n": int(len(per)),
    }


def q3_lifecycle(df: pd.DataFrame) -> dict:
    rule("Q3  Lifecycle: how long does a reported pothole live?")
    done = df[df["status"].str.contains("Completed", case=False, na=False)].copy()
    done["days"] = (done["completion_date"] - done["creation_date"]).dt.days
    valid = done[(done["days"] >= 0) & (done["days"] <= 730)]
    print(f"completed requests              {len(done):>9,}")
    print(f"  usable durations              {len(valid):>9,}")
    print(f"  negative or >2y (dropped)     {len(done) - len(valid):>9,}")

    q = valid["days"].quantile([0.1, 0.25, 0.5, 0.75, 0.9, 0.99])
    print("\ndays from report to fill:")
    for p, v in q.items():
        print(f"  p{int(p*100):<3d}  {v:>6.0f} days")
    print(f"  mean  {valid['days'].mean():>6.1f} days")

    print("\nmedian days-to-fill by month reported (CDOT's queue under load):")
    by_month = valid.groupby(valid["creation_date"].dt.month)["days"].median()
    names = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()
    for m, v in by_month.items():
        print(f"  {names[m-1]}  {v:>6.0f} days  {'#' * int(v / 2)}")

    holes = pd.to_numeric(valid["number_of_potholes_filled_on_block"], errors="coerce")
    holes = holes[(holes > 0) & (holes < 500)]
    print(f"\npotholes filled per block visit: median {holes.median():.0f}, "
          f"mean {holes.mean():.1f}, p90 {holes.quantile(0.9):.0f}")
    print("A request is a *block*, not a hole -- this is the multiplier between them.")
    return {
        "n_completed": int(len(valid)),
        "days_to_fill": {f"p{int(p*100)}": float(v) for p, v in q.items()},
        "days_to_fill_mean": float(valid["days"].mean()),
        "median_by_month": {names[m - 1]: float(v) for m, v in by_month.items()},
        "holes_per_block_median": float(holes.median()),
        "holes_per_block_mean": float(holes.mean()),
        "holes_per_block_p90": float(holes.quantile(0.9)),
    }


def q4_traffic(df: pd.DataFrame) -> dict:
    rule("Q4  Traffic: does volume predict where potholes appear?")
    traffic = pd.read_csv(CACHE / "chicago_traffic.csv")
    traffic = traffic.dropna(subset=["latitude", "longitude", "total_passing_vehicle_volume"])
    traffic = traffic[traffic["total_passing_vehicle_volume"] > 0]
    print(f"traffic count locations         {len(traffic):>9,}")
    print(f"  volume median                 {traffic['total_passing_vehicle_volume'].median():>9,.0f} vehicles/day")

    geo = df[df["has_geo"]]
    print(f"geocoded pothole requests       {len(geo):>9,}")

    # Count requests within 250 m of each traffic counter. Chicago blocks are
    # about 100 m, so this is a couple of blocks either way -- wide enough to
    # catch the street's holes, tight enough not to swallow the next arterial.
    R = 250.0
    lat0 = np.radians(float(geo["latitude"].mean()))
    m_per_lat, m_per_lon = 111_320.0, 111_320.0 * np.cos(lat0)

    px = geo["longitude"].to_numpy() * m_per_lon
    py = geo["latitude"].to_numpy() * m_per_lat
    order = np.argsort(px)
    px, py = px[order], py[order]

    counts = []
    for _, site in traffic.iterrows():
        sx, sy = site["longitude"] * m_per_lon, site["latitude"] * m_per_lat
        lo, hi = np.searchsorted(px, [sx - R, sx + R])
        if hi <= lo:
            counts.append(0)
            continue
        near = (px[lo:hi] - sx) ** 2 + (py[lo:hi] - sy) ** 2 <= R * R
        counts.append(int(near.sum()))
    traffic = traffic.assign(potholes=counts)

    kept = traffic[traffic["potholes"] > 0]
    print(f"  counters with a pothole near  {len(kept):>9,}")

    r = np.corrcoef(kept["total_passing_vehicle_volume"], kept["potholes"])[0, 1]
    lr = np.corrcoef(
        np.log10(kept["total_passing_vehicle_volume"]), np.log10(kept["potholes"])
    )[0, 1]
    print(f"\ncorrelation volume vs pothole count (250 m):")
    print(f"  raw          r = {r:+.3f}")
    print(f"  log-log      r = {lr:+.3f}")

    kept = kept.assign(
        band=pd.qcut(kept["total_passing_vehicle_volume"], 5,
                     labels=["lowest", "low", "mid", "high", "highest"])
    )
    print("\nmedian potholes within 250 m, by traffic quintile:")
    grouped = kept.groupby("band", observed=True).agg(
        volume=("total_passing_vehicle_volume", "median"),
        potholes=("potholes", "median"),
        n=("potholes", "size"),
    )
    for band, row in grouped.iterrows():
        print(f"  {band:<8} {row.volume:>7,.0f} veh/day   {row.potholes:>5.0f} potholes   (n={int(row.n)})")
    lift = grouped["potholes"].iloc[-1] / max(grouped["potholes"].iloc[0], 1)
    print(f"\nhighest vs lowest quintile      {lift:>9.1f}x")
    return {
        "n_counters": int(len(kept)),
        "r_raw": float(r),
        "r_loglog": float(lr),
        "quintiles": {
            str(b): {"volume": float(r_.volume), "potholes": float(r_.potholes), "n": int(r_.n)}
            for b, r_ in grouped.iterrows()
        },
        "top_bottom_lift": float(lift),
    }


def main() -> None:
    rule("Loading")
    df = load_potholes()
    wx = load_weather()

    findings = {
        "generated": date.today().isoformat(),
        "source": "Chicago 311 pothole requests 2011-2018, Open-Meteo ERA5, Chicago ADT counts",
        "q1_seasonality": q1_seasonality(df),
        "q2_weather": q2_weather(df, wx),
        "q3_lifecycle": q3_lifecycle(df),
        "q4_traffic": q4_traffic(df),
    }
    OUT.write_text(json.dumps(findings, indent=2))
    print(f"\n\nfindings written to {OUT}")


if __name__ == "__main__":
    main()
