import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowClockwise,
  ArrowLeft,
  CaretDown,
  CaretLeft,
  CaretRight,
  CaretUp,
  MagnifyingGlass,
  Pause,
  Play,
  WarningCircle,
  X,
} from '@phosphor-icons/react'
import Brand from '../components/Brand.jsx'
import ClusterMap from '../components/ClusterMap.jsx'
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

const DEVICE_PAGE_SIZE = 6

function DeviceTable({ devices, filter, setFilter, now }) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState({ key: 'last_seen', dir: 'desc' })
  const [open, setOpen] = useState(() => new Set())
  // The filter can also be changed from the summary tile, so the page is
  // remembered with the filter it was chosen under and falls back to the first
  // page when that filter is no longer the active one.
  const [paging, setPaging] = useState({ page: 1, filter })
  const page = paging.filter === filter ? paging.page : 1
  const setPage = (next) => setPaging({ page: next, filter })

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

  // Clamped so a poll that drops the last row of the final page slides back a
  // page instead of showing a blank table.
  const pageCount = Math.max(1, Math.ceil(rows.length / DEVICE_PAGE_SIZE))
  const current = Math.min(page, pageCount)
  const from = (current - 1) * DEVICE_PAGE_SIZE
  const pageRows = rows.slice(from, from + DEVICE_PAGE_SIZE)

  const toggleSort = (key) => {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }))
    setPage(1)
  }
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
          <input type="search" placeholder="Search device" value={query} onChange={(e) => { setQuery(e.target.value); setPage(1) }} aria-label="Search devices" />
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
            {pageRows.map((d) => {
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

      {rows.length > 0 && (
        <nav className="pager" aria-label="Device pages">
          <button type="button" className="pager__step" onClick={() => setPage(current - 1)} disabled={current === 1} aria-label="Previous six devices">
            <CaretLeft size={14} weight="bold" aria-hidden="true" />
          </button>
          <p className="pager__status" aria-live="polite">
            {from + 1}-{Math.min(from + DEVICE_PAGE_SIZE, rows.length)} of {rows.length}
            <span className="pager__page"> &middot; page {current} of {pageCount}</span>
          </p>
          <button type="button" className="pager__step" onClick={() => setPage(current + 1)} disabled={current === pageCount} aria-label="Next six devices">
            <CaretRight size={14} weight="bold" aria-hidden="true" />
          </button>
        </nav>
      )}
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

const CLUSTER_PAGE_SIZE = 10

// Legend keys, in the order a hole moves through: spotted, agreed on, filed.
const CLUSTER_KEYS = [
  ['candidate', 'Candidate'],
  ['confirmed', 'Confirmed'],
  ['reported', 'Reported'],
]

// Status is ordinal, not alphabetical: this is the order a hole travels, so
// ranking by it sorts locations by how far along they are, which is the only
// ordering of a status that means anything.
const CLUSTER_RANK = { candidate: 0, confirmed: 1, reported: 2 }

// Every column here is rankable, but not through one shared accessor -- a
// location needs longitude as a tiebreak behind latitude -- so each column
// carries its own comparator and returns a number.
const CLUSTER_COLUMNS = [
  { key: 'location', label: 'Location', compare: (a, b) => a.lat - b.lat || a.lon - b.lon },
  { key: 'status', label: 'Status', compare: (a, b) => CLUSTER_RANK[a.status] - CLUSTER_RANK[b.status] },
  { key: 'severity', label: 'Severity', compare: (a, b) => a.severity - b.severity },
  { key: 'confidence', label: 'Confidence', compare: (a, b) => a.confidence - b.confidence },
  { key: 'devices', label: 'Devices', compare: (a, b) => a.devices - b.devices },
  { key: 'hit_rate', label: 'Hit rate', compare: (a, b) => a.hit_rate - b.hit_rate },
  { key: 'last_seen', label: 'Last seen', compare: (a, b) => new Date(a.last_seen) - new Date(b.last_seen) },
]

function ClusterList({ clusters, now }) {
  const [filter, setFilter] = useState('all')
  const [selectedId, setSelectedId] = useState(null)
  // Worst first: on an operations dashboard the severe holes are the point.
  const [sort, setSort] = useState({ key: 'severity', dir: 'desc' })
  const [page, setPage] = useState(1)

  // The filtered, ranked list the table pages through and the map draws from,
  // so the chips and the column sort govern both at once and the two can never
  // show a different set of holes. Memoised because the map projects from this
  // array's identity, and the dashboard re-renders every second to update the
  // "last seen" column.
  const sorted = useMemo(() => {
    const column = CLUSTER_COLUMNS.find((c) => c.key === sort.key)
    const sign = sort.dir === 'asc' ? 1 : -1
    return clusters
      .filter((c) => filter === 'all' || c.status === filter)
      .sort((a, b) => column.compare(a, b) * sign)
  }, [clusters, filter, sort])

  // Clamped rather than reset through an effect, so a poll that drops the last
  // row of the final page slides back a page instead of showing a blank table.
  const pageCount = Math.max(1, Math.ceil(sorted.length / CLUSTER_PAGE_SIZE))
  const current = Math.min(page, pageCount)
  const from = (current - 1) * CLUSTER_PAGE_SIZE
  const rows = useMemo(() => sorted.slice(from, from + CLUSTER_PAGE_SIZE), [sorted, from])

  // The map always draws every location the filter lets through, whatever page
  // the table is on.
  // A selection that the filter has removed is dropped rather than kept
  // invisibly, so the highlighted row and the ringed pin always agree. Derived
  // during render, not synced in an effect.
  const selected = sorted.find((c) => c.cluster_id === selectedId) ?? null
  // Picking a pin on another page turns the table to that row's page, so the
  // selection is never highlighted somewhere the table is not showing.
  const toggleSelect = (id) => {
    setSelectedId((prev) => (prev === id ? null : id))
    const index = sorted.findIndex((c) => c.cluster_id === id)
    if (index >= 0) setPage(Math.floor(index / CLUSTER_PAGE_SIZE) + 1)
  }

  // Re-ranking moves every row, so the page number stops meaning anything.
  const toggleSort = (key) => {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' }))
    setPage(1)
  }

  const changeFilter = (id) => {
    setFilter(id)
    setPage(1)
  }

  return (
    <section className="panel" aria-labelledby="clusters-title">
      <div className="panel__head">
        <h2 id="clusters-title">Pothole locations</h2>
        {selected && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setSelectedId(null)}>
            <X size={16} weight="bold" aria-hidden="true" />
            Clear selection
          </button>
        )}
      </div>
      <div className="chips" role="group" aria-label="Filter locations">
        {CLUSTER_FILTERS.map((f) => (
          <button key={f.id} type="button" className="chip" aria-pressed={filter === f.id} onClick={() => changeFilter(f.id)}>
            {f.label}
            <span>{f.id === 'all' ? clusters.length : clusters.filter((c) => c.status === f.id).length}</span>
          </button>
        ))}
      </div>

      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              {CLUSTER_COLUMNS.map((c) => (
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
            {rows.map((c) => {
              const severity = severityStatus(c.severity)
              const confidence = confidenceStatus(c.confidence)
              const isSelected = c.cluster_id === selected?.cluster_id
              return (
                <tr key={c.cluster_id} className={isSelected ? 'is-selected' : ''}>
                  <td className="mono">
                    <button type="button" className="cell-button" aria-pressed={isSelected} onClick={() => toggleSelect(c.cluster_id)}>
                      {c.lat.toFixed(5)}, {c.lon.toFixed(5)}
                    </button>
                  </td>
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
        {sorted.length === 0 && <p className="empty">No locations in this state.</p>}
      </div>

      {sorted.length > 0 && (
        <nav className="pager" aria-label="Pothole location pages">
          <button
            type="button"
            className="pager__step"
            onClick={() => setPage(current - 1)}
            disabled={current === 1}
            aria-label="Previous ten locations"
          >
            <CaretLeft size={14} weight="bold" aria-hidden="true" />
          </button>
          <p className="pager__status" aria-live="polite">
            {from + 1}-{Math.min(from + CLUSTER_PAGE_SIZE, sorted.length)} of {sorted.length}
            <span className="pager__page"> &middot; page {current} of {pageCount}</span>
          </p>
          <button
            type="button"
            className="pager__step"
            onClick={() => setPage(current + 1)}
            disabled={current === pageCount}
            aria-label="Next ten locations"
          >
            <CaretRight size={14} weight="bold" aria-hidden="true" />
          </button>
        </nav>
      )}

      {sorted.length > 0 && (
        <figure className="clustermap">
          <figcaption className="clustermap__head">
            <span className="th-label">
              {`Map of all ${sorted.length} location${sorted.length === 1 ? '' : 's'}`}
            </span>
            <span className="clustermap__keys">
              {CLUSTER_KEYS.map(([status, label]) => (
                <Pill key={status} tone={clusterStatus(status).tone}>{label}</Pill>
              ))}
            </span>
          </figcaption>
          <div className="clustermap__canvas">
            <ClusterMap clusters={sorted} selectedId={selected?.cluster_id ?? null} onSelect={toggleSelect} />
          </div>
          <p className="clustermap__note">
            {selected
              ? `Selected ${selected.lat.toFixed(5)}, ${selected.lon.toFixed(5)} — severity ${selected.severity.toFixed(0)} of 100, found by ${selected.devices} device${selected.devices === 1 ? '' : 's'}.`
              : 'Select a row or a pin to tie the two together. Circle size is severity; the dashed ring is how far apart that location’s own detections were. Positions sit on a coordinate grid — there is no street basemap yet.'}
          </p>
        </figure>
      )}
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
