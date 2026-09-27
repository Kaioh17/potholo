import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Info, Pause, Play, SkipBack, WarningCircle } from '@phosphor-icons/react'
import Nav from '../components/Nav.jsx'
import Footer from '../components/Footer.jsx'
import ForecastMap from '../components/ForecastMap.jsx'
import history from '../forecast/history.js'
import {
  clusterDetectedAt,
  fleetTrack,
  model,
  monthsToReach,
  severityAt,
  track,
} from '../forecast/lifecycle.js'

const BACK_MONTHS = 36
const AHEAD_MONTHS = 24
const STEP_MS = 420

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const stamp = (d) => `${MONTHS[d.getMonth()]} ${d.getFullYear()}`

const monthsFromNow = (origin, offset) =>
  new Date(origin.getFullYear(), origin.getMonth() + offset, origin.getDate())

/* ------------------------------- Timeline chart ---------------------------- */

/**
 * Fleet composition over the whole window.
 *
 * The map answers "where"; this answers "how much worse, and when". Stacked
 * because the total is meaningful -- potholes are never removed in this
 * scenario, so the stack only grows, and the shape of the severe band is the
 * whole argument for fixing them early.
 */
function Timeline({ series, offset, onScrub, nowIndex }) {
  const W = 1000
  const H = 150
  const max = Math.max(1, ...series.map((s) => s.minor + s.moderate + s.severe))
  const x = (i) => (i / Math.max(1, series.length - 1)) * W
  const y = (v) => H - (v / max) * H

  const area = (upper, lower) => {
    const top = series.map((s, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(upper(s))}`).join(' ')
    const bottom = series
      .map((s, i) => `L ${x(series.length - 1 - i)} ${y(lower(series[series.length - 1 - i]))}`)
      .join(' ')
    return `${top} ${bottom} Z`
  }

  const total = (s) => s.minor + s.moderate + s.severe
  const modPlusSevere = (s) => s.moderate + s.severe
  const severe = (s) => s.severe
  const zero = () => 0

  return (
    <figure className="ftl">
      <figcaption className="ftl__head">
        <span className="eyebrow">Fleet composition, {BACK_MONTHS} months back and {AHEAD_MONTHS} ahead</span>
        <span className="ftl__keys">
          <span className="ftl__key ftl__key--severe">Severe 70+</span>
          <span className="ftl__key ftl__key--moderate">Moderate 40-69</span>
          <span className="ftl__key ftl__key--minor">Minor under 40</span>
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H + 26}`} className="ftl__svg" role="img"
        aria-label="Stacked count of potholes by severity band over time">
        <path className="ftl__area ftl__area--minor" d={area(total, modPlusSevere)} />
        <path className="ftl__area ftl__area--moderate" d={area(modPlusSevere, severe)} />
        <path className="ftl__area ftl__area--severe" d={area(severe, zero)} />

        {/* Everything right of this line is model output, not observation. */}
        <line className="ftl__now" x1={x(nowIndex)} y1={0} x2={x(nowIndex)} y2={H} />
        <text className="ftl__nowlabel" x={x(nowIndex) + 6} y={12}>today</text>
        <rect className="ftl__future" x={x(nowIndex)} y={0} width={W - x(nowIndex)} height={H} />

        <line className="ftl__cursor" x1={x(offset + BACK_MONTHS)} y1={0}
          x2={x(offset + BACK_MONTHS)} y2={H} />

        {series.map((s, i) =>
          s.at.getMonth() === 0 ? (
            <text key={i} className="ftl__year" x={x(i)} y={H + 18}>{s.at.getFullYear()}</text>
          ) : null,
        )}
        <rect className="ftl__hit" x="0" y="0" width={W} height={H}
          onPointerDown={(event) => {
            const box = event.currentTarget.getBoundingClientRect()
            const frac = (event.clientX - box.left) / box.width
            const i = Math.round(frac * (series.length - 1))
            onScrub(clamp(i, 0, series.length - 1) - BACK_MONTHS)
          }} />
      </svg>
    </figure>
  )
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

/* -------------------------------- Detail panel ----------------------------- */

function Detail({ pothole, at, origin }) {
  if (!pothole) {
    return (
      <aside className="fdetail fdetail--empty">
        <Info size={20} weight="bold" aria-hidden="true" />
        <p>Select a pothole on the map to see its projected trajectory.</p>
      </aside>
    )
  }
  const detected = clusterDetectedAt(pothole)
  const now = severityAt(pothole, at, { from: detected })
  const points = track(pothole, { origin, back: 0, months: AHEAD_MONTHS })
  const toSevere = monthsToReach(pothole, 70, { origin })

  const W = 260
  const H = 64
  const x = (i) => (i / (points.length - 1)) * W
  const y = (v) => H - (v / 100) * H
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.severity)}`).join(' ')
  const bandPath =
    points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.hi)}`).join(' ') +
    ' ' +
    points
      .map((_, i) => {
        const j = points.length - 1 - i
        return `L ${x(j)} ${y(points[j].lo)}`
      })
      .join(' ') +
    ' Z'

  return (
    <aside className="fdetail" aria-label="Selected pothole">
      <p className="fdetail__coords">{pothole.lat.toFixed(5)}, {pothole.lon.toFixed(5)}</p>
      <div className="fdetail__now">
        <strong>{Math.round(now.severity)}</strong>
        <span>/ 100 on {stamp(at)}{now.known ? ' (observed)' : ' (forecast)'}</span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="fdetail__spark" role="img"
        aria-label="Projected severity over the next two years">
        <path className="fdetail__band" d={bandPath} />
        <path className="fdetail__line" d={line} />
        <line className="fdetail__threshold" x1="0" y1={y(70)} x2={W} y2={y(70)} />
      </svg>
      <p className="fdetail__axis">
        <span>now</span>
        <span>severe at 70</span>
        <span>+{AHEAD_MONTHS}m</span>
      </p>

      <dl className="fdetail__rows">
        <div><dt>First detected</dt><dd>{stamp(detected)}</dd></div>
        <div><dt>Severity when found</dt><dd>{pothole.severity.toFixed(0)}</dd></div>
        <div><dt>Devices that felt it</dt><dd>{pothole.devices}</dd></div>
        <div>
          <dt>Reaches severe (70)</dt>
          <dd>{toSevere === 0 ? 'already there' : toSevere == null ? `beyond ${AHEAD_MONTHS} months` : `in ~${toSevere} months`}</dd>
        </div>
        <div>
          <dt>Range at {stamp(at)}</dt>
          <dd>{now.known ? 'observed' : `${Math.round(now.lo)} to ${Math.round(now.hi)}`}</dd>
        </div>
      </dl>
      {!now.known && (
        <p className="fdetail__note">
          The band is the p25-p75 spread of how fast Chicago blocks actually deteriorate,
          a {(model.kFast / model.kSlow).toFixed(1)}x range in rate. The line is the middle of it,
          not a prediction to bet on.
        </p>
      )}
    </aside>
  )
}

/* ----------------------------------- Page ---------------------------------- */

export default function Forecast() {
  const origin = useMemo(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  }, [])

  const potholes = history.potholes
  const [offset, setOffset] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  const timer = useRef(null)

  const at = useMemo(() => monthsFromNow(origin, offset), [origin, offset])

  const series = useMemo(
    () => fleetTrack(potholes, { origin, back: BACK_MONTHS, months: AHEAD_MONTHS }),
    [potholes, origin],
  )

  useEffect(() => {
    if (!playing) return undefined
    timer.current = setInterval(() => {
      setOffset((o) => (o >= AHEAD_MONTHS ? -BACK_MONTHS : o + 1))
    }, STEP_MS)
    return () => clearInterval(timer.current)
  }, [playing])

  const current = series[offset + BACK_MONTHS] ?? series[series.length - 1]
  const atNow = series[BACK_MONTHS]
  const atEnd = series[series.length - 1]
  const selected = potholes.find((p) => p.cluster_id === selectedId) ?? null
  const visible = potholes.filter((p) => clusterDetectedAt(p) <= at).length

  return (
    <>
      <a href="#main" className="skip-link">Skip to content</a>
      <Nav wide />
      <main id="main" className="fcast">
        <div className="wrap wrap--wide">
          <Link to="/admin" className="login__back">
            <ArrowLeft size={16} weight="bold" aria-hidden="true" />
            Back to dashboard
          </Link>

          <header className="fcast__head">
            <p className="eyebrow">Forecast</p>
            <h1>What these roads look like if nobody fills them.</h1>
            <p className="fcast__lede">
              Every pothole we have found, projected forward on the assumption that no crew ever
              arrives. Growth is driven by freeze-thaw: a month of January does about {model.damageIndex[0].toFixed(1)} months
              of damage and a month of July does almost none, measured from eight years of Chicago
              weather. Drag the timeline, or press play.
            </p>
          </header>

          <div className="banner banner--info" role="note">
            <WarningCircle size={20} weight="bold" aria-hidden="true" />
            <p>
              <strong>Synthetic locations.</strong> This project has no pothole history of its own,
              so the {potholes.length} locations here were generated. Their <em>timing</em> is real:
              births follow the freeze-thaw damage index measured from Chicago weather 2011-2018,
              and each winter is scaled by a freeze-thaw day count drawn from the observed 35-96
              range. The growth law itself is an assumption -- no published growth rate exists for
              untreated potholes.
            </p>
          </div>

          <section className="fcast__controls" aria-label="Timeline">
            <div className="fcast__transport">
              <button type="button" className="btn btn--ghost btn--sm"
                onClick={() => { setPlaying(false); setOffset(-BACK_MONTHS) }}>
                <SkipBack size={16} weight="bold" aria-hidden="true" />
                Start
              </button>
              <button type="button" className="btn btn--ghost btn--sm"
                onClick={() => setPlaying((p) => !p)} aria-pressed={playing}>
                {playing ? <Pause size={16} weight="bold" aria-hidden="true" />
                  : <Play size={16} weight="bold" aria-hidden="true" />}
                {playing ? 'Pause' : 'Play'}
              </button>
              <p className="fcast__stamp">
                <strong>{stamp(at)}</strong>
                <span className={offset > 0 ? 'tag tag--amber' : 'tag'}>
                  {offset > 0 ? 'forecast' : 'observed'}
                </span>
              </p>
            </div>

            <label className="fcast__slider">
              <span className="sr-only">Month</span>
              <input type="range" min={-BACK_MONTHS} max={AHEAD_MONTHS} step={1} value={offset}
                onChange={(e) => { setPlaying(false); setOffset(Number(e.target.value)) }} />
            </label>
          </section>

          <dl className="fcast__stats">
            <div><dt>Potholes found by {stamp(at)}</dt><dd>{visible}</dd></div>
            <div><dt>Severe now</dt><dd>{atNow?.severe ?? 0}</dd></div>
            <div>
              <dt>Severe in {AHEAD_MONTHS} months</dt>
              <dd>
                {atEnd?.severe ?? 0}
                {atNow?.severe > 0 && (
                  <span className="fcast__lift">
                    {' '}x{((atEnd?.severe ?? 0) / atNow.severe).toFixed(1)}
                  </span>
                )}
              </dd>
            </div>
            <div><dt>Mean severity at {stamp(at)}</dt><dd>{(current?.meanSeverity ?? 0).toFixed(0)}</dd></div>
          </dl>

          <Timeline series={series} offset={offset} nowIndex={BACK_MONTHS}
            onScrub={(o) => { setPlaying(false); setOffset(o) }} />

          <div className="fcast__grid">
            <div className="window fcast__stage">
              <div className="window__bar" aria-hidden="true"><span /><span /><span /></div>
              <div className="fcast__canvas">
                <ForecastMap potholes={potholes} at={at} origin={origin} selectedId={selectedId}
                  onSelect={(id) => setSelectedId((prev) => (prev === id ? null : id))} />
              </div>
              <p className="fcast__legend">
                Circle size and colour are severity at {stamp(at)}. A faint outer ring is the upper
                end of the uncertainty band. Potholes appear on the month we first detected them;
                nothing is drawn before that, because before that we did not know.
              </p>
            </div>
            <Detail pothole={selected} at={at} origin={origin} />
          </div>

          <section className="fcast__caveats" aria-labelledby="caveats-title">
            <h2 id="caveats-title">What this model cannot tell you</h2>
            <ul>
              <li>
                <strong>It forecasts from detection, not from birth.</strong> We know when a phone
                first felt a hole, never when the hole started. Every curve begins mid-story.
              </li>
              <li>
                <strong>Nothing here is validated against a pothole that was left alone.</strong>
                {' '}Chicago fills them, at a median of 6 days. The growth law is anchored to the
                266-day median gap between repeat reports on the same block -- a real Chicago
                timescale, but not the same quantity.
              </li>
              <li>
                <strong>Traffic is deliberately absent.</strong> It correlated with neither pothole
                count (r = +0.03) nor damage per block across 1,271 traffic counters. The physical
                literature says traffic propagates damage; Chicago&apos;s own data cannot resolve
                it, because every counter sits on an arterial.
              </li>
              <li>
                <strong>A hard winter is not predictable a year out.</strong> Freeze-thaw day counts
                do not rank winters by pothole volume in the eight years available. The seasonal
                shape within a year is used; which year is worse is not claimed.
              </li>
              <li>
                <strong>Nobody repairs anything in this scenario.</strong> That is the question
                being asked, not a forecast of what will happen.
              </li>
            </ul>
          </section>
        </div>
      </main>
      <Footer wide />
    </>
  )
}
