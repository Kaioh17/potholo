/**
 * Pothole lifecycle forecasting.
 *
 * Projects a detected pothole forward on the assumption that nobody fills it.
 * The constants come from `calibration.js`, which is produced by
 * `data/analysis/calibrate_model.py` from 394,453 real Chicago 311 pothole
 * requests, eight years of Chicago weather, and the city's traffic counts.
 *
 * The model in one line:
 *
 *     ds/dD = k * s * (1 - s/cap)
 *
 * Severity grows logistically, not in calendar time but in *damage time* -- a
 * month of January does roughly 2.4 months' worth of damage and a month of July
 * does almost none, because Chicago potholes are driven by freeze-thaw and July
 * has no freeze-thaw days at all. Integrating the monthly damage index between
 * two dates gives the damage-months D, and the logistic has a closed form in D,
 * so no numerical integration is needed.
 *
 * What is measured and what is assumed:
 *
 *   measured   the seasonal damage index (Chicago weather, 2011-2018)
 *   measured   the 266-day median interval between repeat reports on a block
 *   measured   repair latency, were anyone repairing (median 6 days)
 *   ASSUMED    that growth is logistic in damage time
 *   ASSUMED    that severity 40 -> 80 is the span a re-report interval covers
 *
 * The last two are choices, not findings. No published growth rate exists for
 * untreated potholes -- nobody instruments a hole and lets it run. So every
 * projection is returned with a band spanning the p25-p75 re-report interval, a
 * 6.7x spread in rate, and callers are expected to show the band rather than
 * the line.
 */

import calibration from './calibration.js'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const CAP = calibration.growth.severity_cap
const K = calibration.growth.k_per_damage_month
const K_FAST = calibration.growth.k_fast
const K_SLOW = calibration.growth.k_slow

const DAMAGE = MONTHS.map((m) => calibration.damage_driver.monthly_damage_index[m])

const DAY_MS = 86_400_000
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const daysInMonth = (year, month) => new Date(year, month + 1, 0).getDate()

/**
 * Damage-months accrued between two dates.
 *
 * Walks calendar months and weights each by its freeze-thaw index, counting
 * part-months by their day fraction so a forecast does not jump at month
 * boundaries. Returns 0 for a reversed or empty interval rather than a negative
 * number, which would run the logistic backwards.
 */
export function damageMonths(from, to) {
  const start = from instanceof Date ? from : new Date(from)
  const end = to instanceof Date ? to : new Date(to)
  if (!(start < end)) return 0

  let total = 0
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1)
  while (cursor < end) {
    const year = cursor.getFullYear()
    const month = cursor.getMonth()
    const monthStart = new Date(year, month, 1)
    const monthEnd = new Date(year, month + 1, 1)
    const lo = start > monthStart ? start : monthStart
    const hi = end < monthEnd ? end : monthEnd
    if (hi > lo) {
      total += (DAMAGE[month] * (hi - lo)) / (daysInMonth(year, month) * DAY_MS)
    }
    cursor.setMonth(month + 1)
  }
  return total
}

/**
 * Logistic growth, closed form in damage-months.
 *
 * A severity at or below 0, or at or above the cap, is a fixed point: the
 * odds-ratio form divides by zero there, so both ends are returned directly.
 * Without that guard a cluster detected at severity 100 forecasts NaN and the
 * pin vanishes from the map.
 */
export function grow(severity, damage, k = K) {
  const s0 = clamp(severity, 0, CAP)
  if (s0 <= 0 || s0 >= CAP || damage <= 0) return s0
  const odds = s0 / (CAP - s0)
  const grown = odds * Math.exp(k * damage)
  // Math.exp overflows to Infinity for large damage; the limit is the cap.
  if (!Number.isFinite(grown)) return CAP
  return (CAP * grown) / (1 + grown)
}

/**
 * Severity of one cluster at an arbitrary date, with its uncertainty band.
 *
 * Growth starts at `forecastFrom` -- today by default -- and not at the date the
 * pothole was detected. That distinction matters more than it looks. "Left
 * unchecked" is a question about the future: what happens from here if no crew
 * arrives. Running the same assumption backwards would rewrite history, letting
 * a hole found two winters ago grow unchecked through two winters that have
 * already happened, and would report today's city as far worse than the city we
 * actually measured. Before the forecast origin the model simply reports what
 * was observed, because that is all we know.
 */
export function severityAt(cluster, date, { forecastFrom, from } = {}) {
  const detected = from ?? clusterDetectedAt(cluster)
  const origin = forecastFrom ?? new Date()
  const target = date instanceof Date ? date : new Date(date)

  // Growth cannot begin before we knew the hole existed, so a pothole detected
  // after the forecast origin starts growing when it is found, not before.
  const start = detected > origin ? detected : origin

  if (target <= start) {
    return { severity: cluster.severity, lo: cluster.severity, hi: cluster.severity, known: true }
  }
  const damage = damageMonths(start, target)
  return {
    severity: grow(cluster.severity, damage, K),
    lo: grow(cluster.severity, damage, K_SLOW),
    hi: grow(cluster.severity, damage, K_FAST),
    known: false,
    damageMonths: damage,
  }
}

/** When we first felt this pothole. Falls back through the fields the API sends. */
export function clusterDetectedAt(cluster) {
  const raw = cluster.first_seen ?? cluster.last_seen ?? cluster.created_at
  const parsed = raw ? new Date(raw) : new Date()
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed
}

/**
 * A monthly track for one cluster, from `start` to `months` ahead of `origin`.
 *
 * Points at or before the cluster's detection are marked observed; the rest are
 * forecast. Callers draw the two differently, because the difference between
 * "we measured this" and "the model thinks this" is the whole point.
 */
export function track(cluster, { origin = new Date(), back = 0, months = 24 } = {}) {
  const detected = clusterDetectedAt(cluster)
  const points = []
  for (let i = -back; i <= months; i += 1) {
    const at = new Date(origin.getFullYear(), origin.getMonth() + i, origin.getDate())
    const { severity, lo, hi, known } = severityAt(cluster, at, {
      from: detected,
      forecastFrom: origin,
    })
    points.push({ at, monthOffset: i, severity, lo, hi, known: known || at <= detected })
  }
  return points
}

/** Severity band label, matching the thresholds `admin/status.js` already uses. */
export function severityBand(severity) {
  if (severity >= 70) return 'severe'
  if (severity >= 40) return 'moderate'
  return 'minor'
}

/**
 * Fleet-level roll-up: how many clusters sit in each band at each month.
 *
 * This is what makes the "left unchecked" case legible -- a single hole
 * creeping up is abstract, forty of them crossing into severe at once is not.
 */
export function fleetTrack(clusters, options = {}) {
  const { origin = new Date(), back = 0, months = 24 } = options
  const series = []
  for (let i = -back; i <= months; i += 1) {
    const at = new Date(origin.getFullYear(), origin.getMonth() + i, origin.getDate())
    const counts = { minor: 0, moderate: 0, severe: 0 }
    let total = 0
    let known = 0
    let found = 0
    clusters.forEach((cluster) => {
      // A pothole that had not been detected yet does not belong in the count
      // for that month. Including it would draw today's whole inventory as
      // though it had always been known, flattening the seasonal accumulation
      // that is the most solid finding in the data.
      if (clusterDetectedAt(cluster) > at) return
      found += 1
      const point = severityAt(cluster, at, { forecastFrom: origin })
      counts[severityBand(point.severity)] += 1
      total += point.severity
      if (point.known) known += 1
    })
    series.push({
      at,
      monthOffset: i,
      ...counts,
      found,
      meanSeverity: found ? total / found : 0,
      allObserved: known === found,
    })
  }
  return series
}

/**
 * Months until a cluster crosses a severity threshold, or null if it never does
 * inside the horizon. Uses the central rate; `lo`/`hi` give the band.
 */
export function monthsToReach(cluster, threshold, { origin = new Date(), limit = 60 } = {}) {
  if (cluster.severity >= threshold) return 0
  for (let i = 1; i <= limit; i += 1) {
    const at = new Date(origin.getFullYear(), origin.getMonth() + i, origin.getDate())
    if (severityAt(cluster, at, { forecastFrom: origin }).severity >= threshold) return i
  }
  return null
}

export const model = {
  cap: CAP,
  k: K,
  kFast: K_FAST,
  kSlow: K_SLOW,
  damageIndex: DAMAGE,
  calibration,
}

/* --------------------------------- Climate --------------------------------- */

const CLIMATE = calibration.climate

/**
 * Weather for the month containing `date`.
 *
 * Returns the *actual* Chicago weather where we have it, and the 2011-2018
 * climatological normal where we do not. The distinction is reported in
 * `actual`, and the page shows it, because the difference is a finding rather
 * than a technicality: freeze-thaw day counts were found not to rank winters by
 * pothole volume (season-level r = -0.36 over seven winters), so forecasting a
 * *particular* future winter would claim skill the data denies. An average
 * winter is the honest future.
 */
export function climateFor(date) {
  const d = date instanceof Date ? date : new Date(date)
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  const actual = CLIMATE.actual[key]
  if (actual) return { ...actual, actual: true, month: d.getMonth() }
  return { ...CLIMATE.normal[MONTHS[d.getMonth()]], actual: false, month: d.getMonth() }
}

/**
 * What kind of precipitation to draw, and how hard.
 *
 * Snow wins whenever there is meaningful snowfall, because that is what a
 * Chicago winter month looks like even when most of the month's water arrived
 * as rain. `intensity` is 0-1 for the animation to scale particle count and
 * speed; the thresholds are eyeballed against the monthly normals, where a wet
 * month is about 120 mm and a snowy one about 25 cm.
 */
export function precipitationFor(date) {
  const c = climateFor(date)
  const snowing = c.snow_cm > 0.5
  const amount = snowing ? c.snow_cm / 25 : c.precip_mm / 120
  return {
    kind: snowing ? 'snow' : c.precip_mm > 1 ? 'rain' : 'dry',
    intensity: Math.max(0, Math.min(1, amount)),
    freezeThaw: c.ft_days,
    // The whole mechanism in one flag: water that freezes and thaws does damage,
    // water that merely falls does not. July is the wettest kind of nothing.
    damaging: c.ft_days > 0,
    climate: c,
  }
}
