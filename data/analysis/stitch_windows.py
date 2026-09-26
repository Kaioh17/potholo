"""Stitch the 413 overlapping plotter windows into one continuous series.

Frames are 1s apart and the window holds 49 samples, so consecutive frames
overlap by ~41 samples.  The per-frame scroll (samples/second) is recovered by
matching that overlap rather than by OCR-ing the x-axis index labels.
"""

import sys
from pathlib import Path

import numpy as np

WORK = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
F = np.load(WORK / "frames.npy")  # (frames, 6, 49)
nf, _, N = F.shape
acc = F[:, :3, :]  # align on the accelerometer trio


def best_shift(a, b):
    best = (None, np.inf)
    for s in range(4, 14):
        x, y = a[:, s:], b[:, : N - s]
        ok = np.isfinite(x) & np.isfinite(y)
        if ok.sum() < 40:
            continue
        err = np.abs(x[ok] - y[ok]).mean()
        if err < best[1]:
            best = (s, err)
    return best


shifts, errs = [], []
for i in range(nf - 1):
    s, e = best_shift(acc[i], acc[i + 1])
    shifts.append(s)
    errs.append(e)
shifts = np.array(shifts)
errs = np.array(errs)
hist = {int(v): int((shifts == v).sum()) for v in np.unique(shifts)}
print(f"shift/s: mean {shifts.mean():.3f} median {np.median(shifts):.0f}  hist {hist}")
print(
    f"overlap abs err: median {np.median(errs):.4f} p90 {np.percentile(errs, 90):.4f}"
)

offs = np.concatenate([[0], np.cumsum(shifts)])
total = offs[-1] + N
sum_ = np.zeros((6, total))
cnt = np.zeros((6, total))
for i in range(nf):
    seg = F[i]
    ok = np.isfinite(seg)
    idx = slice(offs[i], offs[i] + N)
    sum_[:, idx] += np.where(ok, seg, 0)
    cnt[:, idx] += ok
series = np.where(cnt > 0, sum_ / np.maximum(cnt, 1), np.nan)
print(f"total samples {total} over {nf - 1}s -> {total / (nf - 1):.3f} Hz")
print(
    "gap frac per ch:", [round(float(np.isnan(series[i]).mean()), 4) for i in range(6)]
)
np.save(WORK / "series_raw.npy", series)
