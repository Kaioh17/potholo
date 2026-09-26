"""Recover the IMU time series from the Arduino Serial Plotter screen recording.

The plot area is calibrated per frame from the y-axis *labels* (x < 42), which no
curve can reach.  Each label is centred on its gridline, gridlines step by 2 units,
and a label is negative iff a short minus bar sits in columns 22..27 -- the same
columns as the '1' of "10"/"12", which is told apart by being a tall stroke.
"""
import numpy as np, glob, os, sys
from PIL import Image

SEQ = sys.argv[1]
PLOT_L, PLOT_R, PLOT_T, PLOT_B = 54.5, 1877.5, 10, 872
N = 49
XS = np.array([int(round(PLOT_L + k*(PLOT_R-PLOT_L)/(N-1))) for k in range(N)])
COLS = np.unique(np.concatenate([XS-1, XS, XS+1]))
CIDX = {x: i for i, x in enumerate(COLS)}
COLORS = {'v1': (49,117,174), 'v2': (192,87,3), 'v3': (57,171,114),
          'v4': (217,159,8), 'v5': (191,108,164), 'v6': (111,182,229)}
COL_TOL = 45   # closest pair of series colours is 76 apart
ORDER = ['v1','v2','v3','v4','v5','v6']

def label_rows(g):
    bright = (g[:, 0:42] > 320).any(axis=1)
    runs, cur = [], []
    for y in range(PLOT_T, PLOT_B):
        if bright[y]: cur.append(y)
        elif cur: runs.append(cur); cur = []
    if cur: runs.append(cur)
    # real labels are 13px tall; a run clipped by the plot edge is shorter
    return [(sum(r)/len(r), r[0], r[-1]) for r in runs
            if 12 <= len(r) <= 16 and sum(r)/len(r) > 25]

def calibrate(g):
    labs = label_rows(g)
    if len(labs) < 4: return None
    ctr = [l[0] for l in labs]
    sp = float(np.median(np.diff(ctr)))
    # gridlines always step 2 units, but their pixel pitch changes with the
    # autoscale (7 gridlines -> 121px, 8 -> 106px, ...), so accept a wide pitch
    if not (80 < sp < 185): return None
    neg = []
    for c, y0, y1 in labs:
        n = (g[y0:y1+1, 22:28] > 320).any(axis=1).sum()
        if 1 <= n <= 5: neg.append(c)          # minus bar, not a '1'
    if not neg: return None
    return min(neg) - sp, sp

def curves(im, zero_row, sp):
    """Read each series' pixel row per sample column.

    A colour mask can also catch stray blended pixels elsewhere in the column
    (notably where the three gyro traces pile up on the zero line), so averaging
    every match would straddle two unrelated clusters.  Instead lock onto the
    best-matching pixel and average only the contiguous run around it.
    """
    sub = im[PLOT_T:PLOT_B, COLS, :]
    out = np.full((6, N), np.nan)
    for ci, name in enumerate(ORDER):
        dist = np.linalg.norm(sub - np.array(COLORS[name], float), axis=2)
        for k, x in enumerate(XS):
            d = dist[:, [CIDX[x-1], CIDX[x], CIDX[x+1]]].min(axis=1)
            if d.min() >= COL_TOL: continue
            c = int(np.argmin(d))
            lo = hi = c
            while lo > 0 and d[lo-1] < COL_TOL: lo -= 1
            while hi < len(d)-1 and d[hi+1] < COL_TOL: hi += 1
            out[ci, k] = (zero_row - (PLOT_T + (lo+hi)/2)) / sp * 2
    return out

res, prev, used_prev = [], None, 0
for p in sorted(glob.glob(os.path.join(SEQ, '*.png'))):
    im = np.array(Image.open(p).convert('RGB')).astype(float)
    cal = calibrate(im.sum(2))
    if cal is None:
        cal, used_prev = prev, used_prev + 1
        if cal is None: continue
    prev = cal
    res.append(curves(im, *cal))
print(f"frames {len(res)}, fell back on previous calibration {used_prev}x", file=sys.stderr)
np.save(os.path.join(SEQ, '..', 'frames.npy'), np.array(res))
