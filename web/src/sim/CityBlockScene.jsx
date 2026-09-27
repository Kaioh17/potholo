/**
 * CityBlockScene
 *
 * A low-detail city block with a car that hits a pothole once per loop.
 * The suspension is simulated by hand: four independent quarter-car models
 * (sprung body corner, spring-damper, unsprung wheel, tire spring) feeding one
 * rigid body with heave, pitch and roll.
 *
 * The car never moves. The world scrolls toward the camera (treadmill), so the
 * road never runs out and floating point values stay small near the camera.
 *
 * Per-frame values live in refs and plain objects. Nothing in the render loop
 * touches React state or allocates.
 *
 * `speed` and `driveTime` (real seconds until the front axle is over the
 * pothole) are props, not fixed constants: every value derived from them
 * (the slow-motion window, loop length, and where the pothole sits on the
 * road) is rebuilt per (speed, driveTime) pair by `buildTimeline` below.
 */
import { RoundedBox } from '@react-three/drei'
import { Canvas, useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/* -------------------------------------------------------------------------- */
/* Config: every tunable value lives here                                     */
/* -------------------------------------------------------------------------- */

const CONFIG = {
  sim: {
    fixedStep: 1 / 120, // s, physics timestep
    maxFrameDelta: 0.1, // s, longest frame we try to catch up on (tab switches, hitches)
  },
  gravity: 9.81, // m/s^2, only matters for when a tire leaves the road
  car: {
    mass: 1200, // kg, sprung mass (body)
    pitchInertia: 1900, // kg m^2, resistance to nose up / nose down
    rollInertia: 480, // kg m^2, resistance to side tilt
    cgToFrontAxle: 1.25, // m
    cgToRearAxle: 1.35, // m, wheelbase = front + rear
    trackWidth: 1.56, // m, left wheel centre to right wheel centre
    rideHeight: 0.62, // m, height of the body pivot above the road at rest
  },
  suspension: {
    springRate: 30000, // N/m per corner (k)
    damping: 2500, // N s/m per corner (c)
  },
  wheel: {
    mass: 45, // kg, unsprung mass per corner (wheel, hub, brake)
    tireRate: 200000, // N/m, vertical stiffness of the tire
    radius: 0.33, // m
    width: 0.24, // m
  },
  pothole: {
    diameter: 0.6, // m
    depth: 0.1, // m
    // Lateral position relative to the car's centre line. Negative is left.
    // Set to the left wheel path so the left wheels hit it and the body rolls too.
    lateralOffset: -0.78,
  },
  display: {
    // Multiplies the drawn body heave, pitch and roll. Physics and HUD stay true.
    // A 0.6 m hole at 8 m/s moves a real body only about 0.5 cm and 0.3 deg,
    // too small to read on screen. Set to 1 for true scale.
    bodyMotionGain: 6,
  },
  camera: {
    offset: [-1.5, 2.6, 7.4], // position relative to the car: left, up, behind
    lookAt: [-0.2, 0.9, -5], // point the camera aims at, relative to the car
    followRate: 5, // 1/s, higher follows body motion more tightly
    shakeAmplitude: 0.025, // m, kick applied when any wheel drops into the hole
    shakeDecay: 6, // 1/s of simulation time
  },
}

/* -------------------------------------------------------------------------- */
/* Timeline shape: how `speed` and `driveTime` become a slow-motion window     */
/* and a loop length. The offsets below translate the hand-tuned feel of the   */
/* scene's original fixed timeline (slow motion 12-18s around a 12.8s hit,     */
/* 30s loop) so it holds at any driveTime: same lead-in, trail-out and         */
/* post-hit settle time, just centred on wherever the hit now falls.           */
/* -------------------------------------------------------------------------- */

const HIT_LEAD = 0.8 // s before the hit that slow motion starts easing in
const HIT_TRAIL = 5.2 // s after the hit that slow motion has fully eased out
const SLOWMO_RAMP = 0.6 // s, length of the ease in and ease out
const SLOWMO_SCALE = 0.3 // simulation speed inside the window (1 = real time)
const LOOP_TAIL = 17.2 // s after the slow-motion window before the loop resets
const TABLE_RATE = 240 // sim-time lookup table samples per second

/* -------------------------------------------------------------------------- */
/* Scene layout and colours (not physics, rarely need tuning)                 */
/* -------------------------------------------------------------------------- */

const COLORS = {
  sky: '#f7f6f3',
  ground: '#e7e3db',
  road: '#4a4845',
  sidewalk: '#d6d2ca',
  laneDash: '#f2b705',
  potholeRim: '#262422',
  potholeCore: '#121110',
  carBody: '#ffffff',
  carGlass: '#2f3437',
  carTrim: '#cfcac1',
  tire: '#1c1b1a',
  buildings: ['#cfcac1', '#bdb7ad', '#e2ded6', '#a9a39a', '#d9d3c7'],
}

const LAYOUT = {
  laneWidth: 3.5, // the car drives in the right lane of a two lane road
  sidewalkWidth: 3,
  sidewalkHeight: 0.15,
  buildingSetback: 0.3,
  buildingsPerSide: 8,
  blockFrontage: 72, // m of buildings per block side
  crossStreet: 14, // m gap between blocks
  blockCopies: [-1, 0, 1, 2], // block repeats behind and ahead of the car
  dashLength: 3,
  dashSpacing: 9,
  dashRange: [-2, 20], // dash repeats behind and ahead of the car
  staticNear: 40, // m of static ground behind the car
  staticFar: 260, // m of static ground ahead of the car
  fog: [50, 170], // fog near and far; the far value hides recycled objects appearing
  seed: 7,
}

/* -------------------------------------------------------------------------- */
/* Derived constants (independent of speed/driveTime)                         */
/* -------------------------------------------------------------------------- */

const DT = CONFIG.sim.fixedStep
const WHEELBASE = CONFIG.car.cgToFrontAxle + CONFIG.car.cgToRearAxle
const POTHOLE_RADIUS = CONFIG.pothole.diameter / 2

// Wheel order: front left, front right, rear left, rear right.
// `along` is metres ahead of the centre of gravity, `across` is metres to the right.
const WHEEL_ALONG = new Float64Array([
  CONFIG.car.cgToFrontAxle,
  CONFIG.car.cgToFrontAxle,
  -CONFIG.car.cgToRearAxle,
  -CONFIG.car.cgToRearAxle,
])
const WHEEL_ACROSS = new Float64Array([
  -CONFIG.car.trackWidth / 2,
  CONFIG.car.trackWidth / 2,
  -CONFIG.car.trackWidth / 2,
  CONFIG.car.trackWidth / 2,
])

// Static load on each tire: the body's weight split front/rear by lever arm
// (a front corner carries M * g * b / (2L)), plus the wheel's own weight.
// A tire can push up but never pull down, so its force deviation from rest
// can never drop below minus this preload (that is the wheel leaving the road).
const TIRE_PRELOAD = WHEEL_ALONG.map((along) => {
  const share = along > 0 ? CONFIG.car.cgToRearAxle : CONFIG.car.cgToFrontAxle
  return (CONFIG.car.mass * CONFIG.gravity * share) / (2 * WHEELBASE) + CONFIG.wheel.mass * CONFIG.gravity
})

const SHAKE_DECAY_PER_STEP = Math.exp(-CONFIG.camera.shakeDecay * DT)

function smoothstep(edge0, edge1, x) {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1)
  return t * t * (3 - 2 * t)
}

/* -------------------------------------------------------------------------- */
/* Timeline: everything that depends on `speed` and `driveTime`               */
/* -------------------------------------------------------------------------- */

// Builds one (speed, driveTime) pair's worth of: the real-time -> simulation-time
// mapping (with slow motion around the hit), where the pothole sits on the road,
// and the physics step. Rebuilt whenever the caller changes speed or driveTime.
function buildTimeline(speed, driveTime) {
  const slowMotion = {
    start: Math.max(0, driveTime - HIT_LEAD),
    end: driveTime + HIT_TRAIL,
    ramp: SLOWMO_RAMP,
    timeScale: SLOWMO_SCALE,
  }
  const LOOP = driveTime + LOOP_TAIL

  // How fast simulation time runs at a point in the loop: 1 normally,
  // easing down to slowMotion.timeScale inside the slow motion window.
  function timeScaleAt(loopTime) {
    const { start, end, timeScale, ramp } = slowMotion
    const slowness = smoothstep(start, start + ramp, loopTime) - smoothstep(end - ramp, end, loopTime)
    return 1 + (timeScale - 1) * slowness
  }

  // Simulation time is the integral of timeScaleAt over real time. Tabulate it once
  // (trapezoid rule) so every frame maps real time to simulation time exactly.
  // Deriving it from absolute real time, not by summing frame deltas, means the
  // pothole hit lands on the same moment every loop with no drift.
  const samples = Math.round(LOOP * TABLE_RATE)
  const table = new Float64Array(samples + 1)
  for (let i = 1; i <= samples; i++) {
    const a = timeScaleAt((i - 1) / TABLE_RATE)
    const b = timeScaleAt(i / TABLE_RATE)
    table[i] = table[i - 1] + ((a + b) / 2) * (1 / TABLE_RATE)
  }
  const LOOP_SIM_DURATION = table[table.length - 1]

  function simTimeInLoop(loopTime) {
    const f = loopTime * TABLE_RATE
    const i = Math.min(Math.floor(f), table.length - 2)
    return table[i] + (table[i + 1] - table[i]) * (f - i)
  }

  function simTimeAt(realTime) {
    const loops = Math.floor(realTime / LOOP)
    return loops * LOOP_SIM_DURATION + simTimeInLoop(realTime - loops * LOOP)
  }

  // Distance along the road is measured from the car's starting point. The car's
  // centre of gravity is at speed * simTime. One pothole per loop, placed so the
  // front axle is over its centre at real time driveTime.
  const POTHOLE_FIRST = speed * simTimeInLoop(driveTime) + CONFIG.car.cgToFrontAxle
  const POTHOLE_SPACING = speed * LOOP_SIM_DURATION

  // Road surface height at a point: 0 on flat road, a smooth dip in the pothole.
  // Inside the hole the profile is a half-cosine of the distance r from its centre:
  //   h(r) = -depth * (1 + cos(pi * r / R)) / 2
  // which is -depth at the centre and eases to 0 with zero slope at the rim r = R,
  // so the wheel sees no sudden step.
  function roadHeight(along, across) {
    const n = Math.round((along - POTHOLE_FIRST) / POTHOLE_SPACING)
    const dAlong = along - (POTHOLE_FIRST + n * POTHOLE_SPACING)
    const dAcross = across - CONFIG.pothole.lateralOffset
    const r = Math.sqrt(dAlong * dAlong + dAcross * dAcross)
    if (r >= POTHOLE_RADIUS) return 0
    return -CONFIG.pothole.depth * 0.5 * (1 + Math.cos((Math.PI * r) / POTHOLE_RADIUS))
  }

  // Advance the whole car by one fixed step with semi-implicit (symplectic) Euler:
  // compute every force from the current state, update velocities from the forces,
  // then update positions from the new velocities. This ordering keeps spring-mass
  // systems stable at a fixed step where plain explicit Euler would gain energy.
  function stepPhysics(sim) {
    const x = sim.curr
    const fs = sim.suspensionForce
    const ft = sim.tireForce
    const { mass, pitchInertia, rollInertia } = CONFIG.car
    const { springRate: k, damping: c } = CONFIG.suspension
    const { mass: wheelMass, tireRate } = CONFIG.wheel

    sim.prev.set(x)
    const distance = speed * sim.steps * DT // road position of the centre of gravity

    for (let i = 0; i < 4; i++) {
      // Height and vertical speed of the body where corner i's strut attaches.
      // For small angles a point `along` ahead and `across` right of the pivot
      // moves by  heave + along * pitch + across * roll.
      const bodyY = x[HEAVE] + WHEEL_ALONG[i] * x[PITCH] + WHEEL_ACROSS[i] * x[ROLL]
      const bodyV = x[HEAVE_V] + WHEEL_ALONG[i] * x[PITCH_V] + WHEEL_ACROSS[i] * x[ROLL_V]

      // Quarter-car spring-damper between the body corner and the wheel.
      // extension > 0 means the strut is longer than at rest.
      //   F = -k * extension - c * extensionRate
      // F > 0 pushes the body up and, by reaction, the wheel down.
      const extension = bodyY - x[WHEEL_Y + i]
      const extensionRate = bodyV - x[WHEEL_V + i]
      fs[i] = -k * extension - c * extensionRate

      // Tire as a stiff one-sided spring between road and wheel:
      //   F = tireRate * (road - wheel)
      // clamped so the total tire force (preload + deviation) never pulls down.
      const road = roadHeight(distance + WHEEL_ALONG[i], WHEEL_ACROSS[i])
      ft[i] = Math.max(tireRate * (road - x[WHEEL_Y + i]), -TIRE_PRELOAD[i])

      // Kick the camera shake as each wheel drops into the hole.
      const inside = road < 0 ? 1 : 0
      if (inside && !sim.inPothole[i]) sim.shake = CONFIG.camera.shakeAmplitude
      sim.inPothole[i] = inside
    }

    // Rigid body: the four strut forces give
    //   heave:  M  * z''     = sum(F_i)
    //   pitch:  Ip * theta'' = sum(along_i  * F_i)   (front forces lift the nose)
    //   roll:   Ir * phi''   = sum(across_i * F_i)   (right forces lift the right side)
    let force = 0
    let pitchTorque = 0
    let rollTorque = 0
    for (let i = 0; i < 4; i++) {
      force += fs[i]
      pitchTorque += WHEEL_ALONG[i] * fs[i]
      rollTorque += WHEEL_ACROSS[i] * fs[i]
    }
    sim.bodyAccel = force / mass
    x[HEAVE_V] += (force / mass) * DT
    x[PITCH_V] += (pitchTorque / pitchInertia) * DT
    x[ROLL_V] += (rollTorque / rollInertia) * DT
    x[HEAVE] += x[HEAVE_V] * DT
    x[PITCH] += x[PITCH_V] * DT
    x[ROLL] += x[ROLL_V] * DT

    // Each wheel: tire pushes it up, the strut pushes it down.
    //   m_w * y_w'' = F_tire - F_strut
    for (let i = 0; i < 4; i++) {
      x[WHEEL_V + i] += ((ft[i] - fs[i]) / wheelMass) * DT
      x[WHEEL_Y + i] += x[WHEEL_V + i] * DT
    }

    sim.shake *= SHAKE_DECAY_PER_STEP
    sim.steps += 1
  }

  return {
    SPEED: speed,
    LOOP,
    LOOP_SIM_DURATION,
    POTHOLE_FIRST,
    POTHOLE_SPACING,
    timeScaleAt,
    simTimeInLoop,
    simTimeAt,
    roadHeight,
    stepPhysics,
  }
}

/* -------------------------------------------------------------------------- */
/* Suspension physics state                                                   */
/* -------------------------------------------------------------------------- */

// State vector, all values are deviations from the car at rest on flat road,
// so gravity and the static spring preload cancel out and drop from the equations.
const HEAVE = 0 // m, body pivot up
const HEAVE_V = 1 // m/s
const PITCH = 2 // rad, nose up
const PITCH_V = 3 // rad/s
const ROLL = 4 // rad, right side up
const ROLL_V = 5 // rad/s
const WHEEL_Y = 6 // 6..9, m, wheel centre up
const WHEEL_V = 10 // 10..13, m/s
const STATE_SIZE = 14

function createSim(speed) {
  return {
    realTime: 0,
    steps: 0, // fixed steps taken; simulation time is steps * DT
    curr: new Float64Array(STATE_SIZE),
    prev: new Float64Array(STATE_SIZE), // kept for interpolation between steps
    suspensionForce: new Float64Array(4),
    telemetry: {
      loopTime: 0,
      loopDuration: 0,
      timeScale: 1,
      speed,
      verticalAccel: 0,
      pitchRate: 0,
      rollRate: 0,
      wheelInHole: 0,
      pass: 0,
      passSimTime: 0,
    },
    bodyAccel: 0, // m/s^2, body heave acceleration from the last step
    tireForce: new Float64Array(4),
    inPothole: new Uint8Array(4),
    shake: 0,
    hudClock: 0,
    cameraPosition: new THREE.Vector3(...CONFIG.camera.offset),
    cameraTarget: new THREE.Vector3(...CONFIG.camera.lookAt),
    desired: new THREE.Vector3(),
  }
}

/* -------------------------------------------------------------------------- */
/* Shared GPU resources                                                       */
/* -------------------------------------------------------------------------- */

// Tire with rounded shoulders plus a hub cap, merged into one geometry with two
// material groups (0 = tire, 1 = hub) so each wheel stays a single mesh whose
// origin is the wheel centre. Built around y, then turned so the axle runs along x.
function createWheelGeometry() {
  const { radius, width } = CONFIG.wheel
  const half = width / 2
  const bevel = 0.05
  const arcSteps = 4
  const profile = [new THREE.Vector2(0, -half)]
  // Lathe profile: flat inner face, rounded shoulder, tread, rounded shoulder, flat outer face.
  for (const [centreY, from] of [
    [-half + bevel, -Math.PI / 2],
    [half - bevel, 0],
  ]) {
    for (let s = 0; s <= arcSteps; s++) {
      const angle = from + ((Math.PI / 2) * s) / arcSteps
      profile.push(new THREE.Vector2(radius - bevel + bevel * Math.cos(angle), centreY + bevel * Math.sin(angle)))
    }
  }
  profile.push(new THREE.Vector2(0, half))
  const tire = new THREE.LatheGeometry(profile, 28)
  const hub = new THREE.CylinderGeometry(0.17, 0.17, width + 0.012, 24)
  const wheel = mergeGeometries([tire, hub], true)
  tire.dispose()
  hub.dispose()
  wheel.rotateZ(Math.PI / 2)
  return wheel
}

// Upper half of a short cylinder spanning the body's width. Its end caps sit just
// outside the body sides as dark semicircles, which read as rounded wheel arches.
function createArchGeometry() {
  const arch = new THREE.CylinderGeometry(0.42, 0.42, 1.8, 20, 1, false, 0, Math.PI)
  arch.rotateZ(Math.PI / 2) // axle along x, the kept half faces up
  return arch
}

// Side profile of the glasshouse: sloped windshield, rounded roof corners and a
// sloped rear window, extruded across the car with a small bevel. RoundedBox
// cannot slope, so this is the one car part built from a custom shape.
// Profile x is along the car (negative is the front), y is up from the beltline.
function createCabinGeometry() {
  const shape = new THREE.Shape()
  shape.moveTo(-0.95, 0)
  shape.lineTo(1.25, 0)
  shape.lineTo(0.942, 0.308)
  shape.quadraticCurveTo(0.85, 0.4, 0.72, 0.4)
  shape.lineTo(-0.17, 0.4)
  shape.quadraticCurveTo(-0.3, 0.4, -0.411, 0.332)
  shape.closePath()
  const width = 1.4
  const bevel = 0.05
  const cabin = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 6,
  })
  cabin.translate(0, 0, -(width - bevel * 2) / 2)
  cabin.rotateY(-Math.PI / 2) // profile x becomes car z, extrusion becomes car x
  return cabin
}

function useResources() {
  const resources = useMemo(() => {
    const lambert = (color) => new THREE.MeshLambertMaterial({ color })
    const decal = (color, offset) =>
      new THREE.MeshBasicMaterial({ color, polygonOffset: true, polygonOffsetFactor: offset, polygonOffsetUnits: offset })

    const wheel = createWheelGeometry()
    const arch = createArchGeometry()
    const cabin = createCabinGeometry()

    const flatPlane = new THREE.PlaneGeometry(1, 1)
    flatPlane.rotateX(-Math.PI / 2)

    const disc = new THREE.CircleGeometry(1, 24)
    disc.rotateX(-Math.PI / 2)

    return {
      geometries: { box: new THREE.BoxGeometry(1, 1, 1), wheel, arch, cabin, flatPlane, disc },
      materials: {
        ground: lambert(COLORS.ground),
        road: lambert(COLORS.road),
        sidewalk: lambert(COLORS.sidewalk),
        building: lambert('#ffffff'), // tinted per instance
        carBody: lambert(COLORS.carBody),
        carGlass: lambert(COLORS.carGlass),
        carTrim: lambert(COLORS.carTrim),
        tire: lambert(COLORS.tire),
        laneDash: decal(COLORS.laneDash, -1),
        potholeRim: decal(COLORS.potholeRim, -1),
        potholeCore: decal(COLORS.potholeCore, -2),
      },
    }
  }, [])

  useEffect(
    () => () => {
      Object.values(resources.geometries).forEach((g) => g.dispose())
      Object.values(resources.materials).forEach((m) => m.dispose())
    },
    [resources],
  )

  return resources
}

/* -------------------------------------------------------------------------- */
/* Static world                                                               */
/* -------------------------------------------------------------------------- */

const ROAD_CENTER_X = -LAYOUT.laneWidth / 2 // the car sits at x = 0, centred in the right lane
const ROAD_RIGHT_X = LAYOUT.laneWidth / 2
const ROAD_LEFT_X = ROAD_CENTER_X - LAYOUT.laneWidth
const STATIC_LENGTH = LAYOUT.staticNear + LAYOUT.staticFar
const STATIC_CENTER_Z = (LAYOUT.staticNear - LAYOUT.staticFar) / 2

function StaticGround({ geometries, materials }) {
  const sidewalkY = LAYOUT.sidewalkHeight / 2
  return (
    <group>
      <mesh
        geometry={geometries.flatPlane}
        material={materials.ground}
        position={[0, -0.02, STATIC_CENTER_Z]}
        scale={[STATIC_LENGTH * 2, 1, STATIC_LENGTH]}
      />
      <mesh
        geometry={geometries.flatPlane}
        material={materials.road}
        position={[ROAD_CENTER_X, 0, STATIC_CENTER_Z]}
        scale={[LAYOUT.laneWidth * 2, 1, STATIC_LENGTH]}
      />
      <mesh
        geometry={geometries.box}
        material={materials.sidewalk}
        position={[ROAD_RIGHT_X + LAYOUT.sidewalkWidth / 2, sidewalkY, STATIC_CENTER_Z]}
        scale={[LAYOUT.sidewalkWidth, LAYOUT.sidewalkHeight, STATIC_LENGTH]}
      />
      <mesh
        geometry={geometries.box}
        material={materials.sidewalk}
        position={[ROAD_LEFT_X - LAYOUT.sidewalkWidth / 2, sidewalkY, STATIC_CENTER_Z]}
        scale={[LAYOUT.sidewalkWidth, LAYOUT.sidewalkHeight, STATIC_LENGTH]}
      />
    </group>
  )
}

/* -------------------------------------------------------------------------- */
/* Scrolling world (instanced)                                                */
/* -------------------------------------------------------------------------- */

const BLOCK_LENGTH = LAYOUT.blockFrontage + LAYOUT.crossStreet
const BUILDING_COUNT = LAYOUT.blockCopies.length * 2 * LAYOUT.buildingsPerSide
const DASH_COUNT = LAYOUT.dashRange[1] - LAYOUT.dashRange[0] + 1

// Small deterministic PRNG so the block looks the same on every load.
function mulberry32(seed) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// One block of buildings per side, varied widths that exactly fill the frontage.
function layoutBlock() {
  const random = mulberry32(LAYOUT.seed)
  const sides = [-1, 1].map((side) => {
    const weights = Array.from({ length: LAYOUT.buildingsPerSide }, () => 0.6 + random())
    const total = weights.reduce((sum, w) => sum + w, 0)
    let cursor = 0
    return weights.map((w) => {
      const length = (w / total) * LAYOUT.blockFrontage
      const building = {
        side,
        z: cursor + length / 2,
        length: length - 0.4, // thin gap so neighbours read as separate buildings
        depth: 8 + random() * 6,
        height: 6 + random() * random() * 30,
        color: COLORS.buildings[Math.floor(random() * COLORS.buildings.length)],
      }
      cursor += length
      return building
    })
  })
  return sides.flat()
}

function Buildings({ groupRef, geometries, materials }) {
  const meshRef = useRef(null)

  useLayoutEffect(() => {
    const mesh = meshRef.current
    const dummy = new THREE.Object3D()
    const color = new THREE.Color()
    const block = layoutBlock()
    let index = 0
    for (const copy of LAYOUT.blockCopies) {
      for (const b of block) {
        const edge = b.side > 0 ? ROAD_RIGHT_X + LAYOUT.sidewalkWidth : ROAD_LEFT_X - LAYOUT.sidewalkWidth
        const x = edge + b.side * (LAYOUT.buildingSetback + b.depth / 2)
        dummy.position.set(x, b.height / 2, -(copy * BLOCK_LENGTH + b.z))
        dummy.scale.set(b.depth, b.height, b.length)
        dummy.updateMatrix()
        mesh.setMatrixAt(index, dummy.matrix)
        mesh.setColorAt(index, color.set(b.color))
        index += 1
      }
    }
    mesh.instanceMatrix.needsUpdate = true
    mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [])

  return (
    <group ref={groupRef}>
      <instancedMesh ref={meshRef} args={[geometries.box, materials.building, BUILDING_COUNT]} />
    </group>
  )
}

function LaneDashes({ groupRef, geometries, materials }) {
  const meshRef = useRef(null)

  useLayoutEffect(() => {
    const mesh = meshRef.current
    const dummy = new THREE.Object3D()
    for (let i = 0; i < DASH_COUNT; i++) {
      const k = LAYOUT.dashRange[0] + i
      dummy.position.set(ROAD_CENTER_X, 0.005, -(k * LAYOUT.dashSpacing + LAYOUT.dashLength / 2))
      dummy.scale.set(0.14, 1, LAYOUT.dashLength)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [])

  return (
    <group ref={groupRef}>
      <instancedMesh ref={meshRef} args={[geometries.flatPlane, materials.laneDash, DASH_COUNT]} />
    </group>
  )
}

function Pothole({ groupRef, geometries, materials }) {
  return (
    <group ref={groupRef} position={[CONFIG.pothole.lateralOffset, 0, -500]}>
      <mesh
        geometry={geometries.disc}
        material={materials.potholeRim}
        position-y={0.006}
        scale={POTHOLE_RADIUS}
      />
      <mesh
        geometry={geometries.disc}
        material={materials.potholeCore}
        position-y={0.007}
        scale={POTHOLE_RADIUS * 0.65}
      />
    </group>
  )
}

/* -------------------------------------------------------------------------- */
/* Car                                                                        */
/* -------------------------------------------------------------------------- */

// The car root sits at the origin. The body group pivots at the centre of
// gravity; wheels are siblings of the body so body motion never moves them.
// Body-local coordinates: y is up from the body pivot (rideHeight above the road),
// negative z is the front. Wheel arches sit at the axles, which are measured from
// the pivot; every other panel is placed relative to the body's own centre.
const BODY_CENTRE_Z = (CONFIG.car.cgToRearAxle - CONFIG.car.cgToFrontAxle) / 2
const ARCH_Y = CONFIG.wheel.radius - CONFIG.car.rideHeight

function Car({ bodyRef, wheelRefs, geometries, materials }) {
  const wheelMaterials = useMemo(() => [materials.tire, materials.carTrim], [materials])
  return (
    <group>
      <group ref={bodyRef} position-y={CONFIG.car.rideHeight}>
        <group position-z={BODY_CENTRE_Z}>
          {/* Lower body */}
          <RoundedBox args={[1.76, 0.44, 4.3]} radius={0.16} smoothness={4} material={materials.carBody} position-y={-0.02} />
          {/* Hood, tipped nose-down so the front tapers */}
          <RoundedBox
            args={[1.7, 0.26, 1.25]}
            radius={0.12}
            smoothness={4}
            material={materials.carBody}
            position={[0, 0.12, -1.45]}
            rotation-x={-0.07}
          />
          {/* Trunk lid, tipped tail-down so the rear tapers */}
          <RoundedBox
            args={[1.7, 0.24, 0.85]}
            radius={0.12}
            smoothness={4}
            material={materials.carBody}
            position={[0, 0.1, 1.72]}
            rotation-x={0.06}
          />
          {/* Glasshouse with sloped windshield and rear window */}
          <mesh geometry={geometries.cabin} material={materials.carGlass} position-y={0.19} />
          {/* Roof, narrower than the glasshouse so the top tapers */}
          <RoundedBox
            args={[1.3, 0.1, 1.1]}
            radius={0.05}
            smoothness={4}
            material={materials.carBody}
            position={[0, 0.61, 0.275]}
          />
          {/* Bumpers */}
          <RoundedBox
            args={[1.72, 0.22, 0.34]}
            radius={0.1}
            smoothness={4}
            material={materials.carTrim}
            position={[0, -0.12, -2.1]}
          />
          <RoundedBox
            args={[1.7, 0.18, 0.26]}
            radius={0.09}
            smoothness={4}
            material={materials.carTrim}
            position={[0, -0.14, 2.12]}
          />
        </group>
        {/* Wheel arches, one per axle spanning both sides */}
        <mesh geometry={geometries.arch} material={materials.tire} position={[0, ARCH_Y, -CONFIG.car.cgToFrontAxle]} />
        <mesh geometry={geometries.arch} material={materials.tire} position={[0, ARCH_Y, CONFIG.car.cgToRearAxle]} />
      </group>
      {[0, 1, 2, 3].map((i) => (
        <mesh
          key={i}
          ref={(mesh) => {
            wheelRefs.current[i] = mesh
          }}
          geometry={geometries.wheel}
          material={wheelMaterials}
          position={[WHEEL_ACROSS[i], CONFIG.wheel.radius, -WHEEL_ALONG[i]]}
        />
      ))}
    </group>
  )
}

/* -------------------------------------------------------------------------- */
/* Frame loop                                                                 */
/* -------------------------------------------------------------------------- */

function positiveModulo(value, period) {
  return ((value % period) + period) % period
}

function formatHud(sim, pitch, roll, loopTime, timeline) {
  const compression = (i) => {
    const x = sim.curr
    const bodyY = x[HEAVE] + WHEEL_ALONG[i] * x[PITCH] + WHEEL_ACROSS[i] * x[ROLL]
    return ((x[WHEEL_Y + i] - bodyY) * 100).toFixed(1).padStart(5)
  }
  const deg = (rad) => ((rad * 180) / Math.PI).toFixed(2).padStart(6)
  return [
    `Front L/R ${compression(0)} ${compression(1)} cm`,
    `Rear  L/R ${compression(2)} ${compression(3)} cm`,
    `Pitch     ${deg(pitch)} deg`,
    `Roll      ${deg(roll)} deg`,
    `Speed     ${timeline.SPEED.toFixed(1)} m/s  x${timeline.timeScaleAt(loopTime).toFixed(2)}`,
    `Loop      ${loopTime.toFixed(1).padStart(4)} s`,
  ].join('\n')
}

function Simulation({ hudRef, onTelemetry, playing, speed, driveTime }) {
  const simRef = useRef(null)
  const { geometries, materials } = useResources()
  const bodyRef = useRef(null)
  const wheelRefs = useRef([])
  const buildingsRef = useRef(null)
  const dashesRef = useRef(null)
  const potholeRef = useRef(null)

  const timeline = useMemo(() => buildTimeline(speed, driveTime), [speed, driveTime])
  // The pothole's road position and the sim-time lookup table only hold for the
  // (speed, driveTime) pair they were built for, so a change starts the drive over.
  useEffect(() => {
    simRef.current = null
  }, [timeline])

  useFrame(({ camera }, delta) => {
    simRef.current ??= createSim(timeline.SPEED)
    const sim = simRef.current

    // 1. Advance physics in fixed steps until it catches up with the timeline.
    // While paused the clock stands still, so the physics takes no steps and the car holds its pose.
    if (playing) sim.realTime += Math.min(delta, CONFIG.sim.maxFrameDelta)
    const target = timeline.simTimeAt(sim.realTime)
    while ((sim.steps + 1) * DT <= target) timeline.stepPhysics(sim)

    // 2. Blend the last two physics states for display. In slow motion a 60 Hz
    //    frame is shorter than a physics step, so without this blend motion
    //    would stutter between frames that step and frames that do not.
    const alpha = (target - sim.steps * DT) / DT
    const { prev, curr } = sim
    const blend = (i) => prev[i] + (curr[i] - prev[i]) * alpha
    const renderTime = target - DT // prev is one step behind curr
    const distance = timeline.SPEED * renderTime

    // 3. Treadmill: slide repeating content toward the camera by the distance
    //    travelled, wrapped to one period so it snaps back seamlessly.
    buildingsRef.current.position.z = positiveModulo(distance, BLOCK_LENGTH)
    dashesRef.current.position.z = positiveModulo(distance, LAYOUT.dashSpacing)
    // Show the next pothole ahead, or the one just passed until it is behind the camera.
    const n = Math.ceil((distance - 15 - timeline.POTHOLE_FIRST) / timeline.POTHOLE_SPACING)
    potholeRef.current.position.z = distance - (timeline.POTHOLE_FIRST + n * timeline.POTHOLE_SPACING)

    // 4. Car body: heave, pitch and roll only. Wheels only move vertically and spin.
    const gain = CONFIG.display.bodyMotionGain
    const heave = blend(HEAVE)
    const pitch = blend(PITCH)
    const roll = blend(ROLL)
    const body = bodyRef.current
    body.position.y = CONFIG.car.rideHeight + heave * gain
    body.rotation.x = pitch * gain // +x rotation lifts the nose, which points to -z
    body.rotation.z = roll * gain // +z rotation lifts the right side
    const spin = -positiveModulo(distance / CONFIG.wheel.radius, Math.PI * 2)
    for (let i = 0; i < 4; i++) {
      const wheel = wheelRefs.current[i]
      wheel.position.y = CONFIG.wheel.radius + blend(WHEEL_Y + i)
      wheel.rotation.x = spin
    }

    // 5. Camera: ease toward a point behind the car that follows body heave,
    //    then add a small decaying shake after each wheel drops into the hole.
    const follow = 1 - Math.exp(-CONFIG.camera.followRate * delta)
    const [ox, oy, oz] = CONFIG.camera.offset
    const [tx, ty, tz] = CONFIG.camera.lookAt
    sim.cameraPosition.lerp(sim.desired.set(ox, oy + heave * gain, oz), follow)
    sim.cameraTarget.lerp(sim.desired.set(tx, ty + heave * gain * 0.5, tz), follow)
    camera.position.copy(sim.cameraPosition)
    camera.position.x += sim.shake * Math.sin(renderTime * 47)
    camera.position.y += sim.shake * Math.sin(renderTime * 61 + 1.3)
    camera.lookAt(sim.cameraTarget)

    // 6. Telemetry for a page-level readout: what a phone rigidly mounted in the car
    //    would feel. The object is owned by the sim and reused, so nothing is allocated
    //    and React never re-renders per frame. The callback should only read from it.
    if (onTelemetry) {
      const telemetry = sim.telemetry
      telemetry.loopTime = positiveModulo(sim.realTime, timeline.LOOP)
      telemetry.loopDuration = timeline.LOOP
      telemetry.timeScale = timeline.timeScaleAt(telemetry.loopTime)
      telemetry.verticalAccel = sim.bodyAccel // m/s^2, gravity excluded
      telemetry.pitchRate = sim.curr[PITCH_V] // rad/s
      telemetry.rollRate = sim.curr[ROLL_V] // rad/s
      telemetry.wheelInHole = sim.inPothole[0] + sim.inPothole[1] + sim.inPothole[2] + sim.inPothole[3]
      telemetry.pass = Math.floor(sim.realTime / timeline.LOOP) // which trip past the pothole this is
      telemetry.passSimTime = timeline.simTimeInLoop(telemetry.loopTime) // simulation s since this pass began
      onTelemetry(telemetry)
    }

    // 7. Debug HUD, written straight to the DOM a few times a second.
    sim.hudClock += delta
    if (hudRef.current && sim.hudClock >= 0.1) {
      sim.hudClock = 0
      hudRef.current.textContent = formatHud(sim, pitch, roll, positiveModulo(sim.realTime, timeline.LOOP), timeline)
    }
  })

  return (
    <>
      <StaticGround geometries={geometries} materials={materials} />
      <Buildings groupRef={buildingsRef} geometries={geometries} materials={materials} />
      <LaneDashes groupRef={dashesRef} geometries={geometries} materials={materials} />
      <Pothole groupRef={potholeRef} geometries={geometries} materials={materials} />
      <Car bodyRef={bodyRef} wheelRefs={wheelRefs} geometries={geometries} materials={materials} />
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Public component                                                           */
/* -------------------------------------------------------------------------- */

const HUD_STYLE = {
  position: 'absolute',
  top: 12,
  left: 12,
  margin: 0,
  padding: '8px 10px',
  background: 'rgba(255, 255, 255, 0.92)',
  border: '1px solid #eaeaea',
  borderRadius: 8,
  color: '#111111',
  font: "12px/1.5 ui-monospace, 'SF Mono', 'JetBrains Mono', monospace",
  whiteSpace: 'pre',
  pointerEvents: 'none',
}

/**
 * Fills its parent. Give the parent a height.
 *
 * @param {object} props
 * @param {boolean} [props.showHud=false] shows suspension compression, pitch, roll and speed
 * @param {boolean} [props.playing=true] false freezes the clock, so nothing moves until it is true again
 * @param {number} [props.speed=8] car speed in m/s
 * @param {number} [props.driveTime=5] real seconds until the front axle is over the pothole.
 *   Changing this (or `speed`) restarts the drive, since the pothole's road position and the
 *   slow-motion timing are both derived from it.
 * @param {(telemetry: object) => void} [props.onTelemetry] called every frame with a reused object
 *   holding loopTime, loopDuration, timeScale, speed, verticalAccel, pitchRate, rollRate,
 *   wheelInHole, pass (loops completed) and passSimTime (simulation seconds into the current loop).
 *   Copy what you need and do not keep the object's values in React state per frame.
 */
export default function CityBlockScene({ showHud = false, playing = true, speed = 8, driveTime = 5, onTelemetry }) {
  const hudRef = useRef(null)
  return (
    <div
      style={{ position: 'relative', width: '100%', height: '100%' }}
      role="img"
      aria-label="A car drives down a city street, its front then rear wheel drop into a pothole and the body bounces and settles"
    >
      <Canvas
        flat
        dpr={[1, 1.5]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        camera={{ fov: 50, near: 0.1, far: 220, position: CONFIG.camera.offset }}
      >
        <color attach="background" args={[COLORS.sky]} />
        <fog attach="fog" args={[COLORS.sky, ...LAYOUT.fog]} />
        <ambientLight intensity={1.3} />
        <directionalLight position={[-30, 50, 25]} intensity={1.8} />
        <Simulation hudRef={hudRef} onTelemetry={onTelemetry} playing={playing} speed={speed} driveTime={driveTime} />
      </Canvas>
      {showHud && <pre ref={hudRef} style={HUD_STYLE} />}
    </div>
  )
}
