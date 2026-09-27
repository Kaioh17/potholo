import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { List, X } from '@phosphor-icons/react'
import Brand from './Brand.jsx'

function SectionLinks({ onPick }) {
  return (
    <>
      <Link to="/#how" onClick={onPick}>How it works</Link>
      <Link to="/#who" onClick={onPick}>Who it helps</Link>
      <NavLink to="/demo" onClick={onPick}>Demo</NavLink>
      <Link to="/#faq" onClick={onPick}>FAQ</Link>
    </>
  )
}

// Below 760px the section links do not fit beside the brand and "Try it", so
// they move into a drawer. The native dialog gives focus trapping, Escape to
// close, a backdrop and focus returned to the menu button for free.
function MenuDrawer({ open, onClose }) {
  const ref = useRef(null)
  const { pathname, hash } = useLocation()

  useEffect(() => {
    const dialog = ref.current
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  // A route or hash change means the reader went somewhere, so the drawer goes.
  useEffect(() => {
    onClose()
  }, [pathname, hash, onClose])

  return (
    <dialog
      ref={ref}
      id="nav-menu"
      className="nav-drawer"
      aria-label="Menu"
      onClose={onClose}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog element itself.
        if (event.target === ref.current) onClose()
      }}
    >
      <div className="nav-drawer__head">
        <Brand />
        <button type="button" className="icon-button" aria-label="Close menu" onClick={onClose}>
          <X size={20} weight="bold" aria-hidden="true" />
        </button>
      </div>
      <nav className="nav-drawer__links" aria-label="Sections">
        <SectionLinks onPick={onClose} />
      </nav>
      <Link to="/try" className="btn nav-drawer__cta" onClick={onClose}>
        Try it
      </Link>
    </dialog>
  )
}

// True while the reader is scrolling down past the nav, false as soon as they
// scroll back up. Small movements are ignored so trackpad jitter does not
// flicker the nav.
function useHiddenOnScrollDown() {
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    let last = window.scrollY
    let frame = 0
    const update = () => {
      frame = 0
      const y = window.scrollY
      if (y < 68) setHidden(false)
      else if (y - last > 8) setHidden(true)
      else if (last - y > 8) setHidden(false)
      else return
      last = y
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame)
    }
  }, [])

  return hidden
}

export default function Nav() {
  const [menuOpen, setMenuOpen] = useState(false)
  const close = useCallback(() => setMenuOpen(false), [])
  const hidden = useHiddenOnScrollDown()

  return (
    <header className={hidden ? 'nav nav--hidden' : 'nav'}>
      <div className="wrap nav__inner">
        <Brand />
        <nav className="nav__links" aria-label="Sections">
          <SectionLinks />
        </nav>
        <div className="nav__actions">
          <Link to="/try" className="btn btn--sm">
            Try it
          </Link>
          <button
            type="button"
            className="icon-button nav__menu"
            aria-label="Menu"
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            aria-controls="nav-menu"
            onClick={() => setMenuOpen(true)}
          >
            <List size={22} weight="bold" aria-hidden="true" />
          </button>
        </div>
      </div>
      <MenuDrawer open={menuOpen} onClose={close} />
    </header>
  )
}
