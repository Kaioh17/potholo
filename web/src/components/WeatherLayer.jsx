import { useMemo } from 'react'

/**
 * Precipitation falling over the map.
 *
 * The point is not decoration. The model's whole claim is that water plus
 * freezing does the damage, and that water alone does almost nothing -- Chicago
 * gets more rain in July (102 mm) than in January (53 mm), and yet July does no
 * damage at all, because nothing freezes. Drawing the weather makes that
 * visible: summer rain falls hard and the potholes sit still; winter snow
 * arrives and they start growing.
 *
 * Particles are laid out once and animated purely in CSS, so scrubbing the
 * timeline changes counts and speeds without React re-rendering anything per
 * frame. Positions come from a seeded generator rather than Math.random so a
 * re-render does not make the whole field jump.
 */

const FIELD = 90 // particles at full intensity

/** Small deterministic PRNG, so the same month always looks the same. */
function mulberry32(seed) {
  return function next() {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export default function WeatherLayer({ kind, intensity, freezeThaw }) {
  // The full field is built once. Intensity then decides how many of them are
  // shown, so changing month never re-lays-out the particles that stay.
  const particles = useMemo(() => {
    const rand = mulberry32(0x9e3779b9)
    return Array.from({ length: FIELD }, () => ({
      left: rand() * 100,
      delay: rand() * -14,
      duration: 3.4 + rand() * 4.6,
      drift: (rand() - 0.5) * 60,
      scale: 0.6 + rand() * 0.8,
      opacity: 0.35 + rand() * 0.5,
    }))
  }, [])

  if (kind === 'dry' || intensity <= 0.02) return null

  const shown = Math.max(6, Math.round(FIELD * intensity))
  // Snow drifts; rain falls fast and nearly straight.
  const speed = kind === 'snow' ? 1 : 0.34

  return (
    <div
      className={`wx wx--${kind}${freezeThaw > 0 ? ' wx--freezing' : ''}`}
      aria-hidden="true"
    >
      {particles.slice(0, shown).map((p, i) => (
        <span
          key={i}
          className="wx__bit"
          style={{
            left: `${p.left}%`,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration * speed}s`,
            opacity: p.opacity,
            '--drift': `${kind === 'snow' ? p.drift : p.drift * 0.15}px`,
            '--scale': p.scale,
          }}
        />
      ))}
    </div>
  )
}
