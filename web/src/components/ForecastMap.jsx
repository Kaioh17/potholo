import { useMemo, useState } from 'react'
import { severityAt, severityBand, clusterDetectedAt } from '../forecast/lifecycle.js'
import basemap from '../forecast/streets.js'
import RadarLayer from './RadarLayer.jsx'

/**
 * Downtown Chicago over time: what was found, and what the model says it becomes.
 *
 * The basemap is OpenStreetMap data, served as raster tiles through Stadia
 * Maps' Alidade Smooth style -- the same underlying data the API's reverse
 * geocoder already uses. The tiles are drawn *inside* the SVG rather than
 * beneath it, which keeps the map, the pins, the radar and the weather in
 * one coordinate system: no
 * second layout to keep in sync, and a pin cannot drift off its street.
 *
 * That only works if the projection is the tiles' own, so this is true Web
 * Mercator. Over a 930 m window the difference from a flat lat/lon
 * approximation is under a metre -- but "under a metre" is exactly the error
 * that puts a pothole on the wrong side of a kerb, and tiles are unforgiving
 * about it.
 *
 * The city's own street centrelines are kept as a fallback. If the tile CDN is
 * slow or blocked at demo time the map still shows real streets rather than an
 * empty rectangle, which is worth the few kilobytes.
 *
 * The projection is fixed to the basemap bounds and never refits: the visible
 * set of potholes changes on every scrubber step, and a frame that refit itself
 * would make the city drift while you were reading one block.
 */

const TILE = 256
const ZOOM = 16
// Stadia Maps' Alidade Smooth style: OSM data, raster tiles, and a light
// palette close to this app's own. tile.openstreetmap.org and Carto's free
// endpoint were tried first -- OSM's own server blocks direct hotlinking from
// a deployed app under its tile usage policy, and Carto's free endpoint now
// wants an account -- so this is the provider that actually serves tiles in
// production. The key is domain-locked on Stadia's dashboard, not secret, but
// still comes from the environment so it isn't hard-coded per deploy target.
const STADIA_KEY = import.meta.env.VITE_STADIA_API_KEY
const TILE_URL = (z, x, y) =>
  `https://tiles.stadiamaps.com/tiles/alidade_smooth/${z}/${x}/${y}.png${STADIA_KEY ? `?api_key=${STADIA_KEY}` : ''}`

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

const CLASS_WIDTH = { 1: 3.4, 2: 2.2, 3: 1.5, 4: 0.8 }
const DRAW_ORDER = [4, 3, 2, 1]

const radiusFor = (severity, compact) =>
  (compact ? 2.2 : 3.2) + (clamp(severity, 0, 100) / 100) * (compact ? 5.2 : 8.5)

/* ------------------------------- Projection -------------------------------- */

const worldX = (lon, z) => ((lon + 180) / 360) * TILE * 2 ** z
const worldY = (lat, z) => {
  const rad = (lat * Math.PI) / 180
  const merc = Math.log(Math.tan(Math.PI / 4 + rad / 2))
  return ((1 - merc / Math.PI) / 2) * TILE * 2 ** z
}

function useProjection(width, height) {
  return useMemo(() => {
    const { north, south, east, west } = basemap.bounds
    const xW = worldX(west, ZOOM)
    const xE = worldX(east, ZOOM)
    const yN = worldY(north, ZOOM)
    const yS = worldY(south, ZOOM)

    // One scale for both axes. Mercator is conformal, so a second scale would
    // shear the streets and the tiles would stop lining up with the pins.
    const scale = Math.min(width / (xE - xW), height / (yS - yN))
    const offX = (width - (xE - xW) * scale) / 2
    const offY = (height - (yS - yN) * scale) / 2

    const fromWorld = (wx, wy) => ({
      x: offX + (wx - xW) * scale,
      y: offY + (wy - yN) * scale,
    })
    const toPx = (lat, lon) => fromWorld(worldX(lon, ZOOM), worldY(lat, ZOOM))

    // Metres per SVG unit, for the scale bar. Mercator inflates distance away
    // from the equator, which at Chicago's latitude is a 34% error if ignored.
    const latMid = (north + south) / 2
    const mPerWorldPx = (156543.03392 * Math.cos((latMid * Math.PI) / 180)) / 2 ** ZOOM

    return { toPx, fromWorld, scale, width, height, xW, xE, yN, yS, mPerUnit: mPerWorldPx / scale }
  }, [width, height])
}

/* --------------------------------- Layers ---------------------------------- */

function Tiles({ projection, onFail }) {
  const tiles = useMemo(() => {
    const out = []
    for (let tx = Math.floor(projection.xW / TILE); tx <= Math.floor(projection.xE / TILE); tx += 1) {
      for (let ty = Math.floor(projection.yN / TILE); ty <= Math.floor(projection.yS / TILE); ty += 1) {
        const at = projection.fromWorld(tx * TILE, ty * TILE)
        out.push({ key: `${tx}/${ty}`, href: TILE_URL(ZOOM, tx, ty), ...at })
      }
    }
    return out
  }, [projection])

  const size = TILE * projection.scale

  return (
    <g className="fmap__tiles">
      {tiles.map((t) => (
        <image
          key={t.key}
          href={t.href}
          x={t.x}
          y={t.y}
          // A hairline overlap: without it sub-pixel rounding leaves visible
          // seams between neighbouring tiles.
          width={size + 0.6}
          height={size + 0.6}
          onError={onFail}
          preserveAspectRatio="none"
        />
      ))}
    </g>
  )
}

/** The city's own centrelines, shown when the tiles do not arrive. */
function Streets({ projection, compact }) {
  const paths = useMemo(() => {
    const byClass = new Map(DRAW_ORDER.map((c) => [c, []]))
    basemap.streets.forEach((street) => {
      const bucket = byClass.get(street.c)
      if (!bucket) return
      bucket.push(
        street.p
          .map(([lon, lat], i) => {
            const { x, y } = projection.toPx(lat, lon)
            return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
          })
          .join(' '),
      )
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
  const metres =
    [100, 200, 500, 1000].find((m) => m / projection.mPerUnit > (compact ? 60 : 90)) ?? 1000
  const width = metres / projection.mPerUnit
  const y = projection.height - (compact ? 12 : 18)
  const x = compact ? 12 : 18
  return (
    <g className="fmap__scale">
      <rect className="fmap__scale-bg" x={x - 6} y={y - 11} width={width + 58} height={19} rx={4} />
      <line x1={x} y1={y} x2={x + width} y2={y} />
      <line x1={x} y1={y - 3} x2={x} y2={y + 3} />
      <line x1={x + width} y1={y - 3} x2={x + width} y2={y + 3} />
      <text x={x + width + 6} y={y + 3}>
        {metres >= 1000 ? `${metres / 1000} km` : `${metres} m`}
      </text>
    </g>
  )
}

/* ----------------------------------- Map ----------------------------------- */

export default function ForecastMap({
  potholes,
  at,
  origin,
  selectedId,
  onSelect,
  compact = false,
  weather,
}) {
  const width = 1000
  const height = compact ? 290 : 620
  const projection = useProjection(width, height)

  // A handful of failures means the CDN is unreachable, not that one tile is
  // missing, so the whole layer steps aside for the offline street data.
  const [tileFailures, setTileFailures] = useState(0)
  const tilesDown = tileFailures >= 3

  const points = useMemo(() => {
    return potholes
      .map((pothole) => {
        const detected = clusterDetectedAt(pothole)
        // Not yet found is not drawn: showing it would claim we knew about it
        // before we did.
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

      {!tilesDown && <Tiles projection={projection} onFail={() => setTileFailures((n) => n + 1)} />}
      {tilesDown && <Streets projection={projection} compact={compact} />}

      {weather && (
        <RadarLayer at={at} kind={weather.kind} intensity={weather.intensity}
          width={width} height={height} />
      )}

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
            {!compact && point.forecast && point.hi > point.severity + 1 && (
              <circle className="fmap__band" cx={point.x} cy={point.y} r={radiusFor(point.hi, compact)} />
            )}
            {selected && <circle className="fmap__ring" cx={point.x} cy={point.y} r={r + 4} />}
            <circle className="fmap__dot" cx={point.x} cy={point.y} r={r} />
          </g>
        )
      })}

      <ScaleBar projection={projection} compact={compact} />

      {/* Required by Stadia Maps' and OpenStreetMap's terms. */}
      <text className="fmap__credit" x={width - 6} y={height - 5}>
        {tilesDown
          ? 'Streets: City of Chicago open data'
          : '© Stadia Maps © OpenStreetMap contributors'}
      </text>
    </svg>
  )
}
