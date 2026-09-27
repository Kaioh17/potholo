// Builds the request bodies the demo "phone" uploads to POST /v1/batches.
//
// The values come from tripTemplate.json, one recorded pass of the demo car over its pothole,
// made by mock/demo_trace.py.  Only this frontend holds it.  Every sample and GPS fix is nudged by
// a small random amount, so each upload differs from the last and from every other pass, but stays
// close to the original.  The bodies match SensorBatch in api/app/schemas.py, which is what a
// real phone would send, so nothing on the API side knows this is a demo.

import template from './tripTemplate.json'

const { fs, speed, imu: rows } = template

// The API needs a few seconds of road either side of a strike to judge it: 2 s batches found
// nothing, 3 s and longer did.  Shorter batches would also mean a real phone uploading more often.
const BATCH_SECONDS = 3
const BATCH_SAMPLES = BATCH_SECONDS * fs

// Where the trip starts: Jackson Blvd in the Loop, driving east.
const START = { lat: 41.8781, lon: -87.6298, heading: 90 }
const METRES_PER_DEG_LAT = 111_320

// How far a value may stray from the recording.  Each figure is a plus or minus range.
const SPREAD = {
  accel: 0.05, // m/s^2 on each axis of each sample
  gyro: 0.004, // rad/s on each axis of each sample
  scale: 0.03, // whole-trip accelerometer scale error, as a fraction
  speed: 0.3, // m/s on each GPS fix
  position: 3, // m on each GPS fix
}
const ACCURACY_RANGE = [6, 10] // m, reported GPS error

const between = (low, high) => low + Math.random() * (high - low)
const around = (value, spread) => value + between(-spread, spread)
const round = (value, digits) => Number(value.toFixed(digits))
const randomId = (prefix) => `${prefix}-${Math.random().toString(16).slice(2, 10).padEnd(8, '0')}`

export const SAMPLE_RATE_HZ = fs
export const PASS_SECONDS = template.passSeconds
// Simulation seconds into the recording where the strike is baked into the rows.
export const FRONT_HIT_SIM_TIME = template.frontHitAt

function makeSample(index, gain) {
  const [ax, ay, az, gx, gy, gz] = rows[index]
  return {
    t: round(index / fs, 4),
    ax: round(gain * ax + between(-SPREAD.accel, SPREAD.accel), 4),
    ay: round(gain * ay + between(-SPREAD.accel, SPREAD.accel), 4),
    az: round(gain * az + between(-SPREAD.accel, SPREAD.accel), 4),
    gx: round(gx + between(-SPREAD.gyro, SPREAD.gyro), 4),
    gy: round(gy + between(-SPREAD.gyro, SPREAD.gyro), 4),
    gz: round(gz + between(-SPREAD.gyro, SPREAD.gyro), 4),
  }
}

// The car drives at a constant speed along the street, so distance is speed times trip time.
// `tripSpeed` defaults to the recording's own speed, but a scenario may drive faster or slower:
// only the GPS fixes reflect that (distance and reported speed), never the recorded IMU rows.
function makeFix(second, tripSpeed) {
  const heading = (START.heading * Math.PI) / 180
  const distance = tripSpeed * second
  const north = distance * Math.cos(heading) + between(-SPREAD.position, SPREAD.position)
  const east = distance * Math.sin(heading) + between(-SPREAD.position, SPREAD.position)
  const metresPerDegLon = METRES_PER_DEG_LAT * Math.cos((START.lat * Math.PI) / 180)
  return {
    t: second,
    lat: round(START.lat + north / METRES_PER_DEG_LAT, 6),
    lon: round(START.lon + east / metresPerDegLon, 6),
    speed: round(Math.max(0, around(tripSpeed, SPREAD.speed)), 2),
    accuracy: round(between(...ACCURACY_RANGE), 1),
    heading: START.heading,
  }
}

/**
 * A phone that records the demo car.  It uploads as `givenDeviceId`, or as a random demo device when
 * none is given.  Feed it the sim clock and it hands back finished request bodies.
 *
 * Each pass of the car over the pothole is its own trip with its own `trip_id`, because a trip's
 * timestamps start at zero.  A batch is three seconds of samples plus the GPS fixes on the whole
 * seconds around it, and is only released once the sim clock has reached its last fix, so the body
 * never contains a reading from the future.
 *
 * `advance`'s `tripSpeed` overrides the recording's own speed for the GPS fixes only (see
 * `makeFix`), so a faster or slower scenario is reflected in distance and reported speed, not the
 * recorded IMU rows. It can change between calls without losing the in-progress trip.
 */
export function createPhone(givenDeviceId) {
  const deviceId = givenDeviceId ?? randomId('demo')
  let trip = null

  function startTrip(pass) {
    return {
      pass,
      id: randomId('trip'),
      gain: 1 + between(-SPREAD.scale, SPREAD.scale),
      samples: [], // generated but not yet sent
      generated: 0, // samples generated so far, which is also the next sample's index
      sent: 0, // samples already in a released batch
    }
  }

  /**
   * @param {number} pass which pass of the pothole the sim is on
   * @param {number} passTime simulation seconds since this pass began
   * @param {number} [tripSpeed] m/s reported in this pass's GPS fixes; defaults to the recording's own speed
   * @returns {{ batches: object[], sample: object|null }} bodies ready to POST, and the newest sample
   */
  function advance(pass, passTime, tripSpeed = speed) {
    // The tail of an unfinished pass is dropped: it would be a second trip of under a batch.
    if (!trip || trip.pass !== pass) trip = startTrip(pass)

    while (trip.generated < rows.length && trip.generated / fs <= passTime) {
      trip.samples.push(makeSample(trip.generated, trip.gain))
      trip.generated += 1
    }

    const batches = []
    while (trip.samples.length > BATCH_SAMPLES && passTime >= (trip.sent + BATCH_SAMPLES) / fs) {
      const startSecond = trip.sent / fs
      const endSecond = startSecond + BATCH_SECONDS
      const gps = []
      for (let second = startSecond; second <= endSecond; second += 1) gps.push(makeFix(second, tripSpeed))
      batches.push({
        device_id: deviceId,
        trip_id: trip.id,
        imu: trip.samples.splice(0, BATCH_SAMPLES),
        gps,
        sample_rate_hint: fs,
      })
      trip.sent += BATCH_SAMPLES
    }

    return { batches, sample: trip.samples.at(-1) ?? null, tripId: trip.id }
  }

  return { deviceId, advance }
}

// The body with its sample list shortened, for showing on screen.
export function previewBody(body) {
  const { imu, gps, ...rest } = body
  const hidden = imu.length - 2
  return JSON.stringify({ ...rest, imu: [...imu.slice(0, 2), `... ${hidden} more`], gps: [gps[0], `... ${gps.length - 1} more`] }, null, 2)
}
