# Real drive data

`drive_2024-11-29.csv` is a real instrumented drive: 3487 samples of
accelerometer and gyroscope data over 418 seconds, recorded on 2024-11-29 with
an MPU6050 on an Arduino.

It is the reference the mock phone generator is fitted to, so the noise in
`mock/phone.py` is measured rather than invented.

## Where it came from

The original Arduino sketch was lost. What survived was a 6m52s screen
recording of the Arduino IDE Serial Plotter (COM3, 19200 baud, six series), so
the data was recovered from the pixels of that video.

`analysis/digitize_plotter_video.py` reads each frame:

- the y-axis is calibrated per frame from the **axis labels** rather than from
  gridlines, because the flat traces span the full plot width and a gridline
  detector picks them up as gridlines. Labels sit at x < 42, where no curve can
  reach. Gridlines always step 2 units, but their pixel pitch changes as the
  plot autoscales (106 px with 8 gridlines, 121 px with 7), and a label is
  negative iff a short minus bar sits in columns 22–27 — the same columns as the
  `1` of "10"/"12", which is told apart by being a tall stroke rather than a
  short one.
- each series is read by colour, locking onto the best-matching pixel and
  averaging only the contiguous run around it. Averaging every match straddles
  two unrelated clusters where stray blended pixels pile up on the zero line.
  The colour tolerance is 45, because the closest pair of plotter series colours
  is only 76 apart and a looser tolerance lets the gyro traces latch onto the
  orange accelerometer one.

`analysis/stitch_windows.py` then stitches the 413 overlapping 49-sample windows
into one series by matching their overlap, which avoids OCR-ing the x-axis index
labels entirely.

## Is it trustworthy?

Four independent checks agree:

| check | result |
| --- | --- |
| sample rate from overlap matching | 8.345 Hz |
| sample rate from x-axis index labels | 8.36 Hz |
| median overlap disagreement between frames | 0.06 m/s² |
| resting \|g\| | 9.42 m/s² (vs 9.81 — a 4% sensor scale error) |
| resting ax, ay, az | 2.04, −0.45, 9.22 — matches the parked segment read by eye |

Accelerometer coverage after stitching is 99.4% (ax), 95.8% (ay), 99.4% (az).
**The gyroscope columns are unreliable** — 17% and 55% of `gx` and `gz` are
missing, because all three gyro traces sit on top of each other at zero where
the digitiser cannot separate them. Use the accelerometer columns only.

## What it established

- the sample period is **119.8 ms**, i.e. `delay(100)` plus I²C and serial
  overhead — which is what the lost sketch's loop must have looked like
- the car's sprung mass resonates at **1.1–1.5 Hz**, carrying 74% of the
  measured 1–4 Hz band power
- background vertical acceleration on ordinary pavement has a standard
  deviation near **0.20 m/s²**
- the device sat at a **12.8° tilt**, and its accelerometer read `|g|` 4% low

And the finding that shaped the whole design: at 8.34 Hz, Nyquist is 4.17 Hz,
so the 8–15 Hz wheel-hop ring a pothole strike produces is **above it**. The rig
recorded the car's ride, not its impacts. See `docs/detection-model.md`.

## Reproducing

The 500 MB source video is not in the repository. With it available:

```bash
ffmpeg -i "Recording 2024-11-29 120451.mp4" -vf "fps=1,crop=1890:900:10:100" frames/f_%04d.png
python data/analysis/digitize_plotter_video.py frames/
python data/analysis/stitch_windows.py
```

## Columns

| column | unit | notes |
| --- | --- | --- |
| `t` | s | reconstructed from the 8.3447 Hz stitched rate |
| `ax`, `ay`, `az` | m/s² | includes gravity, as `SensorEventListener` delivers it |
| `gx`, `gy`, `gz` | rad/s | unreliable, see above |
