import { useEffect, useId, useRef, useState } from 'react'

/**
 * Long text that is cut to a few lines on phones, with a "See more" toggle.
 *
 * The cut is CSS (line-clamp inside a 760px media query), so desktop always
 * shows the full text and never renders the toggle. Whether the text is
 * actually cut is measured rather than guessed from its length: the toggle
 * only appears when there is more to see at the current width.
 */
export default function Clamp({ lines = 3, className = '', children }) {
  const ref = useRef(null)
  const id = useId()
  const [open, setOpen] = useState(false)
  const [clamped, setClamped] = useState(false)

  useEffect(() => {
    const el = ref.current
    const measure = () => setClamped(el.scrollHeight > el.clientHeight + 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [children])

  return (
    <>
      <p
        ref={ref}
        id={id}
        className={`${className} clamp__text${open ? ' is-open' : ''}`.trim()}
        style={{ '--clamp-lines': lines }}
      >
        {children}
      </p>
      {(clamped || open) && (
        <button type="button" className="clamp__toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
          {open ? 'See less' : 'See more'}
        </button>
      )}
    </>
  )
}
