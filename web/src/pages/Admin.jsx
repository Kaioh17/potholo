import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowClockwise,
  ArrowLeft,
  CaretDown,
  CaretUp,
  MagnifyingGlass,
  Pause,
  Play,
  WarningCircle,
} from '@phosphor-icons/react'
import Brand from '../components/Brand.jsx'
import Pill from '../admin/Pill.jsx'
import {
  activityStatus,
  clusterStatus,
  confidenceStatus,
  deviceHealth,
  gpsStatus,
  rateStatus,
  severityStatus,
} from '../admin/status.js'
import { API_URL, useFleet } from '../admin/useFleet.js'

const ACTIVITY_ORDER = { active: 0, idle: 1, offline: 2 }

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

function timeAgo(iso, now) {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

const number = (value) => value.toLocaleString('en-US')

/* ------------------------------ Summary tiles ------------------------------ */

function Tile({ label, value, children }) {
  return (
    <div className="kpi">
      <p className="kpi__label">{label}</p>
      <p className="kpi__value">{value}</p>
      <div className="kpi__foot">{children}</div>
    </div>
  )
}

function Summary({ devices, clusters, health, setFilter, filter }) {
  const active = devices.filter((d) => d.activity === 'active').length
  const detections = devices.reduce((sum, d) => sum + d.detections, 0)
  const confirmed = clusters.filter((c) => c.status !== 'candidate').length
  const withHits = devices.filter((d) => d.mean_confidence != null)
  const meanConfidence = withHits.length
    ? withHits.reduce((sum, d) => sum + d.mean_confidence * d.detections, 0) / withHits.reduce((sum, d) => sum + d.detections, 0)
    : null
  const counts = { Healthy: 0, Watch: 0, Problem: 0 }
  health.forEach((h) => (counts[h.label] += 1))

  return (
    <section className="kpis" aria-label="Fleet summary">
      <Tile label="Devices" value={number(devices.length)}>
        <Pill tone={active ? 'green' : 'grey'}>{active} active</Pill>
        {devices.length - active > 0 && <Pill tone="amber">{devices.length - active} quiet</Pill>}
      </Tile>

      <Tile label="Fleet health" value={devices.length ? `${Math.round((counts.Healthy / devices.length) * 100)}%` : '-'}>
        <button type="button" className="pill-button" onClick={() => setFilter(filter === 'attention' ? 'all' : 'attention')} aria-pressed={filter === 'attention'} title="Show devices that need attention">
          <Pill tone="green">{counts.Healthy} healthy</Pill>
          <Pill tone={counts.Watch ? 'amber' : 'grey'}>{counts.Watch} watch</Pill>
          <Pill tone={counts.Problem ? 'red' : 'grey'}>{counts.Problem} problem</Pill>
        </button>
      </Tile>

      <Tile label="Detections" value={number(detections)}>
        <Pill tone="blue">{clusters.length} locations</Pill>
      </Tile>

      <Tile label="Confirmed potholes" value={number(confirmed)}>
        <Pill tone="green">{clusters.filter((c) => c.status === 'confirmed').length} confirmed</Pill>
        <Pill tone="blue">{clusters.filter((c) => c.status === 'reported').length} reported</Pill>
        <Pill tone="amber">{clusters.filter((c) => c.status === 'candidate').length} candidates</Pill>
      </Tile>

      <Tile label="Mean confidence" value={meanConfidence == null ? '-' : `${Math.round(meanConfidence * 100)}%`}>
        <Pill tone={confidenceStatus(meanConfidence).tone}>{meanConfidence == null ? 'No hits yet' : 'Per detection'}</Pill>
      </Tile>
    </section>
  )
}

/* ------------------------------- Device table ------------------------------ */

const COLUMNS = [
  { key: 'device_id', label: 'Device', value: (d) => d.device_id.toLowerCase() },
  { key: 'health', label: 'Health', value: (d) => d.health.rank },
  { key: 'activity', label: 'Status', value: (d) => ACTIVITY_ORDER[d.activity] },
  { key: 'last_seen', label: 'Last seen', value: (d) => new Date(d.last_seen).getTime() },
  { key: 'sample_rate_hz', label: 'Sample rate', value: (d) => d.sample_rate_hz },
  { key: 'gps', label: 'GPS', value: (d) => d.mean_gps_error_m ?? Infinity },
  { key: 'detections', label: 'Detections', value: (d) => d.detections },
  { key: 'confidence', label: 'Confidence', value: (d) => d.mean_confidence ?? -1 },
]

function DeviceDetail({ device }) {
  return (
    <div className="detail">
      <dl className="detail__grid">
        <div><dt>Latest trip</dt><dd>{device.last_trip_id}</dd></div>
        <div><dt>First seen</dt><dd>{new Date(device.first_seen).toLocaleString()}</dd></div>
        <div><dt>Batches uploaded</dt><dd>{number(device.batches)}</dd></div>
        <div><dt>Samples received</dt><dd>{number(device.samples)}</dd></div>
        <div><dt>GPS fixes in last batch</dt><dd>{device.gps_fixes}</dd></div>
        <div><dt>Locations found</dt><dd>{device.clusters} ({device.confirmed_clusters} confirmed)</dd></div>
        <div>
          <dt>Severity found</dt>
          <dd className="detail__pills">
            <Pill tone={severityStatus(device.mean_severity).tone}>Mean {device.mean_severity == null ? 'none' : device.mean_severity.toFixed(0)}</Pill>
            <Pill tone={severityStatus(device.max_severity).tone}>Max {device.max_severity == null ? 'none' : device.max_severity.toFixed(0)}</Pill>
          </dd>
        </div>
      </dl>
      <ul className="detail__reasons">
        {device.health.reasons.map((reason) => (
          <li key={reason}>
            <Pill tone={device.health.tone}>{device.health.label}</Pill> {reason}
          </li>
        ))}
      </ul>
    </div>
  )
}

const FILTERS = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'active', label: 'Active', test: (d) => d.activity === 'active' },
  { id: 'idle', label: 'Idle', test: (d) => d.activity === 'idle' },
  { id: 'offline', label: 'Offline', test: (d) => d.activity === 'offline' },
  { id: 'attention', label: 'Needs attention', test: (d) => d.health.rank > 0 },
]

function DeviceTable({ devices, filter, setFilter, now }) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState({ key: 'last_seen', dir: 'desc' })
  const [open, setOpen] = useState(() => new Set())

  const rows = useMemo(() => {
    const column = COLUMNS.find((c) => c.key === sort.key)
    const test = FILTERS.find((f) => f.id === filter).test
    const needle = query.trim().toLowerCase()
    const shown = devices.filter((d) => test(d) && (!needle || d.device_id.toLowerCase().includes(needle)))
    const sign = sort.dir === 'asc' ? 1 : -1
    return shown.sort((a, b) => {
      const [x, y] = [column.value(a), column.value(b)]
      return (x < y ? -1 : x > y ? 1 : 0) * sign
    })
  }, [devices, filter, query, sort])

  const toggleSort = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }))
  const toggleOpen = (id) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })

  return (
    <section className="panel" aria-labelledby="devices-title">
      <div className="panel__head">
        <h2 id="devices-title">Devices</h2>
        <label className="search">
          <MagnifyingGlass size={16} weight="bold" aria-hidden="true" />
          <input type="search" placeholder="Search device" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search devices" />
        </label>
      </div>

      <div className="chips" role="group" aria-label="Filter devices">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" className="chip" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label}
            <span>{devices.filter(f.test).length}</span>
          </button>
        ))}
      </div>

      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.key} scope="col" aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  <button type="button" onClick={() => toggleSort(c.key)}>
                    {c.label}
                    {sort.key === c.key && (sort.dir === 'asc' ? <CaretUp size={12} weight="bold" /> : <CaretDown size={12} weight="bold" />)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const isOpen = open.has(d.device_id)
              return (
                <Fragment key={d.device_id}>
                  <tr className={isOpen ? 'is-open' : ''}>
                    <td>
                      <button type="button" className="expander" aria-expanded={isOpen} onClick={() => toggleOpen(d.device_id)}>
                        <CaretDown size={12} weight="bold" aria-hidden="true" />
                        {d.device_id}
                      </button>
                    </td>
                    <td><Pill tone={d.health.tone} title={d.health.reasons.join('. ')}>{d.health.label}</Pill></td>
                    <td><Pill tone={activityStatus(d.activity).tone}>{activityStatus(d.activity).label}</Pill></td>
                    <td className="muted">{timeAgo(d.last_seen, now)}</td>
                    <td><Pill tone={rateStatus(d.sample_rate_hz).tone}>{rateStatus(d.sample_rate_hz).label}</Pill></td>
                    <td><Pill tone={gpsStatus(d.mean_gps_error_m).tone}>{gpsStatus(d.mean_gps_error_m).label}</Pill></td>
                    <td className="num">{d.detections}</td>
                    <td><Pill tone={confidenceStatus(d.mean_confidence).tone}>{confidenceStatus(d.mean_confidence).label}</Pill></td>
                  </tr>
                  {isOpen && (
                    <tr className="detail-row">
                      <td colSpan={COLUMNS.length}><DeviceDetail device={d} /></td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
        {rows.length === 0 && <p className="empty">No devices match.</p>}
      </div>
    </section>
  )
}

/* ------------------------------ Pothole locations --------------------------- */

const CLUSTER_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'confirmed', label: 'Confirmed' },
  { id: 'reported', label: 'Reported' },
  { id: 'candidate', label: 'Candidates' },
]

function ClusterList({ clusters, now }) {
  const [filter, setFilter] = useState('all')
  const shown = clusters.filter((c) => filter === 'all' || c.status === filter)

  return (
    <section className="panel" aria-labelledby="clusters-title">
      <div className="panel__head">
        <h2 id="clusters-title">Pothole locations</h2>
      </div>
      <div className="chips" role="group" aria-label="Filter locations">
        {CLUSTER_FILTERS.map((f) => (
          <button key={f.id} type="button" className="chip" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label}
            <span>{f.id === 'all' ? clusters.length : clusters.filter((c) => c.status === f.id).length}</span>
          </button>
        ))}
      </div>

      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              {['Location', 'Status', 'Severity', 'Confidence', 'Devices', 'Hit rate', 'Last seen'].map((label) => (
                <th key={label} scope="col"><span className="th-label">{label}</span></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => {
              const severity = severityStatus(c.severity)
              const confidence = confidenceStatus(c.confidence)
              return (
                <tr key={c.cluster_id}>
                  <td className="mono">{c.lat.toFixed(5)}, {c.lon.toFixed(5)}</td>
                  <td><Pill tone={clusterStatus(c.status).tone}>{clusterStatus(c.status).label}</Pill></td>
                  <td><Pill tone={severity.tone}>{severity.label} {c.severity.toFixed(0)}</Pill></td>
                  <td><Pill tone={confidence.tone}>{confidence.label}</Pill></td>
                  <td className="num">{c.devices}</td>
                  <td>
                    <span className="bar" title={`${c.detections} hits from ${c.passes} passes`}>
                      <span style={{ width: `${Math.min(100, c.hit_rate * 100)}%` }} />
                    </span>
                    <span className="bar__text">{Math.round(c.hit_rate * 100)}%</span>
                  </td>
                  <td className="muted">{timeAgo(c.last_seen, now)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {shown.length === 0 && <p className="empty">No locations in this state.</p>}
      </div>
    </section>
  )
}

/* ---------------------------------- Page ----------------------------------- */

export default function Admin() {
  const [live, setLive] = useState(true)
  const [filter, setFilter] = useState('all')
  const { devices, clusters, updatedAt, error, loading, refresh } = useFleet(live)
  const now = useNow()

  const withHealth = useMemo(() => devices.map((d) => ({ ...d, health: deviceHealth(d) })), [devices])
  const unreachable = error && !updatedAt

  return (
    <div className="admin">
      <header className="admin__bar">
        <div className="wrap wrap--wide admin__bar-inner">
          <div className="admin__title">
            <Brand />
            <span className="tag tag--amber">Admin</span>
          </div>
          <div className="admin__controls">
            <Pill tone={error ? 'red' : updatedAt ? 'green' : 'grey'}>{error ? 'API unreachable' : updatedAt ? 'API online' : 'Connecting'}</Pill>
            <span className="muted admin__updated">{updatedAt ? `Updated ${timeAgo(updatedAt, now)}` : ''}</span>
            <button type="button" className="btn btn--ghost btn--sm" onClick={refresh}>
              <ArrowClockwise size={16} weight="bold" aria-hidden="true" />
              Refresh
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setLive((v) => !v)} aria-pressed={live}>
              {live ? <Pause size={16} weight="bold" aria-hidden="true" /> : <Play size={16} weight="bold" aria-hidden="true" />}
              {live ? 'Pause live' : 'Resume live'}
            </button>
          </div>
        </div>
      </header>

      <main className="wrap wrap--wide admin__main">
        <Link to="/" className="login__back">
          <ArrowLeft size={16} weight="bold" aria-hidden="true" />
          Back to site
        </Link>
        <div className="admin__head">
          <h1>Fleet dashboard</h1>
          <p>Every device that has uploaded to the API, and the potholes they have found. Refreshes every 5 seconds.</p>
        </div>

        {error && (
          <div className="banner" role="alert">
            <WarningCircle size={20} weight="bold" aria-hidden="true" />
            <p>
              {unreachable ? `Cannot reach the API at ${API_URL}.` : 'The last refresh failed, so the numbers below may be out of date.'}{' '}
              {unreachable && <>Start it with <code>cd api && fastapi dev</code>.</>}
            </p>
          </div>
        )}

        {loading && <p className="empty">Loading fleet...</p>}

        {!loading && !unreachable && devices.length === 0 && (
          <div className="panel empty-state">
            <h2>No devices yet</h2>
            <p>Devices appear after their first upload. To add a simulated fleet, run <code>python mock/fleet.py</code>.</p>
          </div>
        )}

        {!unreachable && devices.length > 0 && (
          <>
            <Summary devices={devices} clusters={clusters} health={withHealth.map((d) => d.health)} filter={filter} setFilter={setFilter} />
            <DeviceTable devices={withHealth} filter={filter} setFilter={setFilter} now={now} />
            <ClusterList clusters={clusters} now={now} />
          </>
        )}
      </main>
    </div>
  )
}
