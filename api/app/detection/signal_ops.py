"""Turn raw phone IMU samples into a mount-independent vertical shock signal.

The phone sits at an unknown attitude -- a cupholder, a pocket, a vent mount --
and slides around during the drive.  Nothing downstream may assume an axis is
"up", so every stage here works off a gravity direction re-estimated from the
data itself.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
from scipy import signal

G_STANDARD = 9.80665
GRAVITY_WINDOW_S = 4.0
DEFAULT_BAND = (2.0, 20.0)


@dataclass
class Vertical:
    t: np.ndarray
    fs: float
    a_vert: np.ndarray  # dynamic acceleration along "up", gravity removed
    a_lateral: np.ndarray  # magnitude of the horizontal component
    g_mag: np.ndarray  # |gravity| as this device measures it
    omega: np.ndarray  # gyro magnitude, rad/s
    scale: float  # correction to true g, from the device's own |g|
    warnings: list[str]


def estimate_rate(t: np.ndarray) -> float:
    """Median-based sample rate; robust to the dropped samples phones produce."""
    dt = np.diff(t)
    dt = dt[dt > 0]
    if dt.size == 0:
        raise ValueError("need at least two distinct timestamps")
    return float(1.0 / np.median(dt))


def resample_uniform(
    t: np.ndarray,
    x: np.ndarray,
    fs: float,
) -> tuple[np.ndarray, np.ndarray]:
    """Put jittery phone timestamps on a uniform grid.

    Android timestamps sensor events in the kernel, so the spacing wobbles by a
    few ms and occasionally drops a sample.  Every filter below assumes a fixed
    step, so interpolate onto one rather than pretending the jitter is not there.
    """
    grid = np.arange(t[0], t[-1] + 0.5 / fs, 1.0 / fs)
    if x.ndim == 1:
        return grid, np.interp(grid, t, x)
    return grid, np.column_stack(
        [np.interp(grid, t, x[:, i]) for i in range(x.shape[1])]
    )


def _rolling_median(x: np.ndarray, win: int) -> np.ndarray:
    win = max(3, min(win, len(x)))
    if win % 2 == 0:
        win -= 1
    s = pd.Series(x).rolling(win, center=True, min_periods=1).median()
    return s.to_numpy()


def gravity_direction(acc: np.ndarray, fs: float) -> np.ndarray:
    """Per-sample gravity vector, as a rolling median of each axis.

    A median rather than a low-pass filter on purpose: a pothole strike is a
    large, short outlier, and a linear filter would let it drag the gravity
    estimate -- corrupting the very samples the estimate is used to interpret.
    A median over a few seconds ignores it.
    """
    win = int(round(GRAVITY_WINDOW_S * fs))
    return np.column_stack([_rolling_median(acc[:, i], win) for i in range(3)])


def to_vertical(
    t: np.ndarray, acc: np.ndarray, gyro: np.ndarray | None = None
) -> Vertical:
    """Project acceleration onto the device's own measured "up"."""
    warnings: list[str] = []
    fs = estimate_rate(t)
    grid, acc_u = resample_uniform(t, acc, fs)
    gyro_u = (
        resample_uniform(t, gyro, fs)[1] if gyro is not None else np.zeros_like(acc_u)
    )

    g_vec = gravity_direction(acc_u, fs)
    g_mag = np.linalg.norm(g_vec, axis=1)
    g_mag = np.where(g_mag < 1e-6, G_STANDARD, g_mag)
    up = g_vec / g_mag[:, None]

    along = (acc_u * up).sum(axis=1)
    a_vert = along - g_mag
    a_lateral = np.linalg.norm(acc_u - along[:, None] * up, axis=1)

    # A phone's accelerometer carries a few percent of scale error. The device's
    # own resting |g| is the calibration: it must read G_STANDARD.
    rest = float(np.median(g_mag))
    scale = G_STANDARD / rest if rest > 1e-6 else 1.0
    if abs(scale - 1.0) > 0.10:
        warnings.append(
            f"accelerometer scale off by {100 * (scale - 1):.1f}% (|g|={rest:.2f})"
        )

    return Vertical(
        t=grid,
        fs=fs,
        a_vert=a_vert * scale,
        a_lateral=a_lateral * scale,
        g_mag=g_mag,
        omega=np.linalg.norm(gyro_u, axis=1),
        scale=scale,
        warnings=warnings,
    )


def bandpass(
    x: np.ndarray, fs: float, band: tuple[float, float] = DEFAULT_BAND
) -> tuple[np.ndarray, list[str]]:
    """Isolate the impact band.

    Below ~2 Hz is the car's sprung mass rocking on its springs -- hills,
    braking, ordinary ride motion.  Above ~20 Hz is tyre and engine hash plus
    the phone rattling in its holder.  A wheel dropping into a pothole rings the
    unsprung mass at roughly 8-15 Hz, which sits between the two.
    """
    warnings: list[str] = []
    lo, hi = band
    nyq = fs / 2.0
    if hi >= nyq * 0.9:
        hi = nyq * 0.9
    if lo >= hi:
        # Nyquist is below the impact band entirely: the rate cannot represent a
        # pothole strike at all. High-pass what is left and say so loudly.
        warnings.append(
            f"sample rate {fs:.1f} Hz cannot resolve the "
            f"{band[0]}-{band[1]} Hz impact band "
            f"(Nyquist {nyq:.1f} Hz); impacts are aliased and will be under-reported"
        )
        lo = min(band[0], nyq * 0.5)
        sos = signal.butter(4, lo / nyq, "highpass", output="sos")
    else:
        if hi < 8.0:
            # The unsprung mass rings at roughly 8-15 Hz. If Nyquist sits below
            # that, the sharpest part of a strike is folded back rather than seen.
            warnings.append(
                f"sample rate {fs:.1f} Hz puts the 8-15 Hz wheel-hop "
                f"resonance above Nyquist ({nyq:.1f} Hz); impact peaks are "
                f"attenuated and aliased -- sample at >=100 Hz"
            )
        elif hi < band[1]:
            warnings.append(
                f"impact band truncated to {lo:.1f}-{hi:.1f} Hz by a {fs:.1f} Hz rate"
            )
        sos = signal.butter(4, [lo / nyq, hi / nyq], "bandpass", output="sos")
    pad = min(len(x) - 1, 3 * 8)
    return signal.sosfiltfilt(sos, x, padlen=pad), warnings


def adaptive_z(
    x: np.ndarray, fs: float, window_s: float = 10.0, noise_floor: float = 0.15
) -> np.ndarray:
    """Score each sample against the road it is on, not a fixed threshold.

    A fixed threshold either misses potholes on a smooth road or flags every
    metre of a rough one.  Normalising by a local median-absolute-deviation
    makes the bar rise on bad pavement, so what gets reported is a defect that
    stands out from its surroundings.  The floor keeps a perfectly smooth
    stretch from turning sensor noise into infinite scores.
    """
    win = max(5, int(round(window_s * fs)))
    s = pd.Series(x)
    med = s.rolling(win, center=True, min_periods=win // 4).median()
    mad = (s - med).abs().rolling(
        win, center=True, min_periods=win // 4
    ).median() * 1.4826
    mad = mad.clip(lower=noise_floor).bfill().ffill()
    return ((s - med.bfill().ffill()) / mad).to_numpy()
