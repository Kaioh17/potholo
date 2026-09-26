# Pothole suspension sim

A React Three Fiber scene: a low-poly car drives down a city block and hits a pothole once every 30 seconds.
The suspension is hand-written physics, with no physics library.
It is shown on the `/demo` page (`web/src/pages/Demo.jsx`).

## Use it in a page

Everything is in `CityBlockScene.jsx`.
It depends on `three`, `@react-three/fiber` and `@react-three/drei`.
The scene fills its parent, so give the parent a height.

```jsx
import CityBlockScene from '../sim/CityBlockScene.jsx'

<div style={{ height: 480 }}>
  <CityBlockScene showHud={false} onTelemetry={(t) => console.log(t.verticalAccel)} />
</div>
```

`onTelemetry` is optional.
It is called every frame with a reused object of phone-like readings, so keep it cheap and do not put the values in React state per frame.

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
| `car.speed` | Faster means a sharper, shorter jolt and a shorter front-to-rear delay. |
| `wheel.mass` / `wheel.tireRate` | Lighter wheels or softer tires follow the hole more closely and drop deeper. |
| `pothole.diameter` / `pothole.depth` / `pothole.lateralOffset` | Hole size, and which wheels hit it (0 puts it between the wheels, so none do). |
| `display.bodyMotionGain` | Exaggerates the drawn body motion. Physics and HUD stay true. Set to 1 for true scale. |
| `camera.shakeAmplitude` / `camera.shakeDecay` | Size and length of the camera jolt on each wheel hit. |
| `camera.followRate` | How tightly the camera follows the body's bounce. |

The defaults give about 0.5 cm of real body heave and 0.3 deg of pitch, with the wheel dropping about 5 cm.
That is realistic for a short, sharp hole at 8 m/s, and it is why `bodyMotionGain` defaults to 6.
Motion settles in about 0.8 s of simulation time, about 2.7 s on screen at 30% speed.

## Adjusting the timing

- `timeline.frontHitAt` is the loop time, in real seconds, when the front axle is over the pothole's centre.
  The pothole is placed on the road from this value, so changing it moves the hit and nothing else needs to change.
  The rear wheel follows automatically after `wheelbase / speed` of simulation time.
- `slowMotion.start` and `slowMotion.end` bound the slow motion window, `slowMotion.timeScale` sets its speed, and `slowMotion.ramp` sets how long the ease in and out take.
  Keep `frontHitAt` at least `ramp` after `start` so the hit happens at full slow motion.
- To turn slow motion off, set `slowMotion.timeScale` to 1.
- `timeline.loopDuration` is the loop length.
