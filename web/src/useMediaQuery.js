import { useSyncExternalStore } from 'react'

// Whether a CSS media query matches, kept in step as the viewport changes.
// For layout decisions CSS cannot make on its own, such as an SVG viewBox.
export function useMediaQuery(query) {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}
