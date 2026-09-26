"""Decide which shocks in a trip are potholes.

Three tests have to agree before a candidate survives, because any one of them
alone produces the false positives that make crowd-sourced road data useless:

  1. it stands out from the road it is on          (adaptive_z)
  2. it has the shape of a wheel falling into a hole, not riding over a bump
  3. the vehicle was doing something ordinary at the time -- not braking hard,
     not cornering, not stationary
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy import signal

from . import signal_ops as so

Z_THRESHOLD = 6.0
MIN_SEPARATION_S = 0.30
EVENT_HALF_WIDTH_S = 0.40
DROP_TO_HIT_MAX_S = 0.35
# How far the suspension has to unload before it counts as a drop -- an absolute
# threshold, about 15% of g, deliberately not a fraction of the strike.
#
# A fraction is the wrong physics. The drop cannot exceed 1 g however bad the
# hole is, because a wheel cannot fall faster than gravity, while the strike has
# no such ceiling and grows with depth and speed. Scaling the requirement to the
# strike therefore gets *stricter* exactly as the pothole gets worse: an 18 cm
# crater threw a 44 m/s^2 strike behind a 5 m/s^2 drop and was thrown out for
# having too small a drop, while gentler holes passed.
DROP_FLOOR_MS2 = 1.5
# A pothole's drop is preceded by quiet road. A speed bump's is preceded by the
# lift that put the wheel up there in the first place, and a raised joint's by
# the kick off its leading edge. Looking for that precursor is what tells a
# hole apart from everything else that also ends in a bang.
LIFT_LOOKBACK_S = 0.9
LIFT_RATIO = 0.30
LIFT_FLOOR_MS2 = 1.5  # keeps ordinary road noise from passing as a lift
# The shape test reads a wider band than the detector. A long crater unloads the
# suspension slowly -- a 1.4 m hole at 11 m/s falls for 130 ms, around 4 Hz --
# and a 2 Hz corner flattens that drop while leaving the 11 Hz strike untouched,
# so the deepest potholes were the ones losing their drop.
SHAPE_BAND = (1.0, 20.0)
MIN_SPEED_MS = 4.0  # ~9 mph; below this, kerbs and driveways dominate
MAX_SPEED_MS = 35.0
MAX_LATERAL_MS2 = 6.0  # hard cornering or braking slides the phone
MAX_OMEGA_RADS = 0.9  # ~50 deg/s: a turn, not a straight-ahead strike

# A vehicle hits the same hole once per axle: twice for a car, five times for a
# tractor-trailer whose axles span 13 m. Strikes closer together than this are
# treated as one defect, measured in metres of travel rather than in seconds so
# that it holds at any speed. Set just past the longest legal axle spread, and
# comfortably inside the distance the map can resolve anyway -- two holes closer
# than the 12 m cluster radius land in the same cluster whatever we do here.
MERGE_DISTANCE_M = 15.0


@dataclass
class Event:
    index: int
    t: float
    kind: str
    peak_to_peak: float
    delta_v: float
    drop: float
    hit: float
    z: float
    reason: str = ""
    axle_echo: bool = False
    features: dict = field(default_factory=dict)


def strike_impulse(lead: np.ndarray, i_hit: int, fs: float) -> float:
    """Vertical velocity the strike adds to the car body, m/s.

    Integrated over the strike lobe alone -- from the zero crossing before the
    peak to the one after -- not over the whole window.  The suspension rings
    for several cycles afterwards, and summing that ringing would measure how
    bouncy the car is rather than how hard it was hit.

    An integral rather than a peak because it survives a change of sample rate
    or filter band almost unchanged, which is what lets severities from
    different phone models be compared at all.
    """
    lo = i_hit
    while lo > 0 and lead[lo - 1] > 0:
        lo -= 1
    hi = i_hit
    while hi < len(lead) - 1 and lead[hi + 1] > 0:
        hi += 1
    lobe = lead[lo : hi + 1]
    if lobe.size < 2:
        return float(abs(lead[i_hit]) / fs)
    return float(np.trapezoid(lobe, dx=1.0 / fs))


def classify(
    win: np.ndarray, shape: np.ndarray, centre: int, start: int, fs: float
) -> tuple[str, float, float, float, float, float]:
    """Read the shape of one shock, anchored on the strike.

    An accelerometer reads +g along "up" at rest, so when a wheel drops into a
    hole the body unloads first -- a_vert goes negative, bounded at about -1 g
    because a wheel cannot fall faster than gravity -- and only then does it
    strike the far edge, which has no such bound and throws a_vert sharply
    positive.

    Finding a drop before a strike is not enough on its own, because a speed
    bump ends the same way: the wheel is lifted, goes light over the crest, and
    comes down hard.  What differs is what happened *before* the drop.  A
    pothole is preceded by quiet road; a bump is preceded by the lift, and a
    raised joint by the kick off its leading edge.  So the test is a drop, then
    a strike, with nothing in front of the drop.

    Anchoring on the strike rather than walking back to an "onset" matters.
    Between the drop and the strike the signal passes through zero -- it must,
    they have opposite signs -- and any walk-back that requires a contiguous run
    above a threshold stops dead at that crossing, sees only the strike, and
    calls every pothole a bump.  Whether it happened to stop depended on where
    the crossing sample landed, which is to say on the vehicle's speed.
    """
    reach = int(round(DROP_TO_HIT_MAX_S * fs))
    half = len(win) // 2
    ptp = float(np.ptp(win))
    dv = strike_impulse(win, int(np.argmax(win)), fs)

    # `shape` is the whole trip, not the event window. The lift that precedes a
    # bump can sit outside that window -- one physical bump raises several
    # peaks, and the later ones start after the lift -- so a look-back clipped
    # to the window silently finds nothing and calls the bump a pothole.
    lo, hi = max(0, centre - half), min(len(shape), centre + half + 1)
    i_hit = lo + int(np.argmax(shape[lo:hi]))
    hit = float(shape[i_hit])
    if hit <= 0:
        return "rough", 0.0, hit, 0.0, dv, ptp

    pre_lo = max(0, i_hit - reach)
    if i_hit <= pre_lo:
        return "bump", 0.0, hit, 0.0, dv, ptp
    i_drop = pre_lo + int(np.argmin(shape[pre_lo:i_hit]))
    drop = float(shape[i_drop])
    gap = (i_hit - i_drop) / fs
    if drop > -DROP_FLOOR_MS2:
        return "bump", drop, hit, gap, dv, ptp

    back = max(0, i_drop - int(round(LIFT_LOOKBACK_S * fs)))
    lift = float(shape[back:i_drop].max()) if i_drop > back else 0.0
    if lift >= max(LIFT_RATIO * abs(drop), LIFT_FLOOR_MS2):
        return "bump", drop, hit, gap, dv, ptp

    return "pothole", drop, hit, gap, dv, ptp


def _merge_axle_echoes(events: list[Event]) -> list[Event]:
    """Collapse one road feature's several axle strikes into one verdict.

    Without this a semi reports a single pothole five times, which does not just
    clutter the map -- it corrupts the confirmation maths, because one vehicle
    then looks like five independent witnesses.

    The group is judged by its *leading* strike, and the rest are discarded.
    Only the first axle meets the feature with undisturbed road behind it; every
    axle after it is preceded by the one in front still ringing, and that ring
    reads as the lift that marks a speed bump. Judging by the group's worst
    verdict therefore threw away every pothole a semi or a bus ever hit, because
    their trailing axles always look like bumps.

    Keeping the leading strike also gives the best position available: on a long
    vehicle the front axle is the one nearest the phone.

    A residual bias worth knowing about: the phone rides in the cab, so a strike
    under a trailer axle is recorded at the cab's position, up to 13 m past the
    hole. Merging keeps that to one detection but cannot recover where the wheel
    actually was.
    """
    if not events:
        return []
    groups: list[list[Event]] = [[events[0]]]
    for ev in events[1:]:
        prev = groups[-1][-1]
        v = max(ev.features.get("speed", 0.0), prev.features.get("speed", 0.0))
        if 0 < (ev.t - prev.t) * max(v, 1e-6) <= MERGE_DISTANCE_M:
            groups[-1].append(ev)
        else:
            groups.append([ev])

    merged: list[Event] = []
    for group in groups:
        lead = group[0]
        lead.axle_echo = len(group) > 1
        merged.append(lead)
    return merged


def find_events(
    vert: so.Vertical, speed: np.ndarray, z_threshold: float = Z_THRESHOLD
) -> tuple[list[Event], list[str]]:
    band, warnings = so.bandpass(vert.a_vert, vert.fs)
    shape_signal, _ = so.bandpass(vert.a_vert, vert.fs, SHAPE_BAND)
    z = so.adaptive_z(band, vert.fs)
    half = max(2, int(round(EVENT_HALF_WIDTH_S * vert.fs)))

    peaks, _ = signal.find_peaks(
        np.abs(z), height=z_threshold, distance=max(1, int(MIN_SEPARATION_S * vert.fs))
    )
    events: list[Event] = []
    for i in peaks:
        lo, hi = max(0, i - half), min(len(band), i + half + 1)
        kind, drop, hit, gap, dv, ptp = classify(
            band[lo:hi], shape_signal, int(i), lo, vert.fs
        )
        ev = Event(
            index=int(i),
            t=float(vert.t[i]),
            kind=kind,
            peak_to_peak=ptp,
            delta_v=dv,
            drop=drop,
            hit=hit,
            z=float(z[i]),
            features={
                "drop_to_hit_s": gap,
                "speed": float(speed[i]) if len(speed) else 0.0,
                "lateral": float(vert.a_lateral[lo:hi].max()),
                "omega": float(vert.omega[lo:hi].max()),
            },
        )
        events.append(_gate(ev))

    gated = [e for e in events if e.kind == "rejected"]
    candidates = [e for e in events if e.kind != "rejected"]
    merged = _merge_axle_echoes(candidates) + gated
    return sorted(merged, key=lambda e: e.t), warnings


def _gate(ev: Event) -> Event:
    """Reject shocks the vehicle caused, rather than the road."""
    f = ev.features
    if f["speed"] < MIN_SPEED_MS:
        ev.kind = "rejected"
        ev.reason = f"speed {f['speed']:.1f} m/s below {MIN_SPEED_MS}"
    elif f["speed"] > MAX_SPEED_MS:
        ev.kind, ev.reason = "rejected", f"speed {f['speed']:.1f} m/s implausible"
    elif f["omega"] > MAX_OMEGA_RADS:
        ev.kind, ev.reason = "rejected", f"cornering ({f['omega']:.2f} rad/s)"
    elif f["lateral"] > MAX_LATERAL_MS2:
        ev.kind = "rejected"
        ev.reason = f"braking or swerving ({f['lateral']:.1f} m/s2)"
    elif ev.kind == "rough":
        ev.reason = "no drop-then-strike shape"
    return ev
