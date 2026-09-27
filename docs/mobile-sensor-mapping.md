# Feeding the ingest API from a real phone

The React Native app does not exist yet.
This document records what Android and iOS sensor APIs provide, and whether that is enough to fill the `POST /ingest` request body (`SensorBatch` in `api/app/schemas.py`).
It exists so future mobile work starts from what is known to be possible.

Research date: 2026-09-26.
Items marked **unverified** come from memory or from thin documentation pages and must be confirmed on a real device before the app relies on them.

## Verdict

A phone can supply every required field.
No sensor library emits the request body directly, so the app needs a small normalisation layer.
The layer converts units, rebases timestamps and merges two sensor streams into one.
The API stays platform-agnostic, which keeps the rule in `CLAUDE.md` that swapping mock data for real data must not need API changes.

## What the API expects

| Field | Meaning |
|---|---|
| `device_id`, `trip_id` | Strings, 4 to 128 characters. |
| `imu[].t` | Seconds since trip start, strictly increasing, one clock shared with `gps[].t`. |
| `imu[].ax, ay, az` | m/s², **including gravity**. |
| `imu[].gx, gy, gz` | rad/s. |
| `imu` length | At least 16 samples per batch. |
| `gps[]` | Optional. `t`, `lat`, `lon`, `speed` (m/s), `accuracy` (m), optional `heading`. |
| `sample_rate_hint` | Optional. The nominal IMU rate the app requested, in Hz. |

## What each platform provides

| | Android (`SensorEventListener`) | iOS (Core Motion) |
|---|---|---|
| Accelerometer unit | m/s², includes gravity | g, includes gravity (raw `CMAccelerometerData`) |
| Accelerometer sign | Flat and face-up reads about +9.81 on z | Flat and face-up reads about -1 g on z (**unverified**) |
| Gyroscope unit | rad/s | rad/s |
| Timestamp | Nanoseconds since boot | Seconds since boot |
| Max rate | 200 Hz per sensor on Android 12+ without `HIGH_SAMPLING_RATE_SENSORS` | Around 100 Hz on most devices (**unverified**) |
| Rate control | A hint, not a guarantee | `accelerometerUpdateInterval` in seconds, also best effort |
| Background | Needs a foreground service | Needs the "location updates" background mode, because Core Motion stops when the app is suspended |

## What the React Native libraries provide

| Library | Sample shape | Units and time base |
|---|---|---|
| `expo-sensors` | `{x, y, z, timestamp}` | Accelerometer in g, gyroscope in rad/s, timestamp in seconds. Documented. |
| `react-native-sensors` | `{x, y, z, timestamp}` | Not documented. Measure on each platform before trusting it. |

Neither library provides location.
GPS needs a separate library, and its `speed` and `accuracy` map directly to `gps[].speed` and `gps[].accuracy`.
Both libraries deliver accelerometer and gyroscope as separate subscriptions.

## Field mapping

| Request field | Source | Work needed |
|---|---|---|
| `device_id` | App-generated stable ID | Generate once and persist. |
| `trip_id` | App-generated per trip | Generate when a trip starts. |
| `imu[].t` | Sensor `timestamp` | Subtract the first sample's timestamp and convert to seconds. |
| `imu[].ax..az` | Accelerometer | Multiply by 9.80665 when the source is in g. |
| `imu[].gx..gz` | Gyroscope | None. Already rad/s. |
| `gps[]` | Location library | Rebase `t` onto the same trip clock as `imu[].t`. |
| `sample_rate_hint` | The interval the app requested | Pass through as Hz. |

## Gaps the app must handle

1. **Two streams, one row.**
   The accelerometer and gyroscope have independent timestamps, but each `imu` row carries both.
   The app must merge them onto one clock, for example by pairing each accelerometer sample with the nearest or interpolated gyroscope sample.
   The API already resamples IMU data onto a uniform grid (`resample_uniform` in `api/app/detection/signal_ops.py`), so small timing jitter is tolerated.
2. **Unit conversion on iOS.**
   Convert g to m/s² before sending, rather than relying on the API to compensate.
3. **Timestamp rebasing.**
   Absolute timestamps must become seconds since trip start, and must stay strictly increasing.
   Duplicate timestamps are rejected by the schema.
4. **Batching.**
   Send a few seconds at a time and never fewer than 16 samples.
5. **Rate is a request, not a guarantee.**
   Compute the real rate from timestamps and use `sample_rate_hint` only for the requested value.
6. **Background operation.**
   A trip recorded with the screen off needs a foreground service on Android and the background location mode on iOS.
   This is a product and permissions decision, not an API one.

## How the detector copes with phone differences

Read from `api/app/detection/signal_ops.py` on 2026-09-26.

- **Orientation and mounting.**
  The detector re-estimates "up" from a rolling median of gravity and assumes no axis points anywhere.
  The phone can be in a pocket or a cupholder at any angle.
- **Axis sign.**
  Negating all three accelerometer axes flips the estimated "up" too, so `a_vert` comes out the same.
  The iOS sign difference therefore does not change detection.
  Still normalise it in the app so payloads mean the same thing on both platforms.
- **Unit scale.**
  The detector calibrates against the device's own resting gravity and rescales to 9.80665.
  Values sent in g would be silently rescaled and would trigger the "accelerometer scale off" warning, since the scale error exceeds 10 percent.
  That is a safety net, not a plan.
  Send m/s².

## Open questions for when the app is built

- What units and time base does `react-native-sensors` emit on each platform?
  Log raw samples from one Android phone and one iPhone, resting flat.
- What rate do real iPhones sustain in the background with the location mode on?
- Does the chosen merge strategy for accelerometer and gyroscope change detection results?
  Compare against the synthetic fleet in `docs/synthetic-fleet.md`.
- Should the app upload raw batches while offline and drain them later?
  The API accepts batches independently, so this looks possible.
  Duplicate handling for retried uploads has not been checked.

## Sources

- [Android SensorEvent](https://developer.android.com/reference/android/hardware/SensorEvent)
- [Expo Accelerometer](https://docs.expo.dev/versions/latest/sdk/accelerometer.md)
- [Expo Gyroscope](https://docs.expo.dev/versions/latest/sdk/gyroscope.md)
- [Expo Sensors overview](https://docs.expo.dev/versions/latest/sdk/sensors/)
- [react-native-sensors API](https://raw.githubusercontent.com/react-native-sensors/react-native-sensors/master/docs/API.md)
- [Apple CMAccelerometerData](https://developer.apple.com/documentation/coremotion/cmaccelerometerdata)
- [Apple CMDeviceMotion](https://developer.apple.com/documentation/coremotion/cmdevicemotion)
- [Apple accelerometerUpdateInterval](https://developer.apple.com/documentation/coremotion/cmmotionmanager/accelerometerupdateinterval)
