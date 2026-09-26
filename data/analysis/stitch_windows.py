"""Stitch the 413 overlapping plotter windows into one continuous series.

Frames are 1s apart and the window holds 49 samples, so consecutive frames
overlap by ~41 samples.  The per-frame scroll (samples/second) is recovered by
matching that overlap rather than by OCR-ing the x-axis index labels.
"""
import numpy as np
S = r"C:/Users/rosen/AppData/Local/Temp/claude/C--LocalFiles-Academic-Assistant/c1a034cc-3410-4eb0-9834-cf93a86247db/scratchpad"
F = np.load(S + '/frames.npy')                 # (frames, 6, 49)
nf, _, N = F.shape
acc = F[:, :3, :]                              # align on the accelerometer trio

def best_shift(a, b):
    best = (None, np.inf)
    for s in range(4, 14):
        x, y = a[:, s:], b[:, :N-s]
        ok = np.isfinite(x) & np.isfinite(y)
        if ok.sum() < 40: continue
        err = np.abs(x[ok] - y[ok]).mean()
        if err < best[1]: best = (s, err)
    return best

shifts, errs = [], []
for i in range(nf - 1):
    s, e = best_shift(acc[i], acc[i+1])
    shifts.append(s); errs.append(e)
shifts = np.array(shifts); errs = np.array(errs)
print("shift/s: mean %.3f median %d  hist %s" % (shifts.mean(), np.median(shifts),
      {int(v): int((shifts == v).sum()) for v in np.unique(shifts)}))
print("overlap abs err: median %.4f p90 %.4f" % (np.median(errs), np.percentile(errs, 90)))

offs = np.concatenate([[0], np.cumsum(shifts)])
total = offs[-1] + N
sum_ = np.zeros((6, total)); cnt = np.zeros((6, total))
for i in range(nf):
    seg = F[i]; ok = np.isfinite(seg)
    idx = slice(offs[i], offs[i] + N)
    sum_[:, idx] += np.where(ok, seg, 0); cnt[:, idx] += ok
series = np.where(cnt > 0, sum_ / np.maximum(cnt, 1), np.nan)
print("total samples %d over %ds -> %.3f Hz" % (total, nf - 1, total / (nf - 1)))
print("gap frac per ch:", [round(float(np.isnan(series[i]).mean()), 4) for i in range(6)])
np.save(S + '/series_raw.npy', series)
