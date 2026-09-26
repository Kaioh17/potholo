"""What the same pothole feels like from four different vehicles.

Every number below is derived from a quarter-car model rather than tuned by
hand, because the differences between these vehicles are exactly what the
detector has to survive:

    ride rate      kr = ks*kt / (ks + kt)
    body bounce    f_body  = sqrt(kr / ms) / 2pi
    wheel hop      f_wheel = sqrt((ks + kt) / mu) / 2pi

A sedan and a loaded semi disagree on all of it. The sedan's body rocks at
1.2 Hz and its 16" wheel drops 12 cm into a half-metre hole. The semi's leaf
springs put its body at 1.7 Hz, its cab sits on its own air suspension that
absorbs half of what reaches it, and its 22.5" wheel simply *bridges* the same
hole -- a truck physically cannot feel a defect that rattles a car's teeth.

Three consequences the synthetic fleet is built to expose:

  * amplitude: a strike reaching a semi's cab is roughly half what a sedan
    feels, so a fixed threshold tuned on cars goes deaf to trucks
  * geometry: big wheels bridge small holes, so truck and bus data
    systematically under-reports minor defects
  * axle count: a car hits a hole twice, a tractor-trailer up to five times,
    which is one pothole and must not be counted as five
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

G = 9.80665


@dataclass(frozen=True)
class Axle:
    """Distance behind the front axle, and how much of its strike reaches the phone."""

    offset_m: float
    gain: float


@dataclass(frozen=True)
class Vehicle:
    name: str
    sprung_mass_kg: float  # per corner
    unsprung_mass_kg: float  # per corner
    suspension_n_per_m: float
    tyre_n_per_m: float
    body_zeta: float
    wheel_zeta: float
    wheel_radius_m: float
    axles: tuple[Axle, ...]
    mount_isolation: float  # cab suspension and seat, between body and phone
    road_std: float  # background vertical accel at the phone, m/s^2
    typical_speed_ms: tuple[float, float]
    note: str = ""
    _cache: dict = field(default_factory=dict, repr=False, compare=False)

    @property
    def ride_rate(self) -> float:
        ks, kt = self.suspension_n_per_m, self.tyre_n_per_m
        return ks * kt / (ks + kt)

    @property
    def body_hz(self) -> float:
        return math.sqrt(self.ride_rate / self.sprung_mass_kg) / (2 * math.pi)

    @property
    def wheel_hz(self) -> float:
        k = self.suspension_n_per_m + self.tyre_n_per_m
        return math.sqrt(k / self.unsprung_mass_kg) / (2 * math.pi)

    @property
    def strike_transfer(self) -> float:
        """How much of a wheel's impulse arrives at the phone.

        The wheel's momentum is shared with the body it is bolted to, so a
        heavier sprung mass moves less for the same hit; the cab suspension and
        seat then take another cut. Normalised so a sedan is 1.0.
        """
        mu, ms = self.unsprung_mass_kg, self.sprung_mass_kg
        ratio = mu / (ms + mu)
        return ratio / SEDAN_MASS_RATIO * self.mount_isolation

    def reachable_depth(self, hole_length_m: float, hole_depth_m: float) -> float:
        """How far this wheel actually falls into a hole of that size.

        A wheel of radius R crossing a gap of length L cannot drop further than
        R - sqrt(R^2 - (L/2)^2) before its rim catches the far edge. For a long
        enough hole the wheel drops right in and the limit is the hole itself.
        """
        r, half = self.wheel_radius_m, hole_length_m / 2.0
        if half >= r:
            return hole_depth_m
        return min(hole_depth_m, r - math.sqrt(r * r - half * half))

    def axle_delays(self, speed_ms: float) -> list[tuple[float, float]]:
        """When each axle reaches the hole, and how hard that lands at the phone."""
        v = max(speed_ms, 0.5)
        return [(a.offset_m / v, a.gain) for a in self.axles]

    def describe(self) -> str:
        return (
            f"{self.name:<12} body {self.body_hz:4.2f} Hz  "
            f"wheel {self.wheel_hz:5.2f} Hz  "
            f"{len(self.axles)} axles  transfer {self.strike_transfer:.2f}  "
            f"wheel r={self.wheel_radius_m:.2f} m"
        )


SEDAN = Vehicle(
    name="sedan",
    sprung_mass_kg=320,
    unsprung_mass_kg=45,
    suspension_n_per_m=22_000,
    tyre_n_per_m=200_000,
    body_zeta=0.30,
    wheel_zeta=0.15,
    wheel_radius_m=0.32,
    axles=(Axle(0.00, 1.00), Axle(2.70, 0.75)),
    mount_isolation=1.00,
    road_std=0.20,  # measured, data/drive_2024-11-29.csv
    typical_speed_ms=(6.0, 25.0),
    note="mid-size car, phone in a cupholder on the body",
)

# Every other vehicle's strike transfer is expressed relative to this.
SEDAN_MASS_RATIO = 45 / (320 + 45)

SUV = Vehicle(
    name="suv",
    sprung_mass_kg=480,
    unsprung_mass_kg=60,
    suspension_n_per_m=30_000,
    tyre_n_per_m=230_000,
    body_zeta=0.28,
    wheel_zeta=0.16,
    wheel_radius_m=0.37,
    axles=(Axle(0.00, 1.00), Axle(2.95, 0.78)),
    mount_isolation=1.00,
    road_std=0.21,
    typical_speed_ms=(6.0, 25.0),
    note="body-on-frame SUV, taller and heavier than the sedan",
)

SEMI = Vehicle(
    name="semi",
    sprung_mass_kg=3200,
    unsprung_mass_kg=380,
    suspension_n_per_m=450_000,
    tyre_n_per_m=1_600_000,
    body_zeta=0.35,  # leaf springs damp by friction
    wheel_zeta=0.18,
    wheel_radius_m=0.52,  # 22.5" commercial tyre
    axles=(
        Axle(0.00, 1.00),  # steer axle, directly under the cab
        Axle(3.80, 0.45),
        Axle(5.15, 0.45),  # drive tandem
        Axle(11.50, 0.15),
        Axle(12.75, 0.15),  # trailer tandem, through the hitch
    ),
    mount_isolation=0.55,  # cab air suspension plus the seat
    road_std=0.26,
    typical_speed_ms=(5.0, 24.0),
    note="tractor-trailer, five axles, phone in an air-suspended cab",
)

BUS = Vehicle(
    name="bus",
    sprung_mass_kg=2800,
    unsprung_mass_kg=420,
    suspension_n_per_m=280_000,
    tyre_n_per_m=1_200_000,
    body_zeta=0.25,  # air suspension
    wheel_zeta=0.16,
    wheel_radius_m=0.50,
    axles=(Axle(0.00, 1.00), Axle(6.00, 0.35)),
    mount_isolation=0.70,
    road_std=0.22,
    typical_speed_ms=(4.0, 18.0),
    note="40ft transit bus, long wheelbase, frequent stops",
)

FLEET = {v.name: v for v in (SEDAN, SUV, SEMI, BUS)}


if __name__ == "__main__":
    print("Quarter-car parameters derived for each vehicle:\n")
    for v in FLEET.values():
        print("  " + v.describe())
    print("\nHow far each wheel falls into a hole 8 cm deep:\n")
    print(f"  {'hole length':>12}" + "".join(f"{v.name:>9}" for v in FLEET.values()))
    for length in (0.25, 0.40, 0.60, 1.00, 1.50):
        row = "".join(
            f"{v.reachable_depth(length, 0.08) * 100:8.1f}c" for v in FLEET.values()
        )
        print(f"  {length:>10.2f} m {row}")
    print("\n  A big wheel bridges a short hole: the semi and bus barely enter")
    print("  anything under half a metre long.")
