import { Link } from 'react-router-dom'

export function BrandMark({ size = 30 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#111111" />
      <ellipse cx="16" cy="17" rx="9" ry="6.5" fill="#F2B705" />
      <ellipse cx="16" cy="17.5" rx="5" ry="3.2" fill="#111111" />
    </svg>
  )
}

export default function Brand() {
  return (
    <Link to="/" className="brand" aria-label="Potholo home">
      <BrandMark />
      <span>Potholo</span>
    </Link>
  )
}
