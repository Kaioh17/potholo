"""Turn one measured shock into a severity a road crew can rank by.

A caveat worth stating plainly: the same hole hit at 20 mph and at 40 mph gives
very different readings, and the true relationship is not a clean power law.
The wheel falls for L/v seconds, so a faster car drops *less* far into the hole,
while the strike on the far edge gets *harder* with speed.  The two effects pull
opposite ways and the balance depends on the hole's geometry.

So the exponent below is an empirical knob, not a derived constant.  Both raw
measurements survive on every Detection, which means the normalisation can be
re-fitted from labelled ground truth later without reprocessing any trip.
"""

from __future__ import annotations

REFERENCE_SPEED_MS = 13.4  # 30 mph, the Chicago residential limit
SPEED_EXPONENT = 1.0
SATURATION_DV = 0.50  # m/s of strike impulse -> mid severity


def normalise_for_speed(
    value: float, speed: float, exponent: float = SPEED_EXPONENT
) -> float:
    """Scale a measurement to what it would have read at the reference speed."""
    if speed <= 0.5:
        return 0.0
    return value / (speed / REFERENCE_SPEED_MS) ** exponent


def severity_index(delta_v: float, speed: float) -> float:
    """0-100, saturating: a crater and a sinkhole should both read "fix this"."""
    dv = normalise_for_speed(abs(delta_v), speed)
    frac = 1.0 - pow(2.718281828, -dv / SATURATION_DV)
    return round(min(100.0, max(0.0, 100.0 * frac)), 1)


def bucket(severity: float) -> str:
    if severity >= 70:
        return "severe"
    if severity >= 40:
        return "moderate"
    return "minor"


def detection_confidence(
    z: float, drop: float, hit: float, gap_s: float, speed: float
) -> float:
    """How much this single pass deserves to be believed.

    Deliberately conservative: one vehicle hitting one hole once is weak
    evidence.  Confidence is earned across passes, in cluster.py -- this only
    scores how clean the individual waveform was.
    """
    if hit <= 0 or drop >= 0:
        return 0.0
    prominence = min(1.0, (abs(z) - 4.0) / 8.0)  # z=4 -> 0, z=12 -> 1
    symmetry = min(1.0, hit / max(abs(drop), 1e-6))  # a real strike rebounds
    sharpness = max(0.0, 1.0 - gap_s / 0.30)  # tight drop-to-strike
    in_band = 1.0 if 5.0 <= speed <= 25.0 else 0.6
    score = (0.40 * prominence + 0.25 * symmetry + 0.20 * sharpness + 0.15) * in_band
    return round(min(1.0, max(0.0, score)), 3)
