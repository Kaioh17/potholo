import { useMemo } from 'react'
import { severityAt, severityBand, clusterDetectedAt } from '../forecast/lifecycle.js'
import basemap from '../forecast/streets.js'

/**
 * Downtown Chicago over time: what was found, and what the model says it becomes.
 *
 * The streets are real. They are the city's own centreline data for about 1.5 km
 * around Union Station, and the potholes are placed along those same segments,
 * so a pin sitting on Canal Street is actually on Canal Street. Before this the
 * map was a coordinate grid and the viewer had to take "Chicago" on trust.
 *
 * Two things the projection must do. It must not move: the visible set of
 * potholes changes on every scrubber step, and a frame that refit itself each
 * time would make the city drift while you are trying to read one block. And it
 * must be geographic rather than data-driven -- the frame comes from the
 * basemap's own bounds, so the window is the same few blocks no matter which
 * potholes happen to be showing.
 */

const M_PER_DEG_LAT = 111_320
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

// Stroke widths by Chicago street class: 1 expressway, 2 arterial, 3 collector,
// 4 local. Drawn in that order so the big roads read first.
const CLASS_WIDTH = { 1: 3.4, 2: 2.2, 3: 1.5, 4: 0.8 }
const DRAW_ORDER = [4, 3, 2, 1]

/** Severity to radius. Compact needs smaller pins or the map becomes a blob. */
const radiusFor = (severity, compact) =>
  (compact ? 2.0 : 3.0) + (clamp(severity, 0, 100) / 100) * (compact ? 5.0 : 8.0)

function useProjection(width, height) {
  return useMemo(() => {
    const { north, south, east, west } = basemap.bounds
    const latMid = (north + south) / 2
    const mPerLon = M_PER_DEG_LAT * Math.cos((latMid * Math.PI) / 180)

    const spanX = (east - west) * mPerLon
    const spanY = (north - south) * M_PER_DEG_LAT
    // Fit the window into the frame without distorting it: one scale for both
    // axes, or the street grid comes out sheared.
    const scale = Math.min(width / spanX, height / spanY)
    const offX = (width - spanX * scale) / 2
    const offY = (height - spanY * scale) / 2

    const toPx = (lat, lon) => ({
      x: offX + (lon - west) * mPerLon * scale,
      y: offY + (north - lat) * M_PER_DEG_LAT * scale,
    })
    return { toPx, scale, width, height }
  }, [width, height])
}

/** The street network, memoised: it never changes, so it is built once. */
function Basemap({ projection, compact }) {
  const paths = useMemo(() => {
    const byClass = new Map(DRAW_ORDER.map((c) => [c, []]))
    basemap.streets.forEach((street) => {
      const bucket = byClass.get(street.c)
      if (!bucket) return
      const d = street.p
        .map(([lon, lat], i) => {
          const { x, y } = projection.toPx(lat, lon)
          return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
        })
        .join(' ')
      bucket.push(d)
    })
    return byClass
  }, [projection])

  return (
    <g className="fmap__streets" aria-hidden="true">
      {DRAW_ORDER.map((cls) => (
        <path
          key={cls}
          className={`fmap__street fmap__street--c${cls}`}
          strokeWidth={CLASS_WIDTH[cls] * (compact ? 0.8 : 1)}
          d={paths.get(cls).join(' ')}
        />
      ))}
    </g>
  )
}

function Landmarks({ projection, compact }) {
  return (
    <g className="fmap__landmarks">
      {basemap.landmarks.map((place) => {
        const { x, y } = projection.toPx(place.lat, place.lon)
        return (
          <g key={place.name}>
            <rect className="fmap__landmark-box" x={x - 5} y={y - 5} width={10} height={10} rx={2} />
            <text className="fmap__landmark" x={x + 9} y={y + 4}>
              {compact ? place.name.replace(' Station', '') : place.name}
            </text>
          </g>
        )
      })}
    </g>
  )
}

function ScaleBar({ projection, compact }) {
  const metres = [100, 200, 500, 1000].find((m) => m * projection.scale > (compact ? 50 : 80)) ?? 1000
  const width = metres * projection.scale
  const y = projection.height - (compact ? 10 : 16)
  const x = compact ? 10 : 16
  return (
    <g className="fmap__scale">
      <line x1={x} y1={y} x2={x + width} y2={y} />
      <line x1={x} y1={y - 3} x2={x} y2={y + 3} />
      <line x1={x + width} y1={y - 3} x2={x + width} y2={y + 3} />
      <text x={x + width + 6} y={y + 3}>
        {metres >= 1000 ? `${metres / 1000} km` : `${metres} m`}
      </text>
    </g>
  )
}

export default function ForecastMap({
  potholes,
  at,
  origin,
  selectedId,
  onSelect,
  compact = false,
}) {
  const width = 1000
  const height = compact ? 290 : 620
  const projection = useProjection(width, height)

  const points = useMemo(() => {
    return potholes
      .map((pothole) => {
        const detected = clusterDetectedAt(pothole)
        // A pothole we have not found yet is not drawn: showing it early would
        // claim we knew about it before we did.
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
          ...projection.toPx(pothole.lat, pothole.lon),
        }
      })
      .filter(Boolean)
      // Worst drawn last, so a severe hole is never hidden under a minor one.
      .sort((a, b) => a.severity - b.severity)
  }, [potholes, at, origin, projection])

  return (
    <svg
      className={`fmap${compact ? ' fmap--compact' : ''}`}
      viewBox={`0 0 ${width} ${height}`}
      role="group"
      aria-label={`Pothole severity around Chicago Union Station on ${at.toLocaleDateString()}`}
    >
      <rect className="fmap__bg" x="0" y="0" width={width} height={height} />
      <Basemap projection={projection} compact={compact} />
      <Landmarks projection={projection} compact={compact} />

      {points.map((point) => {
        const r = radiusFor(point.severity, compact)
        const selected = point.pothole.cluster_id === selectedId
        return (
          <g
            key={point.pothole.cluster_id}
            className={`fmap__pin fmap__pin--${point.band}${point.forecast ? ' is-forecast' : ''}${selected ? ' is-selected' : ''}`}
            role="button"
            tabIndex={0}
            aria-label={`Pothole on ${point.pothole.street ?? 'a street'}, severity ${Math.round(point.severity)} of 100${point.forecast ? ', forecast' : ', observed'}`}
            onClick={() => onSelect?.(point.pothole.cluster_id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onSelect?.(point.pothole.cluster_id)
              }
            }}
          >
            {/* The top of the uncertainty band: how bad this could be if it is
                growing at the fast rate. Hidden when compact -- at that size it
                merges into its neighbours and reads as noise. */}
            {!compact && point.forecast && point.hi > point.severity + 1 && (
              <circle className="fmap__band" cx={point.x} cy={point.y} r={radiusFor(point.hi, compact)} />
            )}
            {selected && <circle className="fmap__ring" cx={point.x} cy={point.y} r={r + 4} />}
            <circle className="fmap__dot" cx={point.x} cy={point.y} r={r} />
          </g>
        )
      })}

      <ScaleBar projection={projection} compact={compact} />
    </svg>
  )
}
