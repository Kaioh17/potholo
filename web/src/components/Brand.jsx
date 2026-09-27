import { Link } from 'react-router-dom'
import logo from '../assets/logo.png'

export function BrandMark({ size = 30 }) {
  return <img src={logo} height={size} alt="" aria-hidden="true" style={{ height: size, width: 'auto' }} />
}

export default function Brand() {
  return (
    <Link to="/" className="brand" aria-label="Potholo home">
      <BrandMark />
      <span>Potholo</span>
    </Link>
  )
}
