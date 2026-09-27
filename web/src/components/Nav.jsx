import { Link, NavLink } from 'react-router-dom'
import Brand from './Brand.jsx'

export default function Nav({ wide = false }) {
  return (
    <header className="nav">
      <div className={`wrap${wide ? ' wrap--wide' : ''} nav__inner`}>
        <Brand />
        <nav className="nav__links" aria-label="Sections">
          <Link to="/#how">How it works</Link>
          <Link to="/#who">Who it helps</Link>
          <NavLink to="/demo">Demo</NavLink>
          <NavLink to="/map">Map</NavLink>
          <Link to="/#faq">FAQ</Link>
        </nav>
        <Link to="/try" className="btn btn--sm">
          Try it
        </Link>
      </div>
    </header>
  )
}
