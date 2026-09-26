# How Potholo decides something is a pothole

The phone sends raw motion and location. Every decision is made in the API, so
the model can be retuned across the whole fleet without shipping an app update,
and old trips can be re-analysed when the thresholds improve.

The pipeline is seven stages. The first four turn a stream of numbers into one
suspected strike; the last three decide whether anyone should be told about it.

---

## 1. Find "up" without being told where it is

The phone is in a cupholder, a pocket or a vent mount, at an unknown angle, and
it slides around during the drive. No stage may assume an axis points anywhere.

Gravity is re-estimated continuously as a **rolling median** of each axis over
4 seconds, and the dynamic vertical acceleration is the projection onto it:

```
up      = median₄ₛ(a) / |median₄ₛ(a)|
a_vert  = a · up − |median₄ₛ(a)|
a_lat   = |a − (a · up) up|
```

A median rather than a low-pass filter, deliberately: a pothole strike is a
large, short outlier, and a linear filter lets it drag the gravity estimate —
corrupting the very samples the estimate exists to interpret.

The same quantity calibrates the sensor. A phone's accelerometer carries a few
percent of scale error, and its resting `|g|` has to read 9.80665, so the ratio
is a free per-device correction. On the 2024-11-29 recording it reads **9.45**,
a 3.8% error that would otherwise have gone straight into every severity.

## 2. Keep only the band a pothole lives in

A 2–20 Hz Butterworth band-pass, applied **causally**.

- **Below 2 Hz** is the car's sprung mass rocking on its springs — hills,
  braking, ordinary ride motion. On the real drive this is where 74% of the
  vertical energy sits, peaking at **1.1–1.5 Hz**, the textbook body-bounce
  frequency.
- **Above 20 Hz** is tyre and engine hash plus the phone rattling in its holder.
- **Between them**, around **8–15 Hz**, the unsprung mass (wheel and hub) rings
  when it is struck. That ring is the pothole.

Causal (`sosfilt`) rather than zero-phase (`sosfiltfilt`), at a cost of about
30 ms of group delay. Zero-phase filtering runs the filter backwards as well as
forwards, so it smears energy **before** the event that caused it: a purely
upward kick — a raised expansion joint, a rail lip — comes out with a negative
lobe in front of it, measured at about **15% of the peak**. That is
indistinguishable from the drop preceding a real pothole strike, and it made the
detector report every bridge joint on the route. A causal filter cannot produce
output before its input, so a drop the shape test finds is only ever a real one.
It is also what an on-device implementation must use, so the offline and
streaming versions now behave identically.

The **shape test** reads a wider band, 1–20 Hz. A long crater unloads the
suspension slowly — a 1.4 m hole at 11 m/s falls for 130 ms, around 4 Hz — and a
2 Hz corner flattens that drop while leaving the 11 Hz strike untouched.

## 3. Score against the road you are on, not a fixed number

A fixed threshold either misses potholes on smooth asphalt or flags every metre
of bad pavement. Instead each sample is scored against a 10-second local
baseline, in the style of a radar CFAR detector:

```
z(t) = (x(t) − median₁₀ₛ) / (1.4826 · MAD₁₀ₛ)
```

The bar rises on rough roads by construction, so what gets reported is a defect
that stands out **from its surroundings** — which is what a road crew is
actually looking for. The MAD is floored so a perfectly smooth stretch cannot
turn sensor noise into infinite scores.

## 4. Check the shape: quiet, then a drop, then a strike

This is the step that separates a pothole from everything else that also ends in
a bang, and it follows from the sign convention.

An accelerometer reads **+g along "up"** at rest. So when a wheel drops into a
hole the body unloads first and `a_vert` goes **negative** — bounded at about
**−1 g**, because a wheel cannot fall faster than gravity. Only then does it
strike the far edge, which has no such bound and throws `a_vert` sharply
**positive**.

The real drive contains a textbook example at t = 347.8 s:

```
+0.78  +0.19  −1.99  −1.41  +1.25  +1.55     m/s²
              └── drop ──┘   └── strike ──┘
```

and the synthetic equivalent at 100 Hz, where the bound on the drop is visible:

```
−4.57  −8.24  −9.64  −6.05  +2.72  +12.93  +18.67     m/s²
       └──── drop, floors near −1 g ────┘   └─ strike, unbounded ─┘
```

Three things had to be got right here. Each was wrong first, and each was caught
by the synthetic fleet rather than by reasoning about it.

**Anchor on the strike, not on an "onset".** Between the drop and the strike the
signal passes through zero — it must, they have opposite signs. A walk-back that
follows a contiguous run above a threshold stops dead at that crossing, sees only
the strike, and calls every pothole a bump. Whether it happened to stop depended
on where the crossing sample landed, which is to say **on the vehicle's speed**:
the same pothole was found at 9, 13 and 16 m/s and missed at 11.

**The drop threshold is absolute, not a fraction of the strike.** The drop cannot
exceed 1 g however bad the hole is; the strike has no ceiling and grows with
depth and speed. Scaling the requirement to the strike therefore gets *stricter*
exactly as the pothole gets worse — an 18 cm crater threw a 44 m/s² strike behind
a 5 m/s² drop and was discarded for having too small a drop, while gentler holes
passed. The bar is now a flat 1.5 m/s², about 15% of g.

**A drop before a strike is not enough, because a speed bump ends the same way.**
The wheel is lifted, goes light over the crest, and comes down hard — drop then
strike, exactly like a pothole. What differs is what happened *before* the drop.
A pothole is preceded by quiet road; a bump is preceded by the lift that put the
wheel up there, and a raised joint by the kick off its leading edge. So the test
is **quiet, drop, strike**, and a preceding positive excursion above 0.3 × the
drop vetoes it.

That look-back has to reach outside the event window. One physical bump raises
several detection peaks, and the later ones begin *after* the lift — a look-back
clipped to the window finds nothing and passes the bump through as a pothole.

Three gates then reject shocks the *vehicle* caused rather than the road:
speed outside 4–35 m/s, yaw rate above 0.9 rad/s (cornering), or lateral
acceleration above 6 m/s² (braking or swerving).

### The axle echo

A vehicle hits the same hole once per axle: twice for a car, **five times for a
tractor-trailer** whose axles span 13 m. Strikes within 15 m of travel are one
defect — measured in metres rather than seconds so it holds at any speed, and set
just past the longest legal axle spread. Two holes closer than the 12 m cluster
radius land in the same cluster whatever we do here.

The group is judged by its **leading** strike. Only the first axle meets the
feature with undisturbed road behind it; every axle after it is preceded by the
one in front still ringing, and that ring reads as the lift that marks a speed
bump. Judging a group by its worst verdict instead threw away every pothole a
semi or a bus ever hit, because their trailing axles always look like bumps.

A residual bias worth knowing about: the phone rides in the cab, so a strike
under a trailer axle is recorded at the cab's position, **up to 13 m past the
hole**. Merging keeps it to one detection but cannot recover where the wheel was.

## 5. Severity that survives being measured by a different phone

Severity comes from the **strike impulse** — the integral of the strike lobe
alone, from the zero crossing before the peak to the one after:

```
Δv = ∫ a_vert dt   over the strike lobe   [m/s]
```

An integral rather than a peak because it barely moves when the sample rate or
filter band changes, which is what makes readings from different phone models
comparable at all. The ringing that follows is excluded on purpose: summing it
measures how bouncy the car is, not how hard it was hit.

On the synthetic 8 cm pothole the pipeline recovers **Δv = 0.52 m/s** against
the generator's physical **0.58 m/s**.

**Speed normalisation is an empirical knob, not a derived law**, and the code
says so. The wheel is unsupported for `L/v` seconds, so a faster car drops
*less* far into the hole, while the strike on the far edge gets *harder* with
speed. The two effects pull in opposite directions and the balance depends on
the hole's geometry. A power law with exponent 1.0 is the current default; both
raw measurements are stored on every detection, so the normalisation can be
re-fitted from labelled ground truth without reprocessing a single trip.

## 6. Put it on the map honestly

The IMU runs at 100 Hz and GPS at about 1 Hz, so an impact almost never
coincides with a fix. Position is interpolated between the two surrounding
fixes; taking the nearest one instead can be out by 15 m at 40 mph, which is the
difference between two potholes and one. The reported error radius includes how
far the car travelled between fixes rather than hiding it.

## 7. Confirmation across vehicles — the part that makes it trustworthy

This is what a self-reporting form cannot do at all.

One car flagging one shock proves very little: the driver may have clipped a
kerb, the phone may have slid off the seat. Detections within **12 m** are
clustered, and a cluster is only **confirmed** when

| | threshold |
| --- | --- |
| distinct devices | ≥ 3 |
| detections | ≥ 4 |
| hit rate | ≥ 35% |

**Two counts are tracked, not one.** `detections` is how many vehicles hit
something here; `passes` is how many vehicles drove over this spot at all,
recorded from every trip's GPS track whether or not it detected anything. Their
ratio is the useful signal — ranking by raw detection count just ranks by
traffic volume, which would send crews to Lake Shore Drive and never to a side
street.

Five trips from one phone stay a candidate forever. That is intentional.

---

## What the evidence says

Reproduce all of this with `python data/analysis/validate.py`.

**Detection rate** — 8 random phone orientations per cell, 100 Hz:

| pothole | 7 m/s | 11 m/s | 16 m/s |
| --- | --- | --- | --- |
| shallow (3 cm) | 100% | 100% | 100% |
| moderate (6 cm) | 100% | 100% | 100% |
| deep (10 cm) | 100% | 100% | 100% |

**False positives** — 7.9 km per row, no pothole present:

| pavement | false positives |
| --- | --- |
| ordinary | 0 |
| poor | 0 |
| very poor | 0 |

The adaptive threshold is what holds the last row at zero: rough pavement raises
its own bar instead of generating a report every few metres.

**The scenario catalogue** — 31 labelled test and edge cases across four vehicle
classes, run by `python mock/seed_db.py --reset`. 26 of 27 scored cases pass and
4 are recorded without an asserted answer. See `docs/synthetic-fleet.md`.

## Why the phone must sample at 100 Hz

The 2024-11-29 rig logged at **8.34 Hz** — `delay(100)` plus I²C and serial
overhead, giving a 119.8 ms period. Nyquist is therefore **4.17 Hz**, and the
8–15 Hz wheel-hop ring where a strike actually lives is **above it**. The rig
could see the car's body rocking; it could not see a pothole.

The same 8 cm pothole, sampled at different rates (the signal is synthesised at
500 Hz and decimated without an anti-alias filter, so low rates alias exactly as
a sketch reading the register once per loop would):

| rate | detected | severity | dv (m/s) | |
| --- | --- | --- | --- | --- |
| 200 Hz | 1 | 64.2 | 0.420 | |
| 100 Hz | 1 | 63.1 | 0.408 | |
| 50 Hz | 1 | 42.6 | 0.227 | severity understated by a third |
| 25 Hz | 0 | — | — | missed entirely |
| 12.5 Hz | 1 | 27.3 | 0.132 | aliased |
| 8.34 Hz | 1 | 76.8 | 0.600 | aliased, and now *over*-reads |

Below 50 Hz the result stops being wrong in a predictable direction and simply
becomes erratic — 25 Hz loses the pothole altogether, while the rig's own
8.34 Hz reports it as worse than it is. Aliasing does not attenuate a signal
politely; it folds it somewhere unpredictable.

100 Hz reads the same as 200 Hz, so 100 Hz is enough — and it is what
`SENSOR_DELAY_FASTEST` gives on essentially every Android handset, with iOS
`CMMotionManager` matching it. Below 50 Hz severity is understated by a third or
more, and at the rig's own rate one pothole fragments into three detections with
half the true impulse.

Running the real drive through the detector produces the warning and no
detections, which is the correct answer for that data rather than a failure:

```
WARNING: sample rate 8.3 Hz puts the 8-15 Hz wheel-hop resonance above
Nyquist (4.2 Hz); impact peaks are attenuated and aliased -- sample at >=100 Hz
```

## Filing with CDOT

Chicago runs an Open311 (GeoReport v2) endpoint, so a confirmed cluster can be
filed directly instead of through the public web form:

| | |
| --- | --- |
| production | `http://311api.cityofchicago.org/open311/v2` |
| test | `http://test311api.cityofchicago.org/open311/v2` |
| service code | `4fd3b656e750846c53000004` — Pothole in Street Complaint (PHF) |
| alley variant | `5c1849ce9e6e99eda0adada2` — Alley Pothole Complaint (PHB) |
| required attribute | `FQ62961` — Traffic Lane, Curb Lane, Intersection, Bike Lane, Bus Stop, Crosswalk, Center Lane |
| optional attribute | `FQ62962` — free text |

**Nothing is filed automatically.** `submit()` is inert unless a caller passes
both an API key and `confirm=True`, it defaults to the City's test endpoint, and
it refuses the production endpoint outright. Every service request opens a work
order against a real crew's queue, so a detector that files its own reports
would be putting unverified data in front of people with shovels.

Lane selection is currently operator-supplied, defaulting to Traffic Lane.
Inferring it properly needs a join against Chicago's street centreline data on
the open data portal; the detector does not guess.
