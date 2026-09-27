import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowsIn,
  ArrowsOut,
  Info,
  Pause,
  Play,
  SkipBack,
  X,
} from '@phosphor-icons/react'
import Nav from '../components/Nav.jsx'
import Clamp from '../components/Clamp.jsx'
import ForecastMap from '../components/ForecastMap.jsx'
import WeatherLayer from '../components/WeatherLayer.jsx'
import Conditions from '../components/Conditions.jsx'
import Method from '../components/Method.jsx'
import history from '../forecast/history.js'
import { useMediaQuery } from '../useMediaQuery.js'
import {
  climateFor,
  clusterDetectedAt,
  fleetTrack,
  monthsToReach,
  precipitationFor,
  severityAt,
  track,
} from '../forecast/lifecycle.js'

const BACK_MONTHS = 36
const AHEAD_MONTHS = 24
const STEP_MS = 420

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const stamp = (d) => `${MONTHS[d.getMonth()]} ${d.getFullYear()}`
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

// Below this width the timeline switches to a narrower viewBox, or it renders
// only a few dozen pixels high on a phone.
const NARROW = '(max-width: 559px)'

const monthsFromNow = (origin, offset) =>
  new Date(origin.getFullYear(), origin.getMonth() + offset, origin.getDate())

/* ------------------------------- Timeline chart ---------------------------- */

function Timeline({ series, offset, onScrub, nowIndex }) {
  // Wide and flat on purpose: the SVG scales to the container, so the viewBox
  // aspect ratio is what decides how many vertical pixels the chart eats. At
  // 2400 x 200 it lands around 130px on a laptop, where 1000 x 144 took 210.
  // A phone is a quarter as wide, so it gets a quarter of the width, which
  // keeps the chart and its year labels readable there.
  const narrow = useMediaQuery(NARROW)
  const W = narrow ? 600 : 2400
  const H = 148
  const max = Math.max(1, ...series.map((s) => s.minor + s.moderate + s.severe))
  const x = (i) => (i / Math.max(1, series.length - 1)) * W
  const y = (v) => H - (v / max) * H
  const barWidth = Math.min(12, (W / Math.max(1, series.length - 1)) * 0.6)

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
        <span className="eyebrow">Fleet composition, {BACK_MONTHS}m back and {AHEAD_MONTHS} ahead</span>
        <span className="ftl__keys">
          <span className="ftl__key ftl__key--severe">Severe 70+</span>
          <span className="ftl__key ftl__key--moderate">Moderate 40-69</span>
          <span className="ftl__key ftl__key--minor">Minor under 40</span>
          <span className="ftl__key ftl__key--ft">Freeze-thaw days</span>
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H + 52}`} className={`ftl__svg${narrow ? ' ftl__svg--narrow' : ''}`} role="img"
        aria-label="Stacked count of potholes by severity band over time, with freeze-thaw days beneath">
        <path className="ftl__area ftl__area--minor" d={area(total, modPlusSevere)} />
        <path className="ftl__area ftl__area--moderate" d={area(modPlusSevere, severe)} />
        <path className="ftl__area ftl__area--severe" d={area(severe, zero)} />

        <rect className="ftl__future" x={x(nowIndex)} y={0} width={W - x(nowIndex)} height={H} />
        <line className="ftl__now" x1={x(nowIndex)} y1={0} x2={x(nowIndex)} y2={H} />
        <text className="ftl__nowlabel" x={x(nowIndex) + 10} y={24}>today</text>

        <line className="ftl__cursor" x1={x(offset + BACK_MONTHS)} y1={0}
          x2={x(offset + BACK_MONTHS)} y2={H} />

        {/* Freeze-thaw days per month, on the same axis as the growth above it.
            The winter bars line up with every step in the staircase, which is
            the study's correlation drawn rather than asserted. */}
        {series.map((s, i) => {
          const c = climateFor(s.at)
          const h = (c.ft_days / 20) * 18
          return c.ft_days > 0 ? (
            <rect key={`ft${i}`} className={`ftl__ft${c.actual ? '' : ' ftl__ft--normal'}`}
              x={x(i) - barWidth / 2} y={H + 5} width={barWidth} height={Math.max(2, h)} />
          ) : null
        })}
        {series.map((s, i) =>
          s.at.getMonth() === 0 ? (
            <text key={i} className="ftl__year" x={x(i)} y={H + 46}>{s.at.getFullYear()}</text>
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

/* -------------------------------- Detail panel ----------------------------- */

function Detail({ pothole, at, origin }) {
  if (!pothole) {
    return (
      <aside className="fdetail fdetail--empty">
        <Info size={18} weight="bold" aria-hidden="true" />
        <p>Select a pothole for its projected trajectory.</p>
      </aside>
    )
  }
  const detected = clusterDetectedAt(pothole)
  const now = severityAt(pothole, at, { from: detected, forecastFrom: origin })
  const points = track(pothole, { origin, back: 0, months: AHEAD_MONTHS })
  const toSevere = monthsToReach(pothole, 70, { origin })

  const W = 240
  const H = 46
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
      <p className="fdetail__coords">
        {pothole.street ?? `${pothole.lat.toFixed(4)}, ${pothole.lon.toFixed(4)}`}
      </p>
      <div className="fdetail__now">
        <strong>{Math.round(now.severity)}</strong>
        <span>/ 100 &middot; {now.known ? 'observed' : 'forecast'}</span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="fdetail__spark" role="img"
        aria-label="Projected severity over the next two years">
        <path className="fdetail__band" d={bandPath} />
        <path className="fdetail__line" d={line} />
        <line className="fdetail__threshold" x1="0" y1={y(70)} x2={W} y2={y(70)} />
      </svg>
      <p className="fdetail__axis">
        <span>now</span><span>severe 70</span><span>+{AHEAD_MONTHS}m</span>
      </p>

      <dl className="fdetail__rows">
        <div><dt>Found</dt><dd>{stamp(detected)} at {pothole.severity.toFixed(0)}</dd></div>
        <div><dt>Devices</dt><dd>{pothole.devices}</dd></div>
        <div>
          <dt>Reaches severe</dt>
          <dd>{toSevere === 0 ? 'already' : toSevere == null ? `past ${AHEAD_MONTHS}m` : `~${toSevere}m`}</dd>
        </div>
        <div>
          <dt>Range now</dt>
          <dd>{now.known ? 'observed' : `${Math.round(now.lo)}-${Math.round(now.hi)}`}</dd>
        </div>
      </dl>
    </aside>
  )
}

/* --------------------------------- Transport -------------------------------- */

function Transport({ offset, setOffset, playing, setPlaying, at }) {
  return (
    <div className="fcast__controls">
      <div className="fcast__transport">
        <button type="button" className="btn btn--ghost btn--sm"
          onClick={() => { setPlaying(false); setOffset(-BACK_MONTHS) }}>
          <SkipBack size={15} weight="bold" aria-hidden="true" />
          Start
        </button>
        <button type="button" className="btn btn--ghost btn--sm"
          onClick={() => setPlaying((p) => !p)} aria-pressed={playing}>
          {playing ? <Pause size={15} weight="bold" aria-hidden="true" />
            : <Play size={15} weight="bold" aria-hidden="true" />}
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
    </div>
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
  const [expanded, setExpanded] = useState(false)
  const timer = useRef(null)

  const at = useMemo(() => monthsFromNow(origin, offset), [origin, offset])
  const weather = useMemo(() => precipitationFor(at), [at])

  const series = useMemo(
    () => fleetTrack(potholes, { origin, back: BACK_MONTHS, months: AHEAD_MONTHS }),
    [potholes, origin],
  )

  // How much severity the fleet gained this month, so the conditions panel can
  // put a number on what the weather did rather than only describing it.
  const monthlyGrowth = useMemo(() => {
    const i = offset + BACK_MONTHS
    const prev = series[i - 1]
    const now = series[i]
    return prev && now ? now.meanSeverity - prev.meanSeverity : null
  }, [series, offset])

  useEffect(() => {
    if (!playing) return undefined
    timer.current = setInterval(() => {
      setOffset((o) => (o >= AHEAD_MONTHS ? -BACK_MONTHS : o + 1))
    }, STEP_MS)
    return () => clearInterval(timer.current)
  }, [playing])

  // Escape closes the expanded window, which is what a keyboard user will try
  // first and what every other overlay on the web does.
  useEffect(() => {
    if (!expanded) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') setExpanded(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded])

  const current = series[offset + BACK_MONTHS] ?? series[series.length - 1]
  const atNow = series[BACK_MONTHS]
  const atEnd = series[series.length - 1]
  const selected = potholes.find((p) => p.cluster_id === selectedId) ?? null
  const onSelect = useCallback((id) => setSelectedId((prev) => (prev === id ? null : id)), [])

  // One stage, rendered at two sizes. Keeping it a single expression means the
  // expanded window can never drift out of step with the inline one.
  const stage = (compact) => (
    <div className="fcast__canvas">
      <ForecastMap potholes={potholes} at={at} origin={origin} selectedId={selectedId}
        onSelect={onSelect} compact={compact} weather={weather} />
      <WeatherLayer kind={weather.kind} intensity={weather.intensity}
        freezeThaw={weather.freezeThaw} />
    </div>
  )

  return (
    <>
      <a href="#main" className="skip-link">Skip to content</a>
      <Nav />
      <main id="main" className="fcast">
        <div className="wrap">
          <div className="fcast__top">
            <div className="fcast__title">
              <Link to="/admin" className="login__back">
                <ArrowLeft size={15} weight="bold" aria-hidden="true" />
                Back to dashboard
              </Link>
              <h1>What these roads look like if nobody fills them.</h1>
            </div>
            <details className="fcast__note">
              <summary>
                <Info size={14} weight="bold" aria-hidden="true" />
                Synthetic locations, real timing
              </summary>
              <p>
                The {potholes.length} potholes sit on real Chicago street centrelines around Union
                Station, but which streets broke is invented. Their <em>timing</em> is measured:
                births follow the freeze-thaw damage index from Chicago weather 2011-2018, each
                winter scaled by a freeze-thaw count drawn from the observed 35-96 range. The
                growth law is an assumption &mdash; no published growth rate exists for untreated
                potholes.
              </p>
            </details>
          </div>

          <Transport offset={offset} setOffset={setOffset} playing={playing}
            setPlaying={setPlaying} at={at} />

          <dl className="fcast__stats">
            <div><dt>Found by {stamp(at)}</dt><dd>{current?.found ?? 0}</dd></div>
            <div><dt>Severe today</dt><dd>{atNow?.severe ?? 0}</dd></div>
            <div>
              <dt>Severe in {AHEAD_MONTHS}m</dt>
              <dd>
                {atEnd?.severe ?? 0}
                {atNow?.severe > 0 && (
                  <span className="fcast__lift"> x{((atEnd?.severe ?? 0) / atNow.severe).toFixed(1)}</span>
                )}
              </dd>
            </div>
            <div><dt>Mean severity</dt><dd>{(current?.meanSeverity ?? 0).toFixed(0)}</dd></div>
          </dl>

          <Timeline series={series} offset={offset} nowIndex={BACK_MONTHS}
            onScrub={(o) => { setPlaying(false); setOffset(o) }} />

          <div className="fcast__grid">
            <section className="window fcast__stage" aria-label="Map of downtown Chicago">
              <div className="window__bar">
                <span className="window__dots" aria-hidden="true"><span /><span /><span /></span>
                <span className="window__title">Downtown Chicago &middot; Union Station</span>
                <button type="button" className="window__expand" onClick={() => setExpanded(true)}>
                  <ArrowsOut size={14} weight="bold" aria-hidden="true" />
                  Expand
                </button>
              </div>
              {stage(true)}
              <div className="fcast__legend">
                <Clamp lines={2}>
                OpenStreetMap basemap. Radar is that month&apos;s real precipitation, drifting west
                to east; size and colour are severity at {stamp(at)}.
                </Clamp>
              </div>
            </section>

            <div className="fcast__side">
              <Conditions at={at} monthlyGrowth={monthlyGrowth} />
              <Detail pothole={selected} at={at} origin={origin} />
            </div>
          </div>

          <details className="fcast__caveats">
            <summary>What this model cannot tell you</summary>
            <ul>
              <li>
                <strong>It forecasts from detection, not from birth.</strong> We know when a phone
                first felt a hole, never when the hole started. Every curve begins mid-story.
              </li>
              <li>
                <strong>Nothing here is validated against a pothole that was left alone.</strong>
                {' '}Chicago fills them, at a median of 6 days. The growth law is anchored to the
                266-day median gap between repeat reports on the same block &mdash; a real Chicago
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
          </details>

          <Method />
        </div>
      </main>

      {expanded && (
        <div className="fexp" role="dialog" aria-modal="true" aria-label="Map, expanded">
          <button type="button" className="fexp__scrim" onClick={() => setExpanded(false)}
            aria-label="Close the expanded map" tabIndex={-1} />
          <div className="fexp__sheet">
            <header className="fexp__bar">
              <span className="fexp__title">
                Downtown Chicago &middot; Union Station
                <span className="fexp__when">{stamp(at)}</span>
              </span>
              <button type="button" className="btn btn--ghost btn--sm"
                onClick={() => setExpanded(false)}>
                <ArrowsIn size={15} weight="bold" aria-hidden="true" />
                Collapse
              </button>
              <button type="button" className="icon-button" onClick={() => setExpanded(false)}
                aria-label="Close the expanded map">
                <X size={16} weight="bold" aria-hidden="true" />
              </button>
            </header>
            <div className="fexp__body">
              {stage(false)}
              <div className="fexp__side">
                <Transport offset={offset} setOffset={setOffset} playing={playing}
                  setPlaying={setPlaying} at={at} />
                <Conditions at={at} monthlyGrowth={monthlyGrowth} />
                <Detail pothole={selected} at={at} origin={origin} />
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
