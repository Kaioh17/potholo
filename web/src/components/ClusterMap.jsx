import { useEffect, useRef } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { lookupAddress } from '../admin/address.js'

// A real street basemap from OpenFreeMap (OpenStreetMap data, vector tiles, no
// API key): roads by hierarchy, the river, parks and building blocks, with
// street labels. The pins are ordinary DOM markers so the site's own tokens
// style them.

const STYLE = 'https://tiles.openfreemap.org/styles/bright'
const CHICAGO = [-87.6233, 41.8827]
const RANK = { candidate: 0, confirmed: 1, reported: 2 }

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value))
const diameterForSeverity = (severity) => Math.round(22 + (clamp(severity, 0, 100) / 100) * 14)

// A ground circle as a polygon, so the spread keeps its real size in metres at
// every zoom.
function circlePolygon(lat, lon, radiusM, steps = 48) {
  const dLat = radiusM / 111320
  const dLon = radiusM / (111320 * Math.cos((lat * Math.PI) / 180))
  const ring = Array.from({ length: steps + 1 }, (_, i) => {
    const a = (i / steps) * 2 * Math.PI
    return [lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]
  })
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: {} }
}

// A tooltip that names the street. It opens at once with the coordinates so it
// is never empty, then fills in the address when the lookup returns.
function addressTip(map, cluster, size) {
  const popup = new maplibregl.Popup({
    closeButton: false,
    closeOnClick: false,
    offset: size / 2 + 6,
    maxWidth: '280px',
    className: 'cmap__tip',
  })
  const title = document.createElement('strong')
  const coords = document.createElement('span')
  title.textContent = 'Finding address…'
  coords.textContent = `${cluster.lat.toFixed(5)}, ${cluster.lon.toFixed(5)}`
  const body = document.createElement('div')
  body.append(title, coords)
  popup.setDOMContent(body).setLngLat([cluster.lon, cluster.lat])

  let shown = false
  return {
    show() {
      shown = true
      popup.addTo(map)
      lookupAddress(cluster.lat, cluster.lon).then(
        (address) => {
          title.textContent = `Near ${address.label}`
        },
        () => {
          title.textContent = 'Address unavailable'
        },
      )
    },
    hide() {
      if (shown) popup.remove()
      shown = false
    },
  }
}

function pinElement(cluster, selected, onSelect, tip) {
  const size = diameterForSeverity(cluster.severity)
  const el = document.createElement('button')
  el.type = 'button'
  el.className = `cmap__pin cmap__pin--${cluster.status}${selected ? ' is-selected' : ''}`
  el.style.width = `${size}px`
  el.style.height = `${size}px`
  el.textContent = cluster.status !== 'candidate' ? String(Math.round(cluster.severity)) : ''
  el.setAttribute(
    'aria-label',
    `${cluster.status} pothole, severity ${Math.round(cluster.severity)} of 100, ${cluster.devices} devices`,
  )
  el.setAttribute('aria-pressed', String(selected))
  el.addEventListener('mouseenter', tip.show)
  el.addEventListener('mouseleave', tip.hide)
  el.addEventListener('focus', tip.show)
  el.addEventListener('blur', tip.hide)
  el.addEventListener('click', (event) => {
    event.stopPropagation()
    onSelect(cluster.cluster_id)
  })
  return el
}

export default function ClusterMap({ clusters, selectedId, onSelect }) {
  const hostRef = useRef(null)
  const mapRef = useRef(null)
  const readyRef = useRef(false)
  const markersRef = useRef([])
  const fittedRef = useRef('')
  const latest = useRef({ clusters, selectedId, onSelect })

  const draw = () => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    const { clusters, selectedId, onSelect } = latest.current
    // Candidates first so confirmed pins are never hidden behind them.
    const order = [...clusters].sort((a, b) => RANK[a.status] - RANK[b.status])

    // The cluster's own spread on the ground, so the map admits how precisely
    // it knows where the hole is rather than implying an exact point.
    map.getSource('spread').setData({
      type: 'FeatureCollection',
      features: order.filter((c) => c.radius_m > 0).map((c) => circlePolygon(c.lat, c.lon, c.radius_m)),
    })

    markersRef.current.forEach(({ marker, tip }) => {
      tip.hide()
      marker.remove()
    })
    markersRef.current = order.map((c) => {
      const selected = c.cluster_id === selectedId
      const tip = addressTip(map, c, diameterForSeverity(c.severity))
      const el = pinElement(c, selected, onSelect, tip)
      el.style.zIndex = String((selected ? 100 : 0) + RANK[c.status])
      const marker = new maplibregl.Marker({ element: el }).setLngLat([c.lon, c.lat]).addTo(map)
      return { marker, tip }
    })

    // Refit only when the set of locations changes (first load, filter), not on
    // every poll or selection, so the viewer's own pan and zoom are kept.
    const key = order.map((c) => c.cluster_id).sort().join('|')
    if (key !== fittedRef.current && order.length > 0) {
      fittedRef.current = key
      const bounds = new maplibregl.LngLatBounds()
      order.forEach((c) => bounds.extend([c.lon, c.lat]))
      map.fitBounds(bounds, { padding: 64, maxZoom: 17, animate: false })
    }
  }

  // The dashboard re-renders every second for its clock. Redrawing only when
  // the data or selection changes keeps the pins stable under the pointer.
  useEffect(() => {
    latest.current = { clusters, selectedId, onSelect }
    draw()
  }, [clusters, selectedId]) // oxlint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = new maplibregl.Map({
      container: hostRef.current,
      style: STYLE,
      center: CHICAGO,
      zoom: 13,
      attributionControl: { compact: true },
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left')
    map.on('load', () => {
      map.addSource('spread', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({
        id: 'spread-fill',
        type: 'fill',
        source: 'spread',
        paint: { 'fill-color': '#111111', 'fill-opacity': 0.06 },
      })
      map.addLayer({
        id: 'spread-line',
        type: 'line',
        source: 'spread',
        paint: { 'line-color': '#2f3437', 'line-width': 1, 'line-dasharray': [3, 3], 'line-opacity': 0.6 },
      })
      readyRef.current = true
      draw()
    })
    mapRef.current = map
    return () => {
      markersRef.current = []
      readyRef.current = false
      fittedRef.current = ''
      map.remove()
      mapRef.current = null
    }
  }, [])

  return (
    <div
      ref={hostRef}
      className="cmap"
      role="group"
      aria-label="Pothole locations on a street map of Chicago"
    />
  )
}
