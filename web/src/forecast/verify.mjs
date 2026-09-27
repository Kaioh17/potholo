// Independent check of the forecasting maths, before any of it reaches the UI.
import {
  damageMonths, grow, severityAt, track, fleetTrack, monthsToReach, severityBand, model,
} from './lifecycle.js'

let failures = 0
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  pass  ${name}`)
  else { console.log(`  FAIL  ${name}  ${detail}`); failures += 1 }
}
const approx = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol

console.log('\ndamageMonths')
const yr = damageMonths(new Date(2025, 0, 1), new Date(2026, 0, 1))
check('a full year accrues ~12 damage-months (index averages 1.0)', approx(yr, 12, 0.35), `got ${yr.toFixed(3)}`)
const july = damageMonths(new Date(2025, 6, 1), new Date(2025, 7, 1))
check('July alone accrues ~0 (no freeze-thaw)', july < 0.02, `got ${july.toFixed(4)}`)
const jan = damageMonths(new Date(2025, 0, 1), new Date(2025, 1, 1))
check('January accrues far more than July', jan > 2.0 && jan > july * 50, `jan=${jan.toFixed(3)} jul=${july.toFixed(4)}`)
check('reversed interval returns 0', damageMonths(new Date(2026, 0, 1), new Date(2025, 0, 1)) === 0)
check('empty interval returns 0', damageMonths(new Date(2025, 0, 1), new Date(2025, 0, 1)) === 0)
const half = damageMonths(new Date(2025, 0, 1), new Date(2025, 0, 16))
check('part-month is a fraction of the whole month', half > 0 && half < jan, `half=${half.toFixed(3)} jan=${jan.toFixed(3)}`)
const a = damageMonths(new Date(2025, 0, 1), new Date(2025, 5, 1))
const b = damageMonths(new Date(2025, 5, 1), new Date(2025, 11, 1))
const whole = damageMonths(new Date(2025, 0, 1), new Date(2025, 11, 1))
check('damage is additive across a split', approx(a + b, whole, 1e-9), `${a + b} vs ${whole}`)

console.log('\ngrow (logistic fixed points and bounds)')
check('severity 0 stays 0', grow(0, 5) === 0)
check('severity at cap stays at cap', grow(model.cap, 5) === model.cap)
check('zero damage leaves severity unchanged', grow(42, 0) === 42)
check('negative damage does not shrink below start', grow(42, 0) === 42)
check('never exceeds the cap', grow(99.99, 1000) <= model.cap)
check('huge damage saturates rather than NaN', Number.isFinite(grow(40, 1e6)) && grow(40, 1e6) <= model.cap, `got ${grow(40, 1e6)}`)
check('monotonic in damage', grow(40, 1) < grow(40, 2) && grow(40, 2) < grow(40, 3))
check('monotonic in start severity', grow(30, 2) < grow(50, 2))
check('clamps out-of-range input', grow(-5, 3) === 0 && grow(150, 3) === model.cap)

console.log('\ngrow matches the calibration anchor')
// k was solved so 40 -> 80 over the median re-report interval in damage-months.
const anchor = model.calibration.growth.anchor
const dmg = anchor.over_months
check(`severity 40 reaches ~80 after ${dmg.toFixed(1)} damage-months`,
  approx(grow(40, dmg), 80, 0.5), `got ${grow(40, dmg).toFixed(2)}`)
check('fast band outruns slow band', grow(40, 2, model.kFast) > grow(40, 2, model.kSlow))

console.log('\nseverityAt / track')
const cluster = { cluster_id: 'x', severity: 45, first_seen: '2026-01-15T00:00:00Z' }
const before = severityAt(cluster, new Date('2025-06-01'))
check('before detection returns the observed value, marked known', before.severity === 45 && before.known)
const after = severityAt(cluster, new Date('2027-01-15'))
check('a year later it has grown', after.severity > 45 && !after.known, `got ${after.severity.toFixed(1)}`)
check('band brackets the central estimate', after.lo <= after.severity && after.severity <= after.hi,
  `lo=${after.lo.toFixed(1)} mid=${after.severity.toFixed(1)} hi=${after.hi.toFixed(1)}`)

const pts = track(cluster, { origin: new Date('2026-02-01'), back: 2, months: 12 })
check('track spans back+months+1 points', pts.length === 15, `got ${pts.length}`)
check('track severity is non-decreasing', pts.every((p, i) => i === 0 || p.severity >= pts[i - 1].severity - 1e-9))
check('track stays within bounds', pts.every((p) => p.severity >= 0 && p.severity <= model.cap))

console.log('\nedge cases')
check('missing first_seen does not crash', Number.isFinite(severityAt({ severity: 50 }, new Date()).severity))
check('unparseable date does not crash',
  Number.isFinite(severityAt({ severity: 50, first_seen: 'not-a-date' }, new Date()).severity))
check('severity 100 cluster forecasts 100, not NaN',
  severityAt({ severity: 100, first_seen: '2026-01-01' }, new Date('2027-01-01')).severity === 100)
check('severity 0 cluster stays 0',
  severityAt({ severity: 0, first_seen: '2026-01-01' }, new Date('2027-01-01')).severity === 0)
check('empty fleet returns zeroed series', fleetTrack([], { months: 3 }).every((s) => s.meanSeverity === 0))

console.log('\nfleetTrack / monthsToReach')
const fleet = [
  { cluster_id: 'a', severity: 20, first_seen: '2026-01-01' },
  { cluster_id: 'b', severity: 55, first_seen: '2026-01-01' },
  { cluster_id: 'c', severity: 75, first_seen: '2026-01-01' },
]
const series = fleetTrack(fleet, { origin: new Date('2026-02-01'), months: 24 })
check('counts sum to the number found by that month',
  series.every((s) => s.minor + s.moderate + s.severe === s.found))
check('everything is found by the end of this window', series.at(-1).found === 3)
check('mean severity rises over the horizon', series.at(-1).meanSeverity > series[0].meanSeverity)
check('severe count never decreases (nothing is repaired)',
  series.every((s, i) => i === 0 || s.severe >= series[i - 1].severe))
check('bands agree with severityBand', severityBand(39) === 'minor' && severityBand(40) === 'moderate'
  && severityBand(69) === 'moderate' && severityBand(70) === 'severe')
const m = monthsToReach(fleet[1], 70, { origin: new Date('2026-02-01') })
check('monthsToReach returns a plausible horizon', m !== null && m > 0 && m <= 60, `got ${m}`)
check('already-past threshold returns 0', monthsToReach({ severity: 80, first_seen: '2026-01-01' }, 70) === 0)
check('unreachable threshold inside the limit returns null',
  monthsToReach({ severity: 1, first_seen: '2026-01-01' }, 99, { limit: 2 }) === null)

console.log('\nseasonality sanity')
const winter = damageMonths(new Date(2025, 11, 1), new Date(2026, 2, 1))
const summer = damageMonths(new Date(2025, 5, 1), new Date(2025, 8, 1))
check('a winter quarter does far more damage than a summer one', winter > summer * 20,
  `winter=${winter.toFixed(2)} summer=${summer.toFixed(3)}`)
// Both windows are forecasts of equal calendar length, differing only in season.
const summerHole = { severity: 50, first_seen: '2027-06-01' }
const winterHole = { severity: 50, first_seen: '2027-12-01' }
const jun = severityAt(summerHole, new Date('2027-09-01'), {
  forecastFrom: new Date('2027-06-01'),
}).severity
const dec = severityAt(winterHole, new Date('2028-03-01'), {
  forecastFrom: new Date('2027-12-01'),
}).severity
check('same 3 months, winter grows and summer barely moves', dec > jun + 5 && jun < 50.5,
  `summer=${jun.toFixed(2)} winter=${dec.toFixed(2)}`)

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
