import { useCallback, useEffect, useRef, useState } from 'react'
import { API_URL } from '../admin/useFleet.js'
import { createPhone, previewBody, SAMPLE_RATE_HZ, FRONT_HIT_SIM_TIME, PASS_SECONDS } from './phoneBody.js'

const DETECTION_HOLD_MS = 4000

const INITIAL = { batches: 0, samples: 0, detections: 0, lastDetection: null, lastBody: null, lastResponse: null, error: null }

async function postBatch(body) {
  const response = await fetch(`${API_URL}/v1/batches`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`the API answered ${response.status}`)
  return response.json()
}

/**
 * Plays the part of the phone.  While `playing`, the scene's clock drives a recorder that builds
 * request bodies and POSTs each one to the API as soon as it is complete.
 *
 * `onTelemetry` goes to the scene.  `liveRef` holds the newest sample and is meant to be sampled
 * on a timer, not rendered per frame.  `upload` is React state that changes once per batch, and `recentDetection` is true for a few
 * seconds after the API reports a pothole.  `deviceId` is fixed when the hook first runs, so give a
 * different one a new mount (a `key`).
 *
 * `speed` and `driveTime` should match whatever was passed to `CityBlockScene`. The scene's own
 * `telemetry.passSimTime` is its *visual* sim-time clock, which moves with `driveTime` - the
 * recorded trace's strike is baked at a fixed sim-time (`FRONT_HIT_SIM_TIME`) regardless, so this
 * hook keeps its own clock (`phoneTimeAt`) that always lands the recording's strike at the real
 * moment `driveTime` names, however that moment maps to the scene's own sim time.
 */
function phoneTimeAt(telemetry, driveTime) {
  const { loopTime, loopDuration } = telemetry
  if (loopTime <= driveTime) return loopTime * (FRONT_HIT_SIM_TIME / driveTime)
  const tail = (PASS_SECONDS - FRONT_HIT_SIM_TIME) / (loopDuration - driveTime)
  return FRONT_HIT_SIM_TIME + (loopTime - driveTime) * tail
}

export function useDemoPhone(playing, deviceId, { speed = 8, driveTime = 5 } = {}) {
  const [phone] = useState(() => createPhone(deviceId))
  const playingRef = useRef(playing)
  const liveRef = useRef({ sample: null, tripId: null })
  const [upload, setUpload] = useState(INITIAL)
  const [recentDetection, setRecentDetection] = useState(false)
  const holdTimer = useRef(null)

  useEffect(() => {
    playingRef.current = playing
  }, [playing])

  useEffect(() => () => clearTimeout(holdTimer.current), [])

  const send = useCallback(async (body) => {
    setUpload((u) => ({ ...u, lastBody: previewBody(body) }))
    try {
      const result = await postBatch(body)
      setUpload((u) => ({
        ...u,
        batches: u.batches + 1,
        samples: u.samples + result.samples,
        detections: u.detections + result.detections.length,
        lastDetection: result.detections.at(-1) ?? u.lastDetection,
        lastResponse: { samples: result.samples, rate: result.effective_rate_hz, found: result.detections.length },
        error: null,
      }))
      if (result.detections.length > 0) {
        // Keep the "pothole found" state up for a few seconds so it can be seen.
        setRecentDetection(true)
        clearTimeout(holdTimer.current)
        holdTimer.current = setTimeout(() => setRecentDetection(false), DETECTION_HOLD_MS)
      }
    } catch (error) {
      // fetch reports an unreachable API as a TypeError with no useful message.
      setUpload((u) => ({ ...u, error: error instanceof TypeError ? 'the API is not reachable' : error.message }))
    }
  }, [])

  const onTelemetry = useCallback(
    (telemetry) => {
      if (!playingRef.current) return
      const { batches, sample, tripId } = phone.advance(telemetry.pass, phoneTimeAt(telemetry, driveTime), speed)
      liveRef.current.sample = sample ?? liveRef.current.sample
      liveRef.current.tripId = tripId
      for (const body of batches) send(body)
    },
    [phone, send, speed, driveTime],
  )

  return { deviceId: phone.deviceId, sampleRate: SAMPLE_RATE_HZ, liveRef, upload, recentDetection, onTelemetry }
}
