import { useMemo } from 'react'

// Drawn as plain SVG rather than with a mapping library. There is no street
// basemap yet, so a tile layer would add a dependency and a network call at
// demo time to render something we would then have to restyle into the flat
// monochrome the rest of the site uses. The copy under the map says plainly
// that this is a coordinate grid, not a street map.

const VIEW = { w: 1000, pad: 56, minH: 360, maxH: 720 }
const MIN_SPAN_M = 150
const NICE_STEPS_M = [25, 50, 100, 200, 500, 1000, 2000, 5000]
const M_PER_DEG_LAT = 111320

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value))
const radiusForSeverity = (severity) => 8 + (clamp(severity, 0, 100) / 100) * 10

function niceStep(metres) {
  return NICE_STEPS_M.find((step) => step >= metres) ?? NICE_STEPS_M[NICE_STEPS_M.length - 1]
}

/**
 * Projects lat/lon to SVG units.
 *
 * Metres per degree of longitude shrink towards the poles, so longitude is
 * corrected for latitude -- without it a Chicago street grid comes out stretched
 * by about a third.
 *
 * The view is centred on the middle of the data rather than on the origin of a
 * padded span. A corridor of potholes all sits at one latitude, so its vertical
 * span is zero and gets clamped to a minimum; anchoring at the span's origin
 * would then pin every point to the top edge instead of the middle.
 *
 * The height follows the shape of the data, so a wide, flat street does not get
 * rendered into a tall, mostly empty box.
 */
function useProjection(clusters) {
  return useMemo(() => {
    if (clusters.length === 0) return null

    const lats = clusters.map((c) => c.lat)
    const latMid = (Math.max(...lats) + Math.min(...lats)) / 2
    const mPerLon = M_PER_DEG_LAT * Math.cos((latMid * Math.PI) / 180)

    const toMetres = (c) => ({ x: c.lon * mPerLon, y: -c.lat * M_PER_DEG_LAT })
    const points = clusters.map(toMetres)
    const xs = points.map((p) => p.x)
    const ys = points.map((p) => p.y)
    const centre = {
      x: (Math.max(...xs) + Math.min(...xs)) / 2,
      y: (Math.max(...ys) + Math.min(...ys)) / 2,
    }
    const spanX = Math.max(MIN_SPAN_M, Math.max(...xs) - Math.min(...xs))
    const spanY = Math.max(MIN_SPAN_M, Math.max(...ys) - Math.min(...ys))

    const innerW = VIEW.w - VIEW.pad * 2
    const height = clamp(Math.round(innerW * (spanY / spanX)) + VIEW.pad * 2, VIEW.minH, VIEW.maxH)
    const innerH = height - VIEW.pad * 2
    const scale = Math.min(innerW / spanX, innerH / spanY) // px per metre

    const toPx = (c) => {
      const m = toMetres(c)
      return {
        x: VIEW.w / 2 + (m.x - centre.x) * scale,
        y: height / 2 + (m.y - centre.y) * scale,
      }
    }
    return { scale, toPx, height, gridStep: niceStep(innerW / 4 / scale) }
  }, [clusters])
}

function Grid({ projection }) {
  const { height } = projection
  const step = projection.gridStep * projection.scale
  if (step < 24) return null

  const lines = []
  const top = VIEW.pad
  const bottom = height - VIEW.pad
  for (let x = VIEW.w / 2; x <= VIEW.w - VIEW.pad; x += step) {
    lines.push(<line key={`vr${x}`} x1={x} y1={top} x2={x} y2={bottom} />)
  }
  for (let x = VIEW.w / 2 - step; x >= VIEW.pad; x -= step) {
    lines.push(<line key={`vl${x}`} x1={x} y1={top} x2={x} y2={bottom} />)
  }
  for (let y = height / 2; y <= bottom; y += step) {
    lines.push(<line key={`hd${y}`} x1={VIEW.pad} y1={y} x2={VIEW.w - VIEW.pad} y2={y} />)
  }
  for (let y = height / 2 - step; y >= top; y -= step) {
    lines.push(<line key={`hu${y}`} x1={VIEW.pad} y1={y} x2={VIEW.w - VIEW.pad} y2={y} />)
  }
  return <g className="cmap__grid">{lines}</g>
}

function ScaleBar({ projection }) {
  const metres = projection.gridStep
  const width = metres * projection.scale
  const y = projection.height - 22
  const x = VIEW.pad
  return (
    <g className="cmap__scale">
      <line x1={x} y1={y} x2={x + width} y2={y} />
      <line x1={x} y1={y - 5} x2={x} y2={y + 5} />
      <line x1={x + width} y1={y - 5} x2={x + width} y2={y + 5} />
      <text x={x + width + 10} y={y + 4}>
        {metres >= 1000 ? `${metres / 1000} km` : `${metres} m`}
      </text>
    </g>
  )
}

function Compass({ height }) {
  const x = VIEW.w - 40
  const top = Math.min(VIEW.pad, height / 2 - 40)
  return (
    <g className="cmap__north" aria-hidden="true">
      <line x1={x} y1={top + 34} x2={x} y2={top} />
      <path d={`M ${x - 4} ${top + 7} L ${x} ${top} L ${x + 4} ${top + 7} Z`} />
      <text x={x} y={top + 50}>
        N
      </text>
    </g>
  )
}

function Pin({ cluster, projection, selected, onSelect }) {
  const { x, y } = projection.toPx(cluster)
  const r = radiusForSeverity(cluster.severity)
  // The cluster's own spread on the ground, so the map admits how precisely it
  // knows where the hole is rather than implying a single exact point.
  const spread = cluster.radius_m * projection.scale

  return (
    <g
      className={`cmap__pin cmap__pin--${cluster.status}${selected ? ' is-selected' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={`${cluster.status} pothole, severity ${Math.round(cluster.severity)} of 100, ${cluster.devices} devices`}
      aria-pressed={selected}
      onClick={() => onSelect(cluster.cluster_id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect(cluster.cluster_id)
        }
      }}
    >
      {spread > r && <circle className="cmap__spread" cx={x} cy={y} r={spread} />}
      <circle className="cmap__halo" cx={x} cy={y} r={r + 9} />
      {selected && <circle className="cmap__ring" cx={x} cy={y} r={r + 6} />}
      <circle className="cmap__dot" cx={x} cy={y} r={r} />
      {cluster.status !== 'candidate' && r >= 11 && (
        <text className="cmap__label" x={x} y={y + 4}>
          {Math.round(cluster.severity)}
        </text>
      )}
    </g>
  )
}

export default function ClusterMap({ clusters, selectedId, onSelect }) {
  const projection = useProjection(clusters)
  if (!projection) return null

  // Draw candidates first so confirmed pins are never hidden behind them.
  const rank = { candidate: 0, confirmed: 1, reported: 2 }
  const order = [...clusters].sort((a, b) => rank[a.status] - rank[b.status])

  return (
    <svg
      className="cmap"
      viewBox={`0 0 ${VIEW.w} ${projection.height}`}
      role="group"
      aria-label="Pothole locations plotted on a coordinate grid"
    >
      <rect className="cmap__bg" x="0" y="0" width={VIEW.w} height={projection.height} />
      <Grid projection={projection} />
      <Compass height={projection.height} />
      {order.map((cluster) => (
        <Pin
          key={cluster.cluster_id}
          cluster={cluster}
          projection={projection}
          selected={cluster.cluster_id === selectedId}
          onSelect={onSelect}
        />
      ))}
      <ScaleBar projection={projection} />
    </svg>
  )
}
