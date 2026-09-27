import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowsClockwise, MapPin, Warning } from '@phosphor-icons/react'
import Nav from '../components/Nav.jsx'
import Footer from '../components/Footer.jsx'
import ClusterMap from '../components/ClusterMap.jsx'

const FILTERS = [
  ['confirmed', 'Confirmed'],
  ['candidate', 'Candidates'],
  ['all', 'All'],
]

const STATUS_TAG = { confirmed: 'tag--amber', reported: 'tag--green', candidate: '' }

const percent = (value) => `${Math.round(value * 100)}%`
const coords = (c) => `${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}`

function severityLabel(severity) {
  if (severity >= 70) return 'Severe'
  if (severity >= 40) return 'Moderate'
  return 'Minor'
}

/** Reads the API. Nothing is invented here: if it is not running, the page says so. */
function useClusters() {
  const [state, setState] = useState({ status: 'loading', clusters: [] })

  // Starts already in the loading state, so the fetch itself never has to set
  // state synchronously on mount.
  const load = useCallback(() => {
    let cancelled = false
    fetch('/api/v1/clusters')
      .then((response) => {
        if (!response.ok) throw new Error(`API returned ${response.status}`)
        return response.json()
      })
      .then((clusters) => {
        if (!cancelled) setState({ status: 'ready', clusters })
      })
      .catch((error) => {
        if (!cancelled) setState({ status: 'error', clusters: [], error: error.message })
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(load, [load])

  const reload = useCallback(() => {
    setState({ status: 'loading', clusters: [] })
    load()
  }, [load])

  return { ...state, reload }
}

function Stat({ label, value, note }) {
  return (
    <div className="mapp__stat">
      <dt>{label}</dt>
      <dd>
        <strong>{value}</strong>
        {note && <span>{note}</span>}
      </dd>
    </div>
  )
}

function HitRate({ rate }) {
  return (
    <div className="hitrate">
      <div className="hitrate__track">
        <div className="hitrate__fill" style={{ width: `${Math.min(100, rate * 100)}%` }} />
      </div>
      <span>{percent(rate)}</span>
    </div>
  )
}

// Mounted with the cluster id as its key, so selecting a different location
// gives a fresh component rather than one that has to reset itself.
function ReportPreview({ cluster }) {
  const [state, setState] = useState({ status: 'idle' })

  const prepare = () => {
    setState({ status: 'loading' })
    // confirm stays false: this asks the API to build the request, not send it.
    fetch(`/api/v1/clusters/${cluster.cluster_id}/report`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
      .then((response) => response.json())
      .then((data) => setState({ status: 'ready', data }))
      .catch((error) => setState({ status: 'error', error: error.message }))
  }

  if (cluster.status === 'candidate') {
    return (
      <p className="detail__note">
        Not enough evidence to file yet. A location needs three separate devices, four detections
        and a 35% hit rate.
      </p>
    )
  }

  return (
    <div className="detail__report">
      <button type="button" className="btn btn--ghost btn--sm" onClick={prepare} disabled={state.status === 'loading'}>
        {state.status === 'loading' ? 'Preparing…' : 'Preview 311 request'}
      </button>
      {state.status === 'error' && <p className="detail__note">Could not reach the API: {state.error}</p>}
      {state.status === 'ready' && (
        <>
          <dl className="detail__payload">
            {Object.entries(state.data.preview ?? {}).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{String(value)}</dd>
              </div>
            ))}
          </dl>
          <p className="detail__note">
            Built against {state.data.endpoint}. Nothing was sent — filing a request needs an API key
            and an explicit confirmation from an operator.
          </p>
        </>
      )}
    </div>
  )
}

function Detail({ cluster }) {
  if (!cluster) {
    return (
      <aside className="detail detail--empty">
        <MapPin size={20} weight="bold" aria-hidden="true" />
        <p>Select a location on the map, or a row in the table below.</p>
      </aside>
    )
  }

  return (
    <aside className="detail" aria-label="Selected location">
      <div className="detail__head">
        <p className="detail__coords">{coords(cluster)}</p>
        <span className={`tag ${STATUS_TAG[cluster.status]}`.trim()}>{cluster.status}</span>
      </div>

      <div className="detail__severity">
        <strong>{Math.round(cluster.severity)}</strong>
        <span>
          / 100 — {severityLabel(cluster.severity)}
        </span>
      </div>

      <p className="eyebrow">Evidence</p>
      <dl className="detail__rows">
        <div>
          <dt>Vehicles that felt it</dt>
          <dd>{cluster.detections}</dd>
        </div>
        <div>
          <dt>Separate devices</dt>
          <dd>{cluster.devices}</dd>
        </div>
        <div>
          <dt>Vehicles that drove over it</dt>
          <dd>{cluster.passes}</dd>
        </div>
        <div>
          <dt>Hit rate</dt>
          <dd>
            <HitRate rate={cluster.hit_rate} />
          </dd>
        </div>
        <div>
          <dt>Agreement</dt>
          <dd>{cluster.confidence.toFixed(2)}</dd>
        </div>
        <div>
          <dt>Spread on the ground</dt>
          <dd>{cluster.radius_m.toFixed(1)} m</dd>
        </div>
      </dl>

      <p className="detail__note">
        The hit rate is what separates a broken road from a busy one: {cluster.detections} of{' '}
        {cluster.passes} vehicles that drove over this point registered an impact.
      </p>

      <p className="eyebrow">Report to CDOT</p>
      <ReportPreview key={cluster.cluster_id} cluster={cluster} />
    </aside>
  )
}

function ClusterTable({ clusters, selectedId, onSelect }) {
  return (
    <div className="ctable__scroll">
      <table className="ctable">
        <caption className="sr-only">Detected pothole locations</caption>
        <thead>
          <tr>
            <th scope="col">Location</th>
            <th scope="col">Status</th>
            <th scope="col">Severity</th>
            <th scope="col">Detections</th>
            <th scope="col">Devices</th>
            <th scope="col">Passes</th>
            <th scope="col">Hit rate</th>
            <th scope="col">Agreement</th>
          </tr>
        </thead>
        <tbody>
          {clusters.map((cluster) => (
            <tr
              key={cluster.cluster_id}
              className={cluster.cluster_id === selectedId ? 'is-selected' : undefined}
            >
              <th scope="row">
                <button type="button" onClick={() => onSelect(cluster.cluster_id)}>
                  {coords(cluster)}
                </button>
              </th>
              <td>
                <span className={`tag ${STATUS_TAG[cluster.status]}`.trim()}>{cluster.status}</span>
              </td>
              <td className="ctable__num">{Math.round(cluster.severity)}</td>
              <td className="ctable__num">{cluster.detections}</td>
              <td className="ctable__num">{cluster.devices}</td>
              <td className="ctable__num">{cluster.passes}</td>
              <td className="ctable__num">{percent(cluster.hit_rate)}</td>
              <td className="ctable__num">{cluster.confidence.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Offline({ error, onRetry }) {
  return (
    <div className="mapp__offline">
      <Warning size={22} weight="bold" aria-hidden="true" />
      <h2>No data from the API</h2>
      <p>{error}</p>
      <p>Start it and seed it, then reload:</p>
      <pre>
        <code>
          cd api &amp;&amp; fastapi dev{'\n'}
          python mock/seed_db.py --reset
        </code>
      </pre>
      <button type="button" className="btn btn--ghost btn--sm" onClick={onRetry}>
        <ArrowsClockwise size={16} weight="bold" aria-hidden="true" />
        Try again
      </button>
    </div>
  )
}

export default function MapPage() {
  const { status, clusters, error, reload } = useClusters()
  const [filter, setFilter] = useState('confirmed')
  const [selectedId, setSelectedId] = useState(null)

  const visible = useMemo(
    () => (filter === 'all' ? clusters : clusters.filter((c) => c.status === filter)),
    [clusters, filter],
  )

  const counts = useMemo(() => {
    const confirmed = clusters.filter((c) => c.status === 'confirmed').length
    const devices = new Set()
    let passes = 0
    clusters.forEach((c) => {
      passes = Math.max(passes, c.passes)
      devices.add(c.devices)
    })
    return {
      confirmed,
      candidates: clusters.filter((c) => c.status === 'candidate').length,
      detections: clusters.reduce((sum, c) => sum + c.detections, 0),
      passes,
    }
  }, [clusters])

  // Falls back to the strongest visible location, so the panel is never empty
  // and changing filter cannot leave a selection pointing at a hidden row.
  // Derived during render rather than synced in an effect.
  const selected = visible.find((c) => c.cluster_id === selectedId) ?? visible[0] ?? null

  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Nav wide />
      <main id="main" className="mapp">
        <div className="wrap wrap--wide">
          <Link to="/" className="login__back demo__back">
            <ArrowLeft size={16} weight="bold" aria-hidden="true" />
            Back to site
          </Link>

          <header className="mapp__head">
            <p className="eyebrow">Map</p>
            <h1>Locations several vehicles agreed on.</h1>
            <p className="mapp__lede">
              Every point here was hit by more than one car. A location is only confirmed once three
              separate devices have felt it and enough of the vehicles that drove over the spot
              registered an impact — which is the part a self-reported form cannot do.
            </p>
          </header>

          {status === 'error' && <Offline error={error} onRetry={reload} />}

          {status === 'loading' && <p className="mapp__loading">Loading locations…</p>}

          {status === 'ready' && clusters.length === 0 && (
            <div className="mapp__offline">
              <h2>No locations yet</h2>
              <p>The API is running but has no detections stored. Seed it with a synthetic fleet:</p>
              <pre>
                <code>python mock/seed_db.py --reset</code>
              </pre>
            </div>
          )}

          {status === 'ready' && clusters.length > 0 && (
            <>
              <dl className="mapp__stats">
                <Stat label="Confirmed" value={counts.confirmed} note="ready to report" />
                <Stat label="Candidates" value={counts.candidates} note="not enough agreement yet" />
                <Stat label="Detections" value={counts.detections} note="across all locations" />
                <Stat label="Busiest point" value={counts.passes} note="vehicles passed over it" />
              </dl>

              <div className="mapp__filters" role="tablist" aria-label="Filter locations">
                {FILTERS.map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={filter === value}
                    className={`chip${filter === value ? ' is-active' : ''}`}
                    onClick={() => setFilter(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="mapp__grid">
                <div className="window mapp__stage">
                  <div className="window__bar" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </div>
                  <div className="mapp__canvas">
                    {visible.length > 0 ? (
                      <ClusterMap
                        clusters={visible}
                        selectedId={selected?.cluster_id ?? null}
                        onSelect={setSelectedId}
                      />
                    ) : (
                      <p className="mapp__loading">Nothing matches this filter.</p>
                    )}
                  </div>
                  <p className="mapp__legend">
                    Circle size is severity. Amber is confirmed, outline is a candidate. The dashed
                    ring is how far apart the individual detections were.
                  </p>
                </div>
                <Detail cluster={selected} />
              </div>

              <section className="mapp__table" aria-label="All locations">
                <p className="eyebrow">
                  {visible.length} location{visible.length === 1 ? '' : 's'}
                </p>
                <ClusterTable
                  clusters={visible}
                  selectedId={selected?.cluster_id ?? null}
                  onSelect={setSelectedId}
                />
              </section>
            </>
          )}
        </div>
      </main>
      <Footer wide />
    </>
  )
}
