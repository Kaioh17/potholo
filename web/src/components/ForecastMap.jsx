import { useMemo } from 'react'
import { severityAt, severityBand, clusterDetectedAt } from '../forecast/lifecycle.js'

/**
 * The city over time: what was found, and what the model says it becomes.
 *
 * Drawn as plain SVG, like `ClusterMap`, and for the same reason -- there is no
 * street basemap, so a tile layer would add a dependency and a network call to
 * render something we would then restyle into the site's flat monochrome.
 *
 * The one thing this map must not do is move. `ClusterMap` fits its frame to
 * the clusters it is given, which is right for a table that filters. Here the
 * set of visible potholes changes every time the scrubber moves, and a frame
 * that refit itself each step would make the whole city appear to drift while
 * the user is trying to read a single street. So the projection is computed
 * once from every pothole in the dataset and held fixed for the whole timeline.
 */

const VIEW = { w: 1000, pad: 44, minH: 380, maxH: 640 }
const M_PER_DEG_LAT = 111_320

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

/** Radius in SVG units for a severity, on the same 0-100 scale as the table. */
const radiusFor = (severity) => 3.2 + (clamp(severity, 0, 100) / 100) * 9

function useStableProjection(potholes) {
  return useMemo(() => {
    if (potholes.length === 0) return null
    const lats = potholes.map((p) => p.lat)
    const lons = potholes.map((p) => p.lon)
    const latMid = (Math.max(...lats) + Math.min(...lats)) / 2
    // Metres per degree of longitude shrink towards the poles; without this a
    // Chicago grid comes out stretched by about a third.
    const mPerLon = M_PER_DEG_LAT * Math.cos((latMid * Math.PI) / 180)

    const xs = lons.map((lon) => lon * mPerLon)
    const ys = lats.map((lat) => -lat * M_PER_DEG_LAT)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    const spanX = Math.max(1, maxX - minX)
    const spanY = Math.max(1, maxY - minY)

    const innerW = VIEW.w - VIEW.pad * 2
    const height = clamp(
      Math.round(innerW * (spanY / spanX)) + VIEW.pad * 2,
      VIEW.minH,
      VIEW.maxH,
    )
    const innerH = height - VIEW.pad * 2
    const scale = Math.min(innerW / spanX, innerH / spanY)
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2

    const toPx = (p) => ({
      x: VIEW.w / 2 + (p.lon * mPerLon - cx) * scale,
      y: height / 2 + (-p.lat * M_PER_DEG_LAT - cy) * scale,
    })
    return { toPx, height, scale }
  }, [potholes])
}

function ScaleBar({ projection }) {
  // A round number of metres that lands at a sensible on-screen width.
  const metres = [100, 250, 500, 1000, 2000, 5000].find((m) => m * projection.scale > 90) ?? 5000
  const width = metres * projection.scale
  const y = projection.height - 18
  return (
    <g className="fmap__scale">
      <line x1={VIEW.pad} y1={y} x2={VIEW.pad + width} y2={y} />
      <line x1={VIEW.pad} y1={y - 4} x2={VIEW.pad} y2={y + 4} />
      <line x1={VIEW.pad + width} y1={y - 4} x2={VIEW.pad + width} y2={y + 4} />
      <text x={VIEW.pad + width + 8} y={y + 4}>
        {metres >= 1000 ? `${metres / 1000} km` : `${metres} m`}
      </text>
    </g>
  )
}

export default function ForecastMap({ potholes, at, origin, selectedId, onSelect }) {
  const projection = useStableProjection(potholes)

  // Everything the frame needs for this instant, computed in one pass.
  const points = useMemo(() => {
    if (!projection) return []
    return potholes
      .map((pothole) => {
        const detected = clusterDetectedAt(pothole)
        // A pothole that has not been found yet is not drawn. Showing it early
        // would claim we knew about it before we did.
        if (at < detected) return null
        const { severity, hi, known } = severityAt(pothole, at, {
          from: detected,
          forecastFrom: origin,
        })
        return {
          pothole,
          severity,
          hi,
          forecast: !known,
          band: severityBand(severity),
          ...projection.toPx(pothole),
        }
      })
      .filter(Boolean)
      // Draw the worst last so a severe hole is never hidden under a minor one.
      .sort((a, b) => a.severity - b.severity)
  }, [potholes, at, origin, projection])

  if (!projection) return null

  return (
    <svg
      className="fmap"
      viewBox={`0 0 ${VIEW.w} ${projection.height}`}
      role="group"
      aria-label={`Pothole severity across Chicago on ${at.toLocaleDateString()}`}
    >
      <rect className="fmap__bg" x="0" y="0" width={VIEW.w} height={projection.height} />

      {points.map((point) => {
        const r = radiusFor(point.severity)
        const selected = point.pothole.cluster_id === selectedId
        return (
          <g
            key={point.pothole.cluster_id}
            className={`fmap__pin fmap__pin--${point.band}${point.forecast ? ' is-forecast' : ''}${selected ? ' is-selected' : ''}`}
            role="button"
            tabIndex={0}
            aria-label={`Pothole at ${point.pothole.lat.toFixed(4)}, ${point.pothole.lon.toFixed(4)}, severity ${Math.round(point.severity)} of 100${point.forecast ? ', forecast' : ', observed'}`}
            onClick={() => onSelect?.(point.pothole.cluster_id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onSelect?.(point.pothole.cluster_id)
              }
            }}
          >
            {/* The upper end of the uncertainty band, drawn as the halo it is:
                how bad this hole could be if it is growing at the fast rate. */}
            {point.forecast && point.hi > point.severity + 1 && (
              <circle className="fmap__band" cx={point.x} cy={point.y} r={radiusFor(point.hi)} />
            )}
            {selected && <circle className="fmap__ring" cx={point.x} cy={point.y} r={r + 5} />}
            <circle className="fmap__dot" cx={point.x} cy={point.y} r={r} />
          </g>
        )
      })}

      <ScaleBar projection={projection} />
    </svg>
  )
}
