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
ONSET_Z = 3.0
MIN_SEPARATION_S = 0.30
EVENT_HALF_WIDTH_S = 0.40
DROP_TO_HIT_MAX_S = 0.35
DROP_FLOOR_MS2 = 0.8
MIN_SPEED_MS = 4.0  # ~9 mph; below this, kerbs and driveways dominate
MAX_SPEED_MS = 35.0
MAX_LATERAL_MS2 = 6.0  # hard cornering or braking slides the phone
MAX_OMEGA_RADS = 0.9  # ~50 deg/s: a turn, not a straight-ahead strike

# A car hits the same hole twice, front axle then rear, separated by
# wheelbase / speed. Seeing that echo is strong evidence of a road defect.
WHEELBASE_RANGE_M = (2.2, 3.6)
AXLE_MERGE_S = 0.8


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


def find_onset(z_win: np.ndarray, peak: int) -> int:
    """Walk back from the peak to where the road first stopped behaving normally.

    Anchoring on the onset rather than on the window extremes is what makes the
    shape test work.  A strike rings the suspension for several cycles, so the
    largest negative sample in a window is usually a *later* lobe of that ring,
    not the initial unloading -- taking argmin over the whole window reads the
    sequence backwards and calls every pothole a speed bump.
    """
    j = peak
    while j > 0 and abs(z_win[j - 1]) >= ONSET_Z:
        j -= 1
    return j


def classify(
    win: np.ndarray, z_win: np.ndarray, peak: int, fs: float
) -> tuple[str, float, float, float, float, float]:
    """Read the shape of one shock, from its onset forward.

    An accelerometer reads +g along "up" at rest, so when a wheel drops into a
    hole the body unloads first -- a_vert goes negative, bounded at about -1 g
    because a wheel cannot fall faster than gravity -- and only then does it
    strike the far edge, which has no such bound and throws a_vert sharply
    positive.  A speed bump or a manhole lid lifts the wheel first, producing
    the same two lobes in the opposite order.  That ordering is the test.
    """
    onset = find_onset(z_win, peak)
    span = min(len(win), onset + int(round(DROP_TO_HIT_MAX_S * fs)) + 1)
    lead = win[onset:span]
    if lead.size < 2:
        return "rough", 0.0, 0.0, 0.0, 0.0, 0.0

    i_hit = int(np.argmax(lead))
    hit = float(lead[i_hit])
    pre = lead[: i_hit + 1]
    i_drop = int(np.argmin(pre))
    drop = float(pre[i_drop])
    gap = (i_hit - i_drop) / fs
    floor = max(DROP_FLOOR_MS2, 0.15 * abs(hit))

    dv = strike_impulse(lead, i_hit, fs)
    ptp = float(np.ptp(lead))
    if drop <= -floor and i_drop < i_hit and gap <= DROP_TO_HIT_MAX_S and hit > 0:
        return "pothole", drop, hit, gap, dv, ptp
    if hit > 0 and drop > -floor:
        # rose first with nothing preceding it: something lifted the wheel
        return "bump", drop, float(lead.min()), gap, dv, ptp
    return "rough", drop, hit, gap, dv, ptp


def _merge_axle_echoes(events: list[Event], speed: np.ndarray) -> list[Event]:
    """Collapse the front-axle/rear-axle pair from one hole into one detection."""
    merged: list[Event] = []
    for ev in events:
        if merged:
            prev = merged[-1]
            dt = ev.t - prev.t
            v = ev.features.get("speed", 0.0)
            if 0 < dt <= AXLE_MERGE_S:
                lo, hi = (w / max(v, 1e-6) for w in WHEELBASE_RANGE_M)
                if lo <= dt <= hi or dt <= 0.35:
                    prev.axle_echo = True
                    if abs(ev.z) > abs(prev.z):  # keep the stronger strike
                        ev.axle_echo = True
                        merged[-1] = ev
                    continue
        merged.append(ev)
    return merged


def find_events(
    vert: so.Vertical, speed: np.ndarray, z_threshold: float = Z_THRESHOLD
) -> tuple[list[Event], list[str]]:
    band, warnings = so.bandpass(vert.a_vert, vert.fs)
    z = so.adaptive_z(band, vert.fs)
    half = max(2, int(round(EVENT_HALF_WIDTH_S * vert.fs)))

    peaks, _ = signal.find_peaks(
        np.abs(z), height=z_threshold, distance=max(1, int(MIN_SEPARATION_S * vert.fs))
    )
    events: list[Event] = []
    for i in peaks:
        lo, hi = max(0, i - half), min(len(band), i + half + 1)
        kind, drop, hit, gap, dv, ptp = classify(
            band[lo:hi], z[lo:hi], int(i - lo), vert.fs
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

    potholes = [e for e in events if e.kind == "pothole"]
    others = [e for e in events if e.kind != "pothole"]
    merged = _merge_axle_echoes(potholes, speed) + others
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
