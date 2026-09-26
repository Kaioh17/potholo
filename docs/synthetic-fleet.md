# The synthetic fleet

`mock/` generates the readings a phone would produce in a sedan, an SUV, a
tractor-trailer and a transit bus, across a catalogue of test and edge cases.
Seeding the database with it is also an evaluation run.

```bash
python mock/vehicles.py                 # the derived quarter-car parameters
python mock/seed_db.py --reset          # run every scenario, populate the map
```

Nothing mock-specific enters the service. Batches are built in exactly the wire
format a phone sends, validated by the same `SensorBatch` schema the HTTP route
uses, and persisted through the same `process_batch` and repository calls, so
swapping these payloads for real uploads changes nothing downstream.

## Why vehicle class matters

Every number comes from a quarter-car model rather than being tuned by hand:

```
ride rate    kr = ks·kt / (ks + kt)
body bounce  f_body  = sqrt(kr / ms) / 2π
wheel hop    f_wheel = sqrt((ks + kt) / mu) / 2π
```

| | body | wheel hop | axles | strike transfer | wheel radius |
| --- | --- | --- | --- | --- | --- |
| sedan | 1.25 Hz | 11.18 Hz | 2 | 1.00 | 0.32 m |
| SUV | 1.18 Hz | 10.48 Hz | 2 | 0.90 | 0.37 m |
| semi | 1.67 Hz | 11.69 Hz | 5 | 0.47 | 0.52 m |
| bus | 1.43 Hz | 9.45 Hz | 2 | 0.74 | 0.50 m |

The sedan's 1.25 Hz falls out of its masses and spring rates alone, and lands
inside the **1.1–1.5 Hz** measured on the real 2024-11-29 drive. The two were
derived independently, which is the main reason to trust the rest of the table.

Three consequences, each of which the detector had to be changed to survive.

### Amplitude: a truck feels half of what a car feels

A semi's cab sits on its own air suspension and its sprung mass is ten times a
car's, so the same strike arrives at the phone at roughly half strength.
Measured on the identical 8 cm pothole:

| vehicle | Δv | severity |
| --- | --- | --- |
| sedan | 0.483 m/s | 69 |
| SUV | 0.438 m/s | 65 |
| bus | 0.433 m/s | 72 |
| **semi** | **0.242 m/s** | **47** |

Both vehicles *find* the hole. The truck under-rates it by half. Until severity
is calibrated per vehicle this is a known bias in any truck-heavy sample, and it
is pinned by `test_truck_under_rates_the_same_pothole`.

### Geometry: big wheels bridge small holes

A wheel of radius R crossing a gap of length L cannot drop further than
`R − √(R² − (L/2)²)` before its rim catches the far edge. How far each wheel
actually falls into an 8 cm hole:

| hole length | sedan | SUV | semi | bus |
| --- | --- | --- | --- | --- |
| 0.25 m | 2.5 cm | 2.2 cm | 1.5 cm | 1.6 cm |
| 0.40 m | 7.0 cm | 5.9 cm | 4.0 cm | 4.2 cm |
| 0.60 m | 8.0 cm | 8.0 cm | 8.0 cm | 8.0 cm |

So commercial vehicles systematically under-report short defects — not because
the detector misses them, but because the wheel never enters the hole.

### Axle count: one hole, up to five strikes

A car hits a hole twice. A tractor-trailer hits it five times over 13 m. If
those are counted separately, one vehicle looks like five independent witnesses
and the confirmation maths collapses. See "The axle echo" in
`detection-model.md`.

## What the fleet caught

These are real defects the synthetic data found in the detector. All were
introduced by reasoning that seemed sound at the time.

| what was wrong | how it showed up |
| --- | --- |
| The onset walk-back stopped at the zero crossing between drop and strike | The **baseline** sedan pothole was found at 9, 13 and 16 m/s and **missed at 11** |
| Zero-phase filtering smears a negative lobe *before* a positive kick | Every bridge joint and rail lip reported as a pothole |
| The drop threshold was a fraction of the strike | An 18 cm **crater** was discarded for having "too small" a drop while gentler holes passed |
| The 2 Hz corner flattened slow drops | Long craters lost the very drop the shape test needs |
| The bump look-back was clipped to the event window | The later of a bump's several peaks never saw the lift |
| Axle groups judged by their worst verdict | Every pothole a semi or bus hit was thrown away |
| Hit rate divided strikes by passes | One semi reported a **200% hit rate** |
| Corridor potholes pinned to a timestamp | At different speeds each vehicle hit them in a different place, so nothing clustered |

The last one is a bug in the *generator*, not the detector, and worth stating
plainly: a pothole does not move, so it has to be specified by position and
converted to a time per vehicle.

## The catalogue

31 scenarios in `mock/scenarios.py`, laid out on separate streets so one case's
cluster cannot contaminate another's. Current state: **27 of 27 scored cases
pass**, 4 recorded without an asserted answer.

| category | covers |
| --- | --- |
| `baseline` | the same pothole under all four vehicles |
| `severity` | 3 cm worn patch through to an 18 cm crater |
| `speed` | 3 m/s car park, 20 / 36 / 56 mph |
| `geometry` | wheel bridging, 5-axle spread, 6 m wheelbase |
| `not_a_pothole` | speed humps (per vehicle), expansion joints, rail crossings, sunken covers |
| `driver` | hard braking, sharp cornering, phone picked up, stopped at a light |
| `environment` | rough unpaved, GPS dropout, 40 m urban-canyon GPS, 50 Hz handset, the 8.34 Hz rig |

Four scenarios carry no expected answer, because the right one is genuinely
arguable and inventing a label would only prove the detector agrees with the
guess:

- **sedan-shallow** — a 3 cm defect. Worn pavement, or a pothole?
- **sedan-short-hole** — 2.5 cm of reachable depth. Below what a crew would fill.
- **sedan-sunken-manhole** — a real defect, but 311 files it as a utility cut.
- **sedan-arduino-rate** — at 8.34 Hz the reading is aliased, so any answer is luck.

These are stored with `outcome = "observed"` and reported separately rather than
being scored.

## What gets written

| table | contents |
| --- | --- |
| `scenario_runs` | one row per scenario: what was expected, what was observed, the ground truth and the detections as JSON |
| `pothole_detections` | every strike, including the edge cases |
| `pothole_clusters` | cross-checked locations |
| `cluster_passes` | every trip that drove over a cluster, hit or not |

The corridor adds ten mixed vehicles and six clean trips over three potholes at
fixed positions, which is what produces confirmed clusters for the map:

```
(41.87410, -87.62809)  10 detections / 10 devices / 16 passes -> 62% hit rate, severity 73
(41.87410, -87.62616)  10 detections / 10 devices / 16 passes -> 62% hit rate, severity 54
(41.87410, -87.62398)  10 detections / 10 devices / 16 passes -> 62% hit rate, severity 85
```

Severity tracks depth (0.06 m, 0.11 m, 0.15 m) in the right order, and the hit
rate sits at 62% rather than 100% because the six clean trips are counted in the
denominator — which is the entire point of counting passes.

## Honest limits of the mock

- Axle strikes are **added linearly**. Real suspensions are non-linear, and a
  wheel already unloaded behaves differently from one at rest.
- `strike_transfer` is a single scalar standing in for the cab suspension, the
  seat and the mount. A real cab has its own resonance.
- Road roughness is fitted to **one** vehicle on **one** Chicago drive. Whether
  the sedan's 0.20 m/s² generalises is unmeasured.
- The masses and spring rates are textbook values for each class, not
  measurements of specific vehicles.

None of this is a substitute for real multi-vehicle data. It is a way to find
the failures worth fixing before that data exists — which, on the evidence of
the table above, it did.
