import { useMemo } from 'react'

/**
 * A weather-radar sweep over the city.
 *
 * Television radar reads instantly because the precipitation is a *field* that
 * moves, not a texture that sits still. So this builds a band of soft cells
 * wider than the map and translates it west to east as the timeline advances:
 * step a month and the system moves on, play the timeline and a front crosses
 * Chicago. Chicago's weather really does arrive from the west, so the direction
 * is not arbitrary.
 *
 * Cells are laid out once from a seeded generator and indexed by absolute month,
 * which means a given month always shows the same pattern -- scrubbing back and
 * forth is stable, and two people looking at February 2025 see the same storm.
 *
 * Intensity comes from that month's real precipitation, so a dry month shows
 * almost nothing and a wet one fills the frame. The colour ramp is the familiar
 * radar one for rain and a cold blue for snow; it is the one place on the site
 * that leaves the monochrome palette, because a radar that is not radar-coloured
 * stops being readable as a radar.
 */

const CELLS = 26
const FIELD_SPAN = 2.4 // field width as a multiple of the map, so it can drift
const DRIFT_PER_MONTH = 0.085 // fraction of the field a system moves in a month

function mulberry32(seed) {
  return function next() {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Radar ramp: light to heavy. Snow gets its own cold scale. */
function rampFor(kind) {
  return kind === 'snow'
    ? ['#cfe4f2', '#9ec9e8', '#6aa9d6', '#4a86b8']
    : ['#bcd9a8', '#8fc07a', '#e8cf72', '#d98b55']
}

export default function RadarLayer({ at, kind, intensity, width, height }) {
  const cells = useMemo(() => {
    const rand = mulberry32(0x5bf03635)
    return Array.from({ length: CELLS }, () => ({
      // Laid out across a field wider than the map so cells can enter and leave.
      fx: rand() * FIELD_SPAN,
      fy: 0.12 + rand() * 0.76,
      rx: 0.07 + rand() * 0.16,
      ry: 0.05 + rand() * 0.12,
      weight: rand(),
      wobble: rand(),
    }))
  }, [])

  if (kind === 'dry' || intensity <= 0.04) return null

  // Absolute month, so the pattern is a stable function of when rather than of
  // how the user got here.
  const month = at.getFullYear() * 12 + at.getMonth()
  const span = FIELD_SPAN * width
  // Positive, so the field advances eastward as time runs forward. Chicago's
  // weather arrives from the west; a system drifting the other way reads wrong
  // to anyone who has watched a local forecast.
  const shift = month * DRIFT_PER_MONTH * width
  const ramp = rampFor(kind)

  return (
    <g className="radar" aria-hidden="true">
      <defs>
        <filter id="radar-blur" x="-25%" y="-25%" width="150%" height="150%">
          <feGaussianBlur stdDeviation={Math.max(4, width * 0.009)} />
        </filter>
        <clipPath id="radar-clip">
          <rect x="0" y="0" width={width} height={height} />
        </clipPath>
      </defs>

      <g clipPath="url(#radar-clip)" filter="url(#radar-blur)" opacity={0.55 + intensity * 0.32}>
        {cells.map((cell, i) => {
          // Wrapped into the field, then drawn twice a field apart, so a cell
          // leaving the east edge is already re-entering from the west and the
          // band never shows a seam or a gap.
          const base = (((cell.fx * width + shift) % span) + span) % span
          return [0, -span].map((wrap, j) => {
            const x = base + wrap
            if (x < -width * 0.5 || x > width * 1.5) return null
            // Heavier cores sit inside lighter cells, which is what gives radar
            // its layered look rather than a flat blob.
            const strength = Math.min(1, cell.weight * 0.5 + intensity * 0.8)
            const tier = Math.min(ramp.length - 1, Math.floor(strength * ramp.length))
            const rx = cell.rx * width * (0.7 + intensity * 0.6)
            const ry = cell.ry * height * (0.8 + intensity * 0.5)
            return (
              <g key={`${i}-${j}`}>
                <ellipse cx={x} cy={cell.fy * height} rx={rx} ry={ry} fill={ramp[0]} opacity={0.55} />
                {tier >= 1 && (
                  <ellipse cx={x} cy={cell.fy * height} rx={rx * 0.62} ry={ry * 0.62}
                    fill={ramp[1]} opacity={0.6} />
                )}
                {tier >= 2 && (
                  <ellipse cx={x} cy={cell.fy * height} rx={rx * 0.34} ry={ry * 0.34}
                    fill={ramp[2]} opacity={0.65} />
                )}
                {tier >= 3 && (
                  <ellipse cx={x} cy={cell.fy * height} rx={rx * 0.16} ry={ry * 0.16}
                    fill={ramp[3]} opacity={0.7} />
                )}
              </g>
            )
          })
        })}
      </g>
    </g>
  )
}
