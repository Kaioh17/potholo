# Pothole suspension sim

A React Three Fiber scene: a low-poly car drives down a city block and hits a pothole once per loop.
The suspension is hand-written physics, with no physics library.
It is shown on the `/demo` page (`web/src/pages/Demo.jsx`) and, with a scenario picker and a slider on top, on `/try` (`web/src/pages/Try.jsx`).

## Use it in a page

Everything is in `CityBlockScene.jsx`.
It depends on `three`, `@react-three/fiber` and `@react-three/drei`.
The scene fills its parent, so give the parent a height.

```jsx
import CityBlockScene from '../sim/CityBlockScene.jsx'

<div style={{ height: 480 }}>
  <CityBlockScene showHud={false} speed={8} driveTime={5} onTelemetry={(t) => console.log(t.verticalAccel)} />
</div>
```

`speed` (m/s) and `driveTime` (real seconds until the front axle is over the pothole) default to `8` and `5`.
Changing either restarts the drive: the pothole's road position and the slow-motion window around the hit are both rebuilt from them (see "Adjusting the timing" below).

`onTelemetry` is optional.
It is called every frame with a reused object, so keep it cheap and do not put the values in React state per frame.
It carries `pass` (loops completed), `passSimTime` (simulation seconds into the current loop) and `loopDuration` (the resolved real-time loop length) on top of the suspension readings.

`playing` is optional and defaults to true.
While it is false the clock stands still and the car holds its pose, and the `/demo` page starts that way behind a Play button.

## Feeding the API

The `/demo` and `/try` pages turn this clock into real uploads.
`web/src/demo/phoneBody.js` builds `POST /v1/batches` bodies from `web/src/demo/tripTemplate.json`, a single recorded pass of the car over the pothole, and adds a small random variation to every value so no two uploads match.
`web/src/demo/useDemoPhone.js` posts each body as soon as it is complete.
The trace comes from `mock/demo_trace.py` and is never regenerated for a different `speed` or `driveTime` - it is the same 26.22 s recording (strike baked in at simulation-time 12.45 s, exported from `phoneBody.js` as `PASS_SECONDS` and `FRONT_HIT_SIM_TIME`) played back on its own clock, independent of the scene's.

That independent clock (`phoneTimeAt` in `useDemoPhone.js`) is what keeps the recording's fixed strike lined up with whatever real second the caller picked as `driveTime`, regardless of how the scene's own slow-motion mapping (`timeScaleAt`/`simTimeInLoop`, both per-instance now) happens to map that same moment. If you ever do need to change the recording itself - a different pothole shape, a different vehicle - regenerate it with simulation-time values, not real-time ones:

```bash
python mock/demo_trace.py --pass-seconds 26.22 --front-hit 12.45
```

and update `FRONT_HIT_SIM_TIME`'s source (`tripTemplate.json`'s `frontHitAt`) accordingly - `useDemoPhone.js` reads it from there, nothing to change in code.

## How it works

- **Treadmill.** The car stays at the origin.
  Buildings and lane dashes are two `InstancedMesh`es that slide toward the camera and wrap every block (86 m) or dash period (9 m).
  The pothole jumps to its next position once it is behind the camera.
- **Timeline.** Real time drives a lookup table that maps it to simulation time, with slow motion eased in and out.
  Because the mapping comes from absolute time rather than summed frame deltas, the hit lands at the same moment every loop.
- **Physics.** Each corner is a quarter-car: body corner, spring-damper strut, 45 kg wheel, and a one-sided tire spring that lets the wheel leave the road.
  The four strut forces drive body heave, pitch and roll.
  It steps at a fixed 1/120 s with semi-implicit Euler, and rendering blends the last two steps so slow motion stays smooth.
- **Pothole.** The road height is a half-cosine dip, 0.6 m across and 0.1 m deep, in the left wheel path.
  The left wheels drop in, so the body pitches and rolls.

## Tunable constants

All of them are in the `CONFIG` object at the top of `CityBlockScene.jsx`.

| Constant | What changes on screen |
| --- | --- |
| `suspension.springRate` (k) | Stiffer means a faster, smaller bounce. Softer means a slower, deeper float. |
| `suspension.damping` (c) | Higher settles sooner with fewer rebounds. Lower gives a longer, bouncier wobble. |
| `car.mass` | Heavier body moves less for the same hit and oscillates more slowly. |
| `car.pitchInertia` / `car.rollInertia` | Lower values make the nose dip or side tilt larger and quicker. |
| `car.cgToFrontAxle` / `car.cgToRearAxle` | Wheelbase. Longer means a longer gap between the front and rear hits and more pitch per hit. |
| `car.trackWidth` | Wider track means less roll. |
| `wheel.mass` / `wheel.tireRate` | Lighter wheels or softer tires follow the hole more closely and drop deeper. |
| `pothole.diameter` / `pothole.depth` / `pothole.lateralOffset` | Hole size, and which wheels hit it (0 puts it between the wheels, so none do). |
| `display.bodyMotionGain` | Exaggerates the drawn body motion. Physics and HUD stay true. Set to 1 for true scale. |
| `camera.shakeAmplitude` / `camera.shakeDecay` | Size and length of the camera jolt on each wheel hit. |
| `camera.followRate` | How tightly the camera follows the body's bounce. |

The defaults give about 0.5 cm of real body heave and 0.3 deg of pitch, with the wheel dropping about 5 cm.
That is realistic for a short, sharp hole at 8 m/s, and it is why `bodyMotionGain` defaults to 6.
Motion settles in about 0.8 s of simulation time, about 2.7 s on screen at 30% speed.

## Adjusting the timing

`speed` and `driveTime` are props (see "Use it in a page" above), not `CONFIG` values - they're meant to change at runtime, e.g. from a slider or a scenario picker.
`buildTimeline(speed, driveTime)` in `CityBlockScene.jsx` is what turns them into everything the scene needs each time they change:

- `driveTime` is the real seconds until the front axle is over the pothole's centre.
  The pothole's road position is placed from this value, so changing it moves the hit and nothing else needs to change.
  The rear wheel follows automatically after `wheelbase / speed` of simulation time.
- The slow-motion window is `driveTime` translated by two fixed offsets (`HIT_LEAD` before, `HIT_TRAIL` after, near the top of the file), so it always brackets the hit the same way the original fixed timeline did.
  `SLOWMO_RAMP` sets how long the ease in and out take, and `SLOWMO_SCALE` sets the in-window speed; both stay module-level constants, edit-the-file only.
  To turn slow motion off, set `SLOWMO_SCALE` to `1`.
- The loop length is `driveTime + LOOP_TAIL` (`LOOP_TAIL` is the fixed settle-and-reset time after the slow-motion window, also a module-level constant).

`speed` and `driveTime` do **not** change the phone's uploaded IMU trace - see "Feeding the API" above for how that stays in sync regardless.
