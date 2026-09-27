# Pothole lifecycle forecasting

What happens to a Chicago pothole if nobody fills it, and how confident can we
be about saying so.

Everything here is reproducible:

```bash
python data/analysis/fetch_chicago_history.py     # ~62 MB, cached, no API keys
python data/analysis/study_pothole_lifecycle.py   # the four research questions
python data/analysis/study_traffic_intensity.py   # the traffic follow-up
python data/analysis/calibrate_model.py           # writes the model constants
python data/analysis/fetch_downtown_streets.py    # real street basemap
python mock/pothole_history.py                    # synthetic history for the map
npm --prefix web run verify:forecast              # 39 checks on the model maths
```

---

## The problem this had to solve first

Nothing in this repository has a time dimension. Every cluster in `potholo.db`
was created within hours by the mock fleet, and `drive_2024-11-29.csv` is a
single 418-second drive. A pothole *lifecycle* therefore cannot be fitted from
our own data — not with difficulty, but at all.

So the parameters come from outside, from three public sources with no API keys:

| Source | What it gives |
|---|---|
| Chicago 311 "Pot Holes Reported" (Socrata `7as2-ds3y`) | 559,867 requests 2011–2018, each with the date reported, the date filled, location, and how many holes were filled on that block |
| Open-Meteo ERA5 archive | daily min/max temperature and precipitation for Chicago, 2011–2018 |
| Chicago Average Daily Traffic Counts (`pfsx-4n4m`) | vehicle volumes at 1,279 locations |

After removing the 164,631 requests (29.4%) the city itself flagged as
duplicates, **394,453 distinct requests** remain. That deduplication matters: the
same hole gets called in by several neighbours, and counting those separately
would have inflated exactly the busy streets the model cares about most.

### The caveat that shapes every number below

**311 counts reports, not potholes.** A report is a person noticing a hole and
choosing to call. Every series here is a product of road condition *and* human
behaviour, and this data cannot fully separate them.

---

## What the data says

### Q1 — Seasonality: strongly supported

Reports follow a sharp, repeatable annual cycle.

```
Jan  x1.29   Feb  x1.72   Mar  x1.96 (peak)   Apr  x1.64
May  x1.17   Jun  x0.93   Jul  x0.72          Aug  x0.60
Sep  x0.51   Oct  x0.50   Nov  x0.41 (trough) Dec  x0.56
```

Peak-to-trough is **4.8×**. More importantly it *repeats*: the share of each
year's reports falling in Feb–Apr is **43.3% ± 3.1%** across all eight years.
That is a tight standard deviation on an eight-year sample, and it is the single
most solid thing in this analysis. Annual totals swing 1.9× (2014, the polar
vortex winter, produced 70,405 reports against 2016's 37,990).

This is the backbone of the model, and it is measured, not assumed.

### Q2 — Weather: supported as a mechanism, *not* as a year-ahead predictor

This is where the hypothesis needs qualifying, and the qualification is the most
useful result in the study.

The headline correlation looks convincing. Monthly reports against freeze-thaw
day counts, at increasing lag:

```
lag 0   r = +0.327
lag 1   r = +0.529
lag 2   r = +0.550   <- strongest
lag 3   r = +0.468
lag 4   r = +0.192
```

Moisture-gating the freeze-thaw days improves it slightly (r = +0.570), which is
physically right — ice needs water in the crack to lever it open.

**But that +0.55 is largely seasonal confounding.** Freeze-thaw and pothole
reports both peak in the same part of the year, so they correlate whether or not
one causes the other. Two controls break it:

- restricted to Dec–Apr only: **r = −0.256**
- at the level of whole winter seasons (July–June): **r = −0.359, n = 7**

The sign *flips*. With n = 7 that negative is not significant either (p ≈ 0.43),
so the honest reading is not "mild winters cause more potholes" but **"freeze-thaw
day count carries no detectable information about which winter will be worse."**

The mechanism is real and well established in the pavement literature — water
expands ~9% on freezing and levers cracks apart, and roads in wet-freeze climates
deteriorate up to twice as fast as dry-no-freeze ones. What the data does not
support is using this winter's freeze-thaw count to predict this winter's pothole
volume. So the model uses freeze-thaw to shape the year *within* itself, and
makes no claim about ranking one year against another.

**An independent check that passed.** The damage driver, computed purely from
weather, peaks Dec–Feb (×2.4–2.5). The report index, computed purely from 311,
peaks in March. Reports lag damage by about two months — which is exactly the
lag-2 maximum found above, arrived at from the other direction. The two halves
of the model agree without having been fitted to each other.

### Q3 — Lifecycle: well characterised, but it is the wrong lifecycle

Of 391,534 completed requests with usable durations:

```
p10     0 days      p50     6 days      p90    60 days
p25     1 day       p75    22 days      p99   160 days
mean   19.9 days
```

And a strong seasonal queue effect — median days-to-fill by month reported:

```
Jan  1    Feb  2    Mar  5    Apr  7    May 15    Jun 18
Jul 17    Aug 15    Sep 17    Oct 13    Nov  7    Dec  2
```

**This measures CDOT's work queue, not a pothole's physical growth.** January's
one-day median is pothole-blitz staffing; June's eighteen days is the same holes
waiting behind other work. The "death" recorded here is administrative.

One genuinely useful conversion factor: a request is a *block*, not a hole.
Median **7 potholes filled per block visit** (mean 13.8, p90 33).

### Q4 — Traffic: no usable signal

Counting requests within 250 m of each of 1,279 traffic counters:

```
                      r (raw)    r (log-log)   quintile lift
incidence (count)      +0.028      +0.047         1.22x
intensity (holes/block) -0.051     -0.076         1.00x
```

The literature says traffic propagates damage — Abed et al. (2023): *"Repeated
traffic loads deepen the depression by removing the fragmented stones."* That
suggested traffic might drive severity even if not incidence, so I tested
intensity separately using holes-per-block-visit. It does not: the median is 6.0
holes per block in **every** traffic quintile.

**The caveat is essential and cuts against reading this as "traffic doesn't
matter":** Chicago's ADT counters sit only on arterials. The 5th percentile is
already 5,200 vehicles/day. A residential side street at ~1,000 vehicles/day is
not in the sample at all. This tests arterial against arterial, never quiet
against busy.

So traffic is **left out of the model** — not because it is physically
irrelevant, but because fitting a coefficient to r = +0.03 would be fitting
noise and dressing it as knowledge.

---

## The model

```
ds/dD = k · s · (1 − s/100)
```

Severity grows logistically, not in calendar time but in **damage time**. One
month of January does ~2.4 months of damage; one month of July does essentially
none, because Chicago has no freeze-thaw days in July. Integrating the monthly
damage index between two dates gives damage-months *D*, and the logistic has a
closed form in *D*, so there is no numerical integration and no drift.

Logistic rather than exponential because a pothole is autocatalytic early — a
bigger hole pools more water and takes more impact energy per wheel — but cannot
grow without bound; it saturates when it spans the lane or reaches the base
layer.

### What is measured and what is assumed

| | |
|---|---|
| measured | the monthly freeze-thaw damage index (Chicago weather, 2011–2018) |
| measured | the 266-day median interval between repeat reports on one block |
| measured | repair latency, were anyone repairing (median 6 days) |
| **assumed** | that growth is logistic in damage time |
| **assumed** | that severity 40 → 80 is the span a re-report interval covers |

The last two are choices. **No published growth rate exists for untreated road
potholes** — I searched for one specifically, and the reason it does not exist is
that nobody instruments a hole and lets it run; it gets filled. This is the
model's weakest joint and it is deliberately exposed as a single parameter rather
than buried in code.

### The anchor, and its honest weakness

36.0% of Chicago blocks get reported more than once. The gap between consecutive
reports on one block:

```
p10  34 days     p25  80 days     p50  266 days     p75  539 days     p90  979 days
```

The median 266 days is a real Chicago timescale — repaired to complaint-worthy
again — but it is *not the same quantity* as one hole growing. It is the best
available anchor, not a good one.

`k = 0.2048` per damage-month, with the p25/p75 interval giving `k` from 0.1011
to 0.6809 — a **6.7× spread**, carried into every projection as a band rather
than averaged away. The map draws the band; the page says the line is "the
middle of it, not a prediction to bet on."

### What it concludes

A moderate pothole left through one unrepaired Chicago winter reaches severe.
Under the no-repair premise essentially the whole inventory saturates within
about twelve months. The *qualitative* conclusion is robust to the anchor
choice; the *timing* is not, which is why the band is wide and prominent.

---

## The map

The forecast map draws **real Chicago street centrelines** from the city's own
open data (Socrata `pr57-gg9e`), for a 930 m by 3.2 km strip running from
Halsted across the river into the Loop, with Union Station near its centre. 551
segments and 72 named streets, drawn at four stroke weights by street class so
the arterials read as arterials.

The synthetic potholes are placed **on** those segments rather than scattered
near them, sampled by segment length and weighted by class — so a pin on Canal
Street is on Canal Street, and the busiest streets in the generated set come out
as W Madison, W Van Buren, W Adams and S Halsted. Length weighting matters:
sampling segments uniformly piles holes onto short stubs near intersections,
because a 20 m connector draws as often as a 300 m block.

The window is deliberately wide and short, matching the panel it sits in. A
square geographic window inside a 3.45:1 frame leaves two thirds of the map
empty and shrinks the streets to a stamp in the middle — which is exactly what
the first version did.

The projection is fixed to the basemap's bounds, not to the visible potholes.
The set on screen changes on every scrubber step, and a frame that refit itself
each time would make the city drift while you were trying to read one block.

## Showing the mechanism

The forecast page draws the weather that drives the model, because the central
claim is counter-intuitive and easier to show than to assert: **water alone does
nothing.** Chicago gets more rain in July (102 mm normal) than in January
(53 mm), and July does no damage at all, because nothing crosses zero.

Scrubbing to a summer month gives the heaviest rain the animation can draw over
a fleet of potholes that does not move. Scrubbing to December gives snow, a cold
cast over the map, nine freeze-thaw days and a x2.37 damage multiplier, and the
severity starts climbing.

Each month reports the drivers in the order the mechanism runs — precipitation,
temperature range, freeze-thaw crossings, resulting damage multiplier — with the
freeze-thaw tile highlighted, since it is the only one the growth model actually
consumes. A freeze-thaw track sits under the composition chart on the same time
axis, so the winter bars line up with every step in the staircase.

**Past months use the weather Chicago actually had; future months use the
2011-2018 climatological normal, and the page labels which.** That is not a
shortcut. Q2 found freeze-thaw day counts do not rank winters by pothole volume,
so forecasting a *particular* winter would claim skill the data denies. Recorded
bars are solid; normal bars are hollow.

## Edge cases and failure modes

Ones that changed the implementation:

1. **"Unchecked" applies forward, never backward.** The first working version
   grew every pothole from its detection date, so a hole found two winters ago
   read as already saturated *today* — reporting the present city as far worse
   than the one we measured. Growth now starts at the forecast origin; before it,
   the model reports what was observed. This was caught by the map showing 230 of
   260 potholes already severe.
2. **Counting only what had been found.** The fleet roll-up initially counted
   every pothole at every historical month, drawing today's inventory as though
   it had always been known and flattening the seasonal accumulation that is the
   study's most solid finding. Now nothing is counted before its detection date.
3. **A fixed map projection.** The cluster map on the dashboard fits its frame to
   the clusters it is given, which is right for a filtering table. Here the
   visible set changes on every scrubber step, so the projection is computed once
   over the whole dataset and held — otherwise the city drifts while you read it.
4. **Logistic fixed points.** Severity 0 and severity 100 both divide by zero in
   the odds-ratio form; a cluster detected at 100 forecast `NaN` and vanished from
   the map. Both ends now return directly, and `Math.exp` overflow saturates to
   the cap instead of producing `Infinity`.
5. **The 2018 schema change.** Chicago replaced its 311 system in December 2018.
   Spanning it would put a reporting-process change mid-series and read it as a
   change in the roads. The window stops at 2018-12-31.
6. **Duplicate reports.** 29.4% of rows, removed — see above.

Ones that remain, and cannot be fixed from here:

7. **Left truncation.** We know when a phone first *felt* a hole, never when the
   hole began. Every curve starts mid-story. 311 has the identical blind spot.
8. **Survivorship.** We only ever observe potholes that were reported. The ones
   that grew unchecked in places nobody calls from are precisely the ones absent
   from the calibration data — and precisely the ones the model claims to
   describe.
9. **Repair is not death.** A filled pothole frequently reopens; a bad patch
   fails faster than virgin asphalt. The 266-day re-report interval partly
   measures patch quality, not road quality.
10. **Winter reporting suppression.** Snow hides holes and nobody stops to report
    one in a blizzard. Part of the Dec→Mar lag is melt revealing damage, not
    damage forming.
11. **Salt moves the freeze point.** The 0 °C threshold for a freeze-thaw day is
    wrong on a treated road, and Chicago treats its arterials heavily — the same
    roads the traffic counters sit on.
12. **Our severity is not depth.** It is an IMU-derived score. Mapping it onto a
    physical growth law assumes it rises monotonically with the hole's actual
    size, which is untested.
13. **Synthetic locations.** The 260 potholes on the forecast map are generated.
    Their *timing* is driven by the measured damage index and real per-winter
    freeze-thaw counts (the observed 35–96 range); their *places* are invented.
    The page says so in a banner.

---

## Sources

- [Chicago 311 Pot Holes Reported](https://data.cityofchicago.org/Service-Requests/311-Service-Requests-Pot-Holes-Reported-Historical/7as2-ds3y)
- [Chicago Average Daily Traffic Counts](https://data.cityofchicago.org/Transportation/Average-Daily-Traffic-Counts/pfsx-4n4m)
- [Open-Meteo ERA5 archive](https://open-meteo.com/en/docs/historical-weather-api)
- Abed, Rahman, Thom, Hargreaves, Li & Airey (2023), [Analysis and Prediction of Pothole Formation Rate Using Spatial Density Measurements and Pavement Condition Indicators](https://doi.org/10.1177/03611981231166684), *Transportation Research Record*
- [Pavement performance modeling](https://en.wikipedia.org/wiki/Pavement_performance_modeling) — wet-freeze climates deteriorate up to 2× faster
- [Freeze-thaw weathering and degradation of road pavements](https://www.tensarcorp.com/resources/articles/freeze-thaw-weathering-and-degradation-the-effect-on-road-pavements)
