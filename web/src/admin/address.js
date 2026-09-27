import { API_URL } from './useFleet.js'

// One lookup per place for the life of the page. The promise is cached, not the
// result, so hovering the same pin twice while the first request is still out
// does not send a second one. A failure is dropped so the next hover retries.
const lookups = new Map()

const keyFor = (lat, lon) => `${lat.toFixed(4)},${lon.toFixed(4)}`

/** Resolves to `{ label, ... }` from the API's reverse geocoder, or rejects. */
export function lookupAddress(lat, lon) {
  const key = keyFor(lat, lon)
  if (!lookups.has(key)) {
    const request = fetch(`${API_URL}/v1/geocode/reverse?lat=${lat}&lon=${lon}`)
      .then((response) => {
        if (!response.ok) throw new Error(`geocode returned ${response.status}`)
        return response.json()
      })
      .catch((error) => {
        lookups.delete(key)
        throw error
      })
    lookups.set(key, request)
  }
  return lookups.get(key)
}
