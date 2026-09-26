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

A 2–20 Hz Butterworth band-pass, applied zero-phase.

- **Below 2 Hz** is the car's sprung mass rocking on its springs — hills,
  braking, ordinary ride motion. On the real drive this is where 74% of the
  vertical energy sits, peaking at **1.1–1.5 Hz**, the textbook body-bounce
  frequency.
- **Above 20 Hz** is tyre and engine hash plus the phone rattling in its holder.
- **Between them**, around **8–15 Hz**, the unsprung mass (wheel and hub) rings
  when it is struck. That ring is the pothole.

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

## 4. Check the shape: a drop, then a strike

This is the step that separates a pothole from a speed bump, and it follows
from the sign convention.

An accelerometer reads **+g along "up"** at rest. So when a wheel drops into a
hole the body unloads first and `a_vert` goes **negative** — bounded at about
**−1 g**, because a wheel cannot fall faster than gravity. Only then does it
strike the far edge, which has no such bound and throws `a_vert` sharply
**positive**. A speed bump or a manhole cover lifts the wheel first and produces
the same two lobes **in the opposite order**.

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

**The ordering must be read from the onset, not from the window extremes.** A
strike rings the suspension for several cycles, so the largest negative sample
in a window is usually a *later lobe of that ring*, not the initial unloading.
Taking `argmin`/`argmax` over the whole window reads the sequence backwards and
classifies every pothole as a speed bump — it did, until the detector was
changed to walk back to where the disturbance began.

Three gates then reject shocks the *vehicle* caused rather than the road:
speed outside 4–35 m/s, yaw rate above 0.9 rad/s (cornering), or lateral
acceleration above 6 m/s² (braking or swerving).

### The axle echo

A car hits the same hole twice, front axle then rear, separated by
`wheelbase / speed` — about 0.25 s at 11 m/s. The pair is merged into one
detection, and its presence is corroborating evidence: a phone knocked off a
seat does not produce a second strike at exactly the wheelbase interval.

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
| moderate (6 cm) | 100% | 100% | 88% |
| deep (10 cm) | 100% | 100% | 100% |

**False positives** — 7.9 km per row, no pothole present:

| pavement | false positives |
| --- | --- |
| ordinary | 0 |
| poor | 0 |
| very poor | 0 |

The adaptive threshold is what holds the last row at zero: rough pavement raises
its own bar instead of generating a report every few metres.

## Why the phone must sample at 100 Hz

The 2024-11-29 rig logged at **8.34 Hz** — `delay(100)` plus I²C and serial
overhead, giving a 119.8 ms period. Nyquist is therefore **4.17 Hz**, and the
8–15 Hz wheel-hop ring where a strike actually lives is **above it**. The rig
could see the car's body rocking; it could not see a pothole.

The same 8 cm pothole, sampled at different rates (the signal is synthesised at
500 Hz and decimated without an anti-alias filter, so low rates alias exactly as
a sketch reading the register once per loop would):

| rate | detected | severity | Δv (m/s) | |
| --- | --- | --- | --- | --- |
| 200 Hz | 1 | 73.4 | 0.541 | |
| 100 Hz | 1 | 71.1 | 0.507 | |
| 50 Hz | 1 | 50.7 | 0.288 | severity understated |
| 25 Hz | 1 | 54.4 | 0.324 | |
| 12.5 Hz | 1 | 31.4 | 0.154 | aliased |
| 8.34 Hz | 3 | 39.1 | 0.203 | aliased, fragmented into three |

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
