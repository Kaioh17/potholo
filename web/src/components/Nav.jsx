import { Link } from 'react-router-dom'
import Brand from './Brand.jsx'

export default function Nav() {
  return (
    <header className="nav">
      <div className="wrap nav__inner">
        <Brand />
        <nav className="nav__links" aria-label="Sections">
          <Link to="/#how">How it works</Link>
          <Link to="/#who">Who it helps</Link>
          <Link to="/#demo">Demo</Link>
          <Link to="/#faq">FAQ</Link>
        </nav>
        <Link to="/login" className="btn btn--sm">
          Log in
        </Link>
      </div>
    </header>
  )
}
