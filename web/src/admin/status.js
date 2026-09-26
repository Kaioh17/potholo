// How raw readings map to a status pill. Every threshold lives here so the
// dashboard's colours mean the same thing everywhere and are easy to retune.
//
// A tone is one of: green (good), amber (watch), red (act), blue (info), grey (no data).

export const MIN_GOOD_RATE_HZ = 100 // the detector needs 100 Hz to see a strike (docs/detection-model.md)
export const MIN_FAIR_RATE_HZ = 50
export const GOOD_GPS_ERROR_M = 15 // a phone's default horizontal accuracy
export const FAIR_GPS_ERROR_M = 25

export function activityStatus(activity) {
  if (activity === 'active') return { tone: 'green', label: 'Active' }
  if (activity === 'idle') return { tone: 'amber', label: 'Idle' }
  return { tone: 'red', label: 'Offline' }
}

export function rateStatus(hz) {
  const label = `${Math.round(hz)} Hz`
  if (hz >= MIN_GOOD_RATE_HZ) return { tone: 'green', label }
  if (hz >= MIN_FAIR_RATE_HZ) return { tone: 'amber', label }
  return { tone: 'red', label }
}

export function gpsStatus(meters) {
  if (meters == null) return { tone: 'grey', label: 'No data' }
  const label = `±${meters.toFixed(0)} m`
  if (meters <= GOOD_GPS_ERROR_M) return { tone: 'green', label }
  if (meters <= FAIR_GPS_ERROR_M) return { tone: 'amber', label }
  return { tone: 'red', label }
}

export function confidenceStatus(confidence) {
  if (confidence == null) return { tone: 'grey', label: 'No hits' }
  const label = `${Math.round(confidence * 100)}%`
  if (confidence >= 0.8) return { tone: 'green', label }
  if (confidence >= 0.5) return { tone: 'amber', label }
  return { tone: 'red', label }
}

// Same buckets the API uses to describe severity (app/detection/severity.py).
export function severityStatus(severity) {
  if (severity == null) return { tone: 'grey', label: 'None' }
  if (severity >= 70) return { tone: 'red', label: 'Severe' }
  if (severity >= 40) return { tone: 'amber', label: 'Moderate' }
  return { tone: 'green', label: 'Minor' }
}

export function clusterStatus(status) {
  if (status === 'confirmed') return { tone: 'green', label: 'Confirmed' }
  if (status === 'reported') return { tone: 'blue', label: 'Reported' }
  return { tone: 'amber', label: 'Candidate' }
}

// One verdict for a device, with the reasons behind it so the table can explain itself.
// Working problems (offline, too slow to see a strike) are red or amber. Finding
// nothing is never a problem: a phone on a smooth road is doing its job.
export function deviceHealth(device) {
  const problems = []
  const watch = []
  if (device.activity === 'offline') problems.push('Not seen for over an hour')
  else if (device.activity === 'idle') watch.push('Quiet for over 5 minutes')
  if (device.sample_rate_hz < MIN_FAIR_RATE_HZ) problems.push(`Samples at ${Math.round(device.sample_rate_hz)} Hz, too slow to see a strike`)
  else if (device.sample_rate_hz < MIN_GOOD_RATE_HZ) watch.push(`Samples at ${Math.round(device.sample_rate_hz)} Hz, below the 100 Hz target`)
  if (device.warnings > 0) watch.push(`${device.warnings} detector warning${device.warnings === 1 ? '' : 's'} on the last batch`)
  if (device.mean_gps_error_m != null && device.mean_gps_error_m > FAIR_GPS_ERROR_M) watch.push('Poor GPS accuracy')

  if (problems.length) return { tone: 'red', label: 'Problem', rank: 2, reasons: [...problems, ...watch] }
  if (watch.length) return { tone: 'amber', label: 'Watch', rank: 1, reasons: watch }
  return { tone: 'green', label: 'Healthy', rank: 0, reasons: ['Uploading at full rate with no warnings'] }
}
