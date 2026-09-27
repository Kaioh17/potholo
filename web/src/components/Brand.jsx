import { Link } from 'react-router-dom'

/**
 * The road mark: a street in perspective, with a pothole in the right lane.
 *
 * Rebuilt as vector rather than dropped in as the supplied PNG, because this
 * renders at 16px in the favicon and 30px in the nav, and a 1500px raster
 * downsampled that far loses the centre dashes entirely. The proportions are
 * measured from the artwork -- the road runs from 0.305-0.695 of the width at
 * the top to 0.105-0.895 at the bottom, and the three centre dashes sit at
 * 0.450-0.549 -- so this is the same mark, not an impression of it.
 *
 * The trapezoid is drawn as a stroked polygon rather than a path with arc
 * corners: `stroke-linejoin: round` gives the rounded corners for free, so the
 * geometry stays four readable points instead of eight bezier handles. The
 * polygon is inset by half the stroke width to compensate.
 *
 * The pothole is deliberately irregular. A circle reads as a manhole; road
 * damage has ragged edges, and at this size that asymmetry is the only thing
 * telling the two apart. It sits in the right lane, low enough to be near the
 * viewer where perspective makes it largest.
 *
 * `--amber` rather than the artwork's #F2B233: the two are indistinguishable
 * at these sizes, and an accent 2% off from every other accent on the site
 * reads as a mistake rather than a choice.
 */

const NAVY = '#08142B'
const AMBER = '#F2B705'

// Dashes overrun the road's top and bottom edges so their rounded ends fall
// outside it, against a background of the same navy -- which is how the
// artwork gets a flat edge there without a clip path.
const DASHES = [
  { y: 3.4, h: 6.2 },
  { y: 12.8, h: 6.4 },
  { y: 22.4, h: 6.2 },
]

// Seven points at deliberately uneven radii, joined straight and softened by a
// rounded stroke. Curves made it smooth enough to read as a manhole cover; the
// asymmetry is the only cue distinguishing road damage from a drain at 30px.
const POTHOLE = 'M25.39 20.6 L23.88 22.23 L21.93 23.12 L20.49 21.37 L20.15 19.46 L22.26 18.65 L24.17 18.74 Z'

export function BrandMark({ size = 30, title }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : 'true'}
    >
      {title && <title>{title}</title>}
      <rect width="32" height="32" rx="7" fill={NAVY} />
      <path
        d="M11 6.1 L20.95 6.1 L27.35 25.8 L4.65 25.8 Z"
        fill={AMBER}
        stroke={AMBER}
        strokeWidth="2.6"
        strokeLinejoin="round"
      />
      {DASHES.map((d) => (
        <rect key={d.y} x="14.4" y={d.y} width="3.2" height={d.h} rx="1.6" fill={NAVY} />
      ))}
      <path d={POTHOLE} fill={NAVY} stroke={NAVY} strokeWidth="0.7" strokeLinejoin="round" />
    </svg>
  )
}

export default function Brand() {
  return (
    <Link to="/" className="brand" aria-label="Potholo home">
      <BrandMark />
      <span>potholo</span>
    </Link>
  )
}
