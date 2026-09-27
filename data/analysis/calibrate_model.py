"""Turn the study's findings into the constants the forecaster runs on.

Most of a lifecycle model's parameters can be measured. One cannot: how fast a
pothole grows when nobody fills it. No such measurement exists in the literature,
because nobody instruments a hole and lets it run -- it gets filled. That
parameter is therefore an *assumption*, and this script's job is to pin it to the
best empirical anchor available and then say plainly how weak that anchor is.

The anchor: blocks that get reported more than once. The gap between consecutive
reports on the same block is a noisy observation of how long it takes road damage
to go from "just repaired" back to "bad enough that someone picks up the phone."
That is not a pothole's growth curve, but it is a real timescale from real
Chicago streets, and it beats inventing a number.

Outputs `web/src/forecast/calibration.js`, which the browser-side model reads.
It is written as a JS module rather than raw JSON so that both Vite and plain
Node can import it without an import attribute, which keeps the model testable
outside the browser.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
CACHE = HERE / "cache"
FINDINGS = HERE.parent / "lifecycle_findings.json"
OUT = HERE.parent.parent / "web" / "src" / "forecast" / "calibration.js"

MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()


def load() -> pd.DataFrame:
    df = pd.read_csv(
        CACHE / "chicago_311_potholes.csv",
        parse_dates=["creation_date", "completion_date"],
        dtype={"status": "string", "current_activity": "string"},
        low_memory=False,
    )
    activity = df["current_activity"].fillna("")
    dup = activity.str.contains("Dup", case=False, na=False) | df["status"].str.contains(
        "Dup", case=False, na=False
    )
    return df[~dup].dropna(subset=["latitude", "longitude"])


def reopen_interval(df: pd.DataFrame) -> dict:
    """How long until the same block is reported again?

    A block is keyed on coordinates rounded to ~11 m. 311 geocodes to an address
    range, so exact float equality would split one block into several keys.
    """
    print("\nRepeat reports on the same block")
    print("-" * 60)
    key = (
        df["latitude"].round(4).astype(str) + "," + df["longitude"].round(4).astype(str)
    )
    work = df.assign(block=key).sort_values(["block", "creation_date"])
    work["gap"] = work.groupby("block")["creation_date"].diff().dt.days

    gaps = work["gap"].dropna()
    # Under 14 days is the same complaint arriving twice, not damage returning --
    # the city's own duplicate flag does not catch reports filed weeks apart or
    # snapped to a neighbouring address.
    gaps = gaps[(gaps >= 14) & (gaps <= 365 * 5)]

    blocks = work["block"].nunique()
    repeats = work.groupby("block").size()
    print(f"distinct blocks                 {blocks:>9,}")
    print(f"blocks reported more than once  {(repeats > 1).sum():>9,}  ({(repeats > 1).mean():.1%})")
    print(f"usable intervals (14d-5y)       {len(gaps):>9,}")

    q = gaps.quantile([0.1, 0.25, 0.5, 0.75, 0.9])
    print("\ndays between consecutive reports on one block:")
    for p, v in q.items():
        print(f"  p{int(p*100):<3d}  {v:>6.0f} days  ({v/30.4:>4.1f} months)")

    median_days = float(q[0.5])
    print(f"\nmedian {median_days:.0f} days -- the timescale on which a Chicago block")
    print("goes from repaired back to complaint-worthy.")
    return {
        "blocks": int(blocks),
        "repeat_share": float((repeats > 1).mean()),
        "n_intervals": int(len(gaps)),
        "days_between_reports": {f"p{int(p*100)}": float(v) for p, v in q.items()},
        "median_days": median_days,
    }


def seasonal_hazard() -> dict:
    """Daily damage weight through the year, from real weather.

    The forecaster needs to know that January does more damage than July. Rather
    than assume a shape, take the freeze-thaw count per calendar month from eight
    years of Chicago weather and normalise it.
    """
    print("\nSeasonal damage driver")
    print("-" * 60)
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
    wx["ft"] = ((wx.tmin < 0) & (wx.tmax > 0)).astype(int)
    wx["wet"] = (wx.precip.fillna(0) > 0.5) | (wx.snow.fillna(0) > 0)
    # Moisture is not optional: freeze-thaw with no water in the crack has
    # nothing to expand. A dry freeze-thaw day still counts for a little, since
    # the ground holds moisture the gauge does not see.
    wx["driver"] = wx["ft"] * np.where(wx["wet"], 1.0, 0.35)

    by_month = wx.groupby(wx.day.dt.month)["driver"].mean()
    index = (by_month / by_month.mean()).round(4)
    print("freeze-thaw damage index by month (1.00 = annual mean):")
    for m in range(1, 13):
        print(f"  {MONTHS[m-1]}  x{index[m]:5.2f}  {'#' * int(index[m] * 14)}")

    ft_per_year = wx.groupby(wx.day.dt.year)["ft"].sum()
    print(f"\nfreeze-thaw days per year: mean {ft_per_year.mean():.0f}, "
          f"range {ft_per_year.min():.0f}-{ft_per_year.max():.0f}")
    return {
        "monthly_damage_index": {MONTHS[m - 1]: float(index[m]) for m in range(1, 13)},
        "ft_days_per_year_mean": float(ft_per_year.mean()),
        "ft_days_per_year_min": int(ft_per_year.min()),
        "ft_days_per_year_max": int(ft_per_year.max()),
    }


def climate() -> dict:
    """Per-month weather for the page: what the roads actually went through.

    Two series, and the difference between them is the point:

    - `actual`, keyed YYYY-MM, is the real Chicago weather over the window the
      timeline covers. The past gets the winter it really had.
    - `normal`, keyed by calendar month, is the 2011-2018 average. The future
      gets this, because Q2 of the study found freeze-thaw day counts do not
      rank winters by pothole volume -- so forecasting a *particular* winter
      would be claiming skill the data says we do not have. An average winter is
      the honest future.
    """
    print("\nMonthly climate")
    print("-" * 60)

    def monthly(path: Path) -> pd.DataFrame:
        raw = json.loads(path.read_text())["daily"]
        wx = pd.DataFrame(
            {
                "day": pd.to_datetime(raw["time"]),
                "tmax": raw["temperature_2m_max"],
                "tmin": raw["temperature_2m_min"],
                "precip": raw["precipitation_sum"],
                "snow": raw["snowfall_sum"],
            }
        )
        wx["ft"] = ((wx.tmin < 0) & (wx.tmax > 0)).astype(int)
        wx["wet"] = (wx.precip.fillna(0) > 0.5) | (wx.snow.fillna(0) > 0)
        wx["driver"] = wx["ft"] * np.where(wx["wet"], 1.0, 0.35)
        return wx

    hist = monthly(CACHE / "chicago_weather.json")
    # The damage index is normalised on the calibration window, so the same
    # divisor has to be used for recent months or a mild year would look like a
    # different climate rather than a mild year.
    base = hist["driver"].mean()

    def pack(frame: pd.DataFrame) -> dict:
        return {
            "ft_days": int(frame["ft"].sum()),
            "precip_mm": round(float(frame["precip"].fillna(0).sum()), 1),
            "snow_cm": round(float(frame["snow"].fillna(0).sum()), 1),
            "tmin_c": round(float(frame["tmin"].mean()), 1),
            "tmax_c": round(float(frame["tmax"].mean()), 1),
            "damage_index": round(float(frame["driver"].mean() / base), 3),
        }

    normal = {}
    for month, frame in hist.groupby(hist.day.dt.month):
        years = frame.day.dt.year.nunique()
        packed = pack(frame)
        # Sums are over eight years of that month, so divide back to one month.
        packed["ft_days"] = round(packed["ft_days"] / years, 1)
        packed["precip_mm"] = round(packed["precip_mm"] / years, 1)
        packed["snow_cm"] = round(packed["snow_cm"] / years, 1)
        normal[MONTHS[month - 1]] = packed

    recent = monthly(CACHE / "chicago_weather_recent.json")
    actual = {
        key.strftime("%Y-%m"): pack(frame)
        for key, frame in recent.groupby(pd.Grouper(key="day", freq="MS"))
        if len(frame) > 20  # drop a part-month at either end
    }

    print("climatological normal (2011-2018 average):")
    for m in MONTHS:
        n = normal[m]
        print(f"  {m}  {n['ft_days']:>4.1f} FT days  {n['precip_mm']:>6.1f} mm  "
              f"{n['snow_cm']:>5.1f} cm snow  {n['tmin_c']:>5.1f}..{n['tmax_c']:>4.1f} C  "
              f"x{n['damage_index']:.2f}")
    print(f"\nactual months available: {len(actual)} "
          f"({min(actual)} to {max(actual)})")
    worst = max(actual.items(), key=lambda kv: kv[1]["ft_days"])
    print(f"hardest recent month: {worst[0]} with {worst[1]['ft_days']} freeze-thaw days")
    return {"normal": normal, "actual": actual}


def growth_rate(reopen: dict, findings: dict) -> dict:
    """The assumption, made explicit and bounded.

    Logistic growth on a 0-100 severity scale. The rate constant k is set so a
    pothole climbs from the severity we first detect it at to the severity where
    it is unmistakably bad, over the median interval at which a Chicago block
    gets re-reported -- and only counting the damage-weighted days in between.

    Everything about this is a modelling choice, so it is written down as one.
    """
    print("\nGrowth law")
    print("-" * 60)
    s0, s1 = 40.0, 80.0  # detected -> unmistakable, on our severity scale
    cap = 100.0
    months = reopen["median_days"] / 30.4

    # Logistic: ds/dt = k*s*(1 - s/cap). Integrate between s0 and s1 to get k.
    def logit(s: float) -> float:
        return np.log(s / (cap - s))

    k_per_month = float((logit(s1) - logit(s0)) / months)
    print(f"anchor: severity {s0:.0f} -> {s1:.0f} over {months:.1f} months")
    print(f"logistic rate k = {k_per_month:.4f} per damage-month")
    print(f"  implied doubling of the odds ratio every "
          f"{np.log(2)/k_per_month:.1f} damage-months")

    # An honest spread. The anchor is one noisy quantity, so the band is wide on
    # purpose: p25 and p75 of the same interval distribution, inverted.
    fast = float((logit(s1) - logit(s0)) / (reopen["days_between_reports"]["p25"] / 30.4))
    slow = float((logit(s1) - logit(s0)) / (reopen["days_between_reports"]["p75"] / 30.4))
    print(f"  fast (p25 interval) k = {fast:.4f}   slow (p75 interval) k = {slow:.4f}")
    print(f"  that is a {fast/slow:.1f}x spread -- carried into the forecast as a band,")
    print("  not averaged away.")
    return {
        "form": "logistic",
        "severity_cap": cap,
        "k_per_damage_month": k_per_month,
        "k_fast": fast,
        "k_slow": slow,
        "anchor": {
            "from_severity": s0,
            "to_severity": s1,
            "over_months": float(months),
            "basis": "median interval between repeat 311 reports on the same block",
        },
        "confidence": "low - no published growth rate exists for untreated potholes",
    }


def main() -> None:
    findings = json.loads(FINDINGS.read_text())
    df = load()
    print(f"requests loaded                 {len(df):>9,}")

    reopen = reopen_interval(df)
    hazard = seasonal_hazard()
    conditions = climate()
    growth = growth_rate(reopen, findings)

    repair = findings["q3_lifecycle"]
    calibration = {
        "generated": findings["generated"],
        "provenance": {
            "potholes": "Chicago 311 'Pot Holes Reported' 2011-2018 (Socrata 7as2-ds3y), "
            f"{findings['q1_seasonality']['annual_totals'] and sum(findings['q1_seasonality']['annual_totals'].values()):,} "
            "requests after removing city-flagged duplicates",
            "weather": "Open-Meteo ERA5 daily reanalysis, Chicago 2011-2018",
            "traffic": "Chicago Average Daily Traffic Counts (Socrata pfsx-4n4m)",
        },
        "seasonality": {
            "report_index": findings["q1_seasonality"]["monthly_index"],
            "peak_month": findings["q1_seasonality"]["peak_month"],
            "peak_trough_ratio": findings["q1_seasonality"]["peak_trough_ratio"],
            "spring_share_mean": findings["q1_seasonality"]["spring_share_mean"],
            "spring_share_sd": findings["q1_seasonality"]["spring_share_sd"],
        },
        "damage_driver": hazard,
        "climate": conditions,
        "growth": growth,
        "repair": {
            "median_days_to_fill": repair["days_to_fill"]["p50"],
            "p90_days_to_fill": repair["days_to_fill"]["p90"],
            "median_by_month": repair["median_by_month"],
            "holes_per_block_median": repair["holes_per_block_median"],
        },
        "reopen": reopen,
        "excluded_predictors": {
            "traffic_volume": {
                "reason": "no usable signal in Chicago data",
                "incidence_r": findings["q4_traffic"]["r_raw"],
                "intensity_lift": 1.0,
                "caveat": "ADT counters sit only on arterials (p5 = 5,200 veh/day), so this "
                "tests arterial against arterial, never quiet against busy. The physical "
                "literature says traffic propagates damage; this data cannot resolve it, so "
                "it is left out rather than fitted to noise.",
            },
            "year_ahead_freeze_thaw": {
                "reason": "freeze-thaw count does not rank winters by severity",
                "season_level_r": findings["q2_weather"]["season_level_r"],
                "n_seasons": findings["q2_weather"]["season_n"],
                "caveat": "within-year shape is used; between-year prediction is not claimed.",
            },
        },
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    banner = (
        "// Generated by data/analysis/calibrate_model.py -- do not edit by hand.\n"
        "// Constants measured from 394,453 Chicago 311 pothole requests (2011-2018),\n"
        "// Open-Meteo ERA5 weather and Chicago ADT traffic counts.\n\n"
    )
    OUT.write_text(banner + "export default " + json.dumps(calibration, indent=2) + "\n")
    print(f"\ncalibration written to {OUT}")


if __name__ == "__main__":
    main()
