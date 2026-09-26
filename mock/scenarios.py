"""A labelled catalogue of what the detector will meet on Chicago streets.

Each scenario states what *should* happen, so seeding the database doubles as an
evaluation run: the seeder compares `expect_potholes` against what the real
pipeline actually produced and reports the disagreements.

Where the right answer is genuinely arguable -- a manhole cover sunk two
centimetres below grade is a real defect, but it is not a pothole -- the
expectation is left as None and the scenario is recorded for observation rather
than scored. Inventing a label there would only teach us that the detector
agrees with whatever we guessed.

Scenarios are laid out on separate east-west streets a few hundred metres apart
so that one case's cluster cannot contaminate another's.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from phone import DriverAction, RoadEvent
from vehicles import BUS, SEDAN, SEMI, SUV, Vehicle

BASE_LAT, BASE_LON = 41.8781, -87.6298
STREET_SPACING_DEG = 0.0025  # ~280 m between scenarios


@dataclass
class Scenario:
    name: str
    category: str  # baseline | severity | speed | geometry |
    # not_a_pothole | driver | environment
    description: str
    vehicle: Vehicle = SEDAN
    speed: float = 11.0
    duration_s: float = 40.0
    fs: float = 100.0
    roughness: float = 1.0
    events: list[RoadEvent] = field(default_factory=list)
    actions: list[DriverAction] = field(default_factory=list)
    gps_accuracy: float = 8.0
    gps_dropout: tuple[float, float] | None = None
    expect_potholes: int | None = 0
    why: str = ""

    def location(self, index: int) -> tuple[float, float]:
        return BASE_LAT + index * STREET_SPACING_DEG, BASE_LON


def _hole(t: float = 20.0, depth: float = 0.08, length: float = 0.60) -> RoadEvent:
    return RoadEvent("pothole", t, depth_m=depth, length_m=length)


CATALOGUE: list[Scenario] = [
    # ----------------------------------------------------------------- baseline
    Scenario(
        "sedan-pothole",
        "baseline",
        "Mid-size car over an 8 cm pothole at 25 mph.",
        vehicle=SEDAN,
        events=[_hole()],
        expect_potholes=1,
        why="The reference case everything else is compared against.",
    ),
    Scenario(
        "suv-pothole",
        "baseline",
        "SUV over the identical pothole.",
        vehicle=SUV,
        events=[_hole()],
        expect_potholes=1,
        why="Heavier and taller, but still a two-axle vehicle on the body.",
    ),
    Scenario(
        "semi-pothole",
        "baseline",
        "Loaded tractor-trailer over the identical pothole.",
        vehicle=SEMI,
        speed=10.0,
        events=[_hole()],
        expect_potholes=1,
        why="Cab air suspension halves the strike; five axles hit one hole.",
    ),
    Scenario(
        "bus-pothole",
        "baseline",
        "Transit bus over the identical pothole.",
        vehicle=BUS,
        speed=9.0,
        events=[_hole()],
        expect_potholes=1,
        why="Air-sprung, 6 m wheelbase, so the second strike arrives late.",
    ),
    # ----------------------------------------------------------------- severity
    Scenario(
        "sedan-shallow",
        "severity",
        "Shallow 3 cm defect, the boundary of what is worth reporting.",
        events=[_hole(depth=0.03, length=0.35)],
        expect_potholes=None,
        why="Arguably just worn pavement; recorded rather than scored.",
    ),
    Scenario(
        "sedan-deep",
        "severity",
        "Deep 12 cm pothole.",
        events=[_hole(depth=0.12, length=0.90)],
        expect_potholes=1,
    ),
    Scenario(
        "sedan-crater",
        "severity",
        "18 cm crater, the kind that bends a rim.",
        events=[_hole(depth=0.18, length=1.40)],
        expect_potholes=1,
        why="Must saturate severity, not overflow or misclassify.",
    ),
    # -------------------------------------------------------------------- speed
    Scenario(
        "sedan-residential",
        "speed",
        "Same pothole at 20 mph.",
        speed=9.0,
        events=[_hole()],
        expect_potholes=1,
    ),
    Scenario(
        "sedan-arterial",
        "speed",
        "Same pothole at 36 mph.",
        speed=16.0,
        events=[_hole()],
        expect_potholes=1,
    ),
    Scenario(
        "sedan-highway",
        "speed",
        "Same pothole at 56 mph.",
        speed=25.0,
        events=[_hole()],
        expect_potholes=1,
        why="Less time in the hole, but a harder strike on the far edge.",
    ),
    Scenario(
        "sedan-parking-lot",
        "speed",
        "Crawling over a pothole at 3 m/s in a car park.",
        speed=3.0,
        events=[_hole()],
        expect_potholes=0,
        why="Below the speed gate: kerbs and ramps dominate down here.",
    ),
    # ----------------------------------------------------------------- geometry
    Scenario(
        "sedan-short-hole",
        "geometry",
        "Short 25 cm pothole: a car wheel drops into it.",
        events=[_hole(depth=0.08, length=0.25)],
        expect_potholes=None,
    ),
    Scenario(
        "semi-short-hole",
        "geometry",
        "The same 25 cm pothole under a 22.5 inch truck wheel.",
        vehicle=SEMI,
        speed=10.0,
        events=[_hole(depth=0.08, length=0.25)],
        expect_potholes=1,
        why="It is felt, but the wheel bridges most of it: 1.5 cm of a "
        "2.5 cm drop, and roughly half the sedan's impulse. Trucks "
        "detect small defects; they under-rate them.",
    ),
    Scenario(
        "semi-long-hole",
        "geometry",
        "Tractor-trailer over a 1.4 m crater: five axles, one defect.",
        vehicle=SEMI,
        speed=10.0,
        duration_s=45.0,
        events=[_hole(depth=0.15, length=1.40)],
        expect_potholes=1,
        why="Five strikes spread over 1.3 s must not become five potholes.",
    ),
    Scenario(
        "bus-long-wheelbase",
        "geometry",
        "Bus over one pothole: axles 6 m apart.",
        vehicle=BUS,
        speed=9.0,
        events=[_hole(depth=0.10, length=0.90)],
        expect_potholes=1,
        why="0.67 s between strikes, well outside a car's axle spacing.",
    ),
    # ----------------------------------------------------------- not a pothole
    Scenario(
        "sedan-speed-bump",
        "not_a_pothole",
        "Car over a speed hump at 18 mph.",
        speed=8.0,
        events=[RoadEvent("speed_bump", 20.0, height_m=0.09, length_m=3.0)],
        expect_potholes=0,
        why="Lifts the wheel first. The single most important rejection.",
    ),
    Scenario(
        "suv-speed-bump",
        "not_a_pothole",
        "SUV over the same hump.",
        vehicle=SUV,
        speed=8.0,
        events=[RoadEvent("speed_bump", 20.0, height_m=0.09, length_m=3.0)],
        expect_potholes=0,
    ),
    Scenario(
        "bus-speed-bump",
        "not_a_pothole",
        "Bus over the same hump, both axles.",
        vehicle=BUS,
        speed=7.0,
        events=[RoadEvent("speed_bump", 20.0, height_m=0.09, length_m=3.0)],
        expect_potholes=0,
    ),
    Scenario(
        "sedan-expansion-joints",
        "not_a_pothole",
        "Three raised bridge joints in a row.",
        speed=14.0,
        events=[RoadEvent("joint", t, height_m=0.02) for t in (18.0, 21.0, 24.0)],
        expect_potholes=0,
        why="Regular, raised and repeated: infrastructure, not damage.",
    ),
    Scenario(
        "sedan-rail-crossing",
        "not_a_pothole",
        "Level crossing: two rail lips 1.5 m apart.",
        speed=10.0,
        events=[
            RoadEvent("rail_crossing", 20.0, height_m=0.035),
            RoadEvent("rail_crossing", 20.15, height_m=0.035),
        ],
        expect_potholes=0,
    ),
    Scenario(
        "sedan-sunken-manhole",
        "not_a_pothole",
        "Utility cover sitting 3 cm below grade.",
        events=[RoadEvent("manhole", 20.0, depth_m=0.03, length_m=0.70)],
        expect_potholes=None,
        why="A real defect, but 311 files it as a utility cut, not a pothole.",
    ),
    # ------------------------------------------------------------------- driver
    Scenario(
        "sedan-hard-braking",
        "driver",
        "Emergency stop, no road defect present.",
        actions=[DriverAction("brake", 18.0, duration_s=2.5, magnitude=1.6)],
        expect_potholes=0,
        why="Pitches the body hard; must be gated by lateral acceleration.",
    ),
    Scenario(
        "sedan-sharp-corner",
        "driver",
        "Hard turn at an intersection.",
        actions=[DriverAction("corner", 18.0, duration_s=3.0, magnitude=1.2)],
        expect_potholes=0,
        why="Yaw rate gate: a turn is not a strike.",
    ),
    Scenario(
        "sedan-phone-handled",
        "driver",
        "Driver picks the phone up and puts it back.",
        actions=[DriverAction("handle_phone", 18.0, duration_s=3.0, magnitude=1.3)],
        expect_potholes=0,
        why="The worst false-positive source in any phone-based system.",
    ),
    Scenario(
        "sedan-stopped-at-light",
        "driver",
        "Stops at a red light, idles, pulls away.",
        actions=[DriverAction("stop", 15.0, duration_s=3.0)],
        expect_potholes=0,
    ),
    # -------------------------------------------------------------- environment
    Scenario(
        "sedan-rough-unpaved",
        "environment",
        "Badly broken pavement with no single defect.",
        roughness=4.0,
        expect_potholes=0,
        why="The adaptive threshold must raise its own bar here.",
    ),
    Scenario(
        "sedan-rough-with-hole",
        "environment",
        "One real pothole in the middle of badly broken pavement.",
        roughness=3.0,
        events=[_hole(depth=0.12, length=0.90)],
        expect_potholes=1,
        why="It must still stand out from a noisy background.",
    ),
    Scenario(
        "sedan-gps-dropout",
        "environment",
        "GPS drops out for 8 s, covering the impact.",
        events=[_hole()],
        gps_dropout=(16.0, 24.0),
        expect_potholes=1,
        why="Position must be extrapolated with an honest error bar.",
    ),
    Scenario(
        "sedan-urban-canyon",
        "environment",
        "Downtown GPS with 40 m accuracy.",
        events=[_hole()],
        gps_accuracy=40.0,
        expect_potholes=1,
        why="Detected fine, but the location is too poor to cluster on.",
    ),
    Scenario(
        "sedan-older-phone-50hz",
        "environment",
        "Older handset reporting at 50 Hz.",
        fs=50.0,
        events=[_hole()],
        expect_potholes=1,
        why="Works, but severity reads low: 50 Hz clips the wheel-hop band.",
    ),
    Scenario(
        "sedan-arduino-rate",
        "environment",
        "The 2024-11-29 rig's 8.34 Hz, for comparison.",
        fs=8.34,
        events=[_hole()],
        expect_potholes=None,
        why="Below Nyquist for a strike. Must warn rather than pretend.",
    ),
]


# --------------------------------------------------------------------------- #
# A realistic corridor, for populating the map rather than scoring the detector

# Positions along the street, not times into the trip. A pothole does not move,
# so a bus at 9 m/s and a sedan at 13 m/s must reach the same one at different
# moments -- pinning them to a timestamp instead put every vehicle's detection
# in a different place and nothing ever clustered.
CORRIDOR_POTHOLES = [
    {
        "distance_m": 140.0,
        "depth_m": 0.11,
        "length_m": 0.80,
        "label": "deep, near the kerb",
    },
    {"distance_m": 300.0, "depth_m": 0.06, "length_m": 0.50, "label": "moderate"},
    {
        "distance_m": 480.0,
        "depth_m": 0.15,
        "length_m": 1.20,
        "label": "crater at the junction",
    },
]
CORRIDOR_LENGTH_M = 560.0

CORRIDOR_FLEET = [
    (SEDAN, 12.0),
    (SEDAN, 11.0),
    (SUV, 11.5),
    (SEDAN, 13.0),
    (BUS, 9.0),
    (SUV, 10.5),
    (SEMI, 10.0),
    (SEDAN, 12.5),
    (SEDAN, 11.5),
    (SUV, 12.0),
]

CORRIDOR_CLEAN_TRIPS = 6  # vehicles that drive the corridor and hit nothing
CORRIDOR_LAT = BASE_LAT - 0.004
CORRIDOR_LON = BASE_LON
