import { useEffect, useRef } from 'react'
import { CaretRight, X } from '@phosphor-icons/react'

// What the fields in the panel mean, in the order they appear.
const TERMS = [
  ['device_id', 'Identifies the phone. The API groups uploads and pothole reports by it, and a pothole needs reports from three different devices before it counts as confirmed.'],
  ['trip_id', 'One drive. Timestamps restart at zero on every trip, so the demo starts a new trip each time the car passes the pothole.'],
  ['sample_rate_hint', 'How many readings per second the phone asked its sensors for. The API measures the real rate from the timestamps.'],
  ['ax, ay, az', 'Accelerometer, in m/s² along the phone’s three axes. Gravity is included, so a phone at rest reads about 9.8 in total. The API works out which way is up itself, so the mounting angle does not matter. A pothole shows as a short, sharp spike.'],
  ['gx, gy, gz', 'Gyroscope, in rad/s: how fast the phone is rotating around each axis. It is used alongside the accelerometer when judging an event.'],
  ['t', 'Seconds since the trip started. It rises with every sample.'],
  ['gps', 'Location about once a second: latitude, longitude, speed in m/s and accuracy in metres. It gives a pothole its place on the map, and speed helps judge how hard the hit was.'],
  ['Batches sent', 'The phone uploads three seconds of readings at a time, plus the location fixes around them.'],
  ['Severity and confidence', 'Both come from the API, not the phone. Severity is how hard the hit was, and confidence is how sure the API is that it was a pothole, from 0 to 1.'],
]

// The button that lives in the Recording panel and opens the pop-up.
export function GlossaryToggle({ onOpen }) {
  return (
    <div className="glossary">
      <button type="button" className="glossary__toggle" aria-haspopup="dialog" onClick={onOpen}>
        <span>What do these values mean?</span>
        <CaretRight size={16} weight="bold" aria-hidden="true" />
      </button>
    </div>
  )
}

// A modal card. The native dialog gives focus trapping, Escape to close and a backdrop for free.
export function GlossaryDialog({ open, onClose }) {
  const ref = useRef(null)

  useEffect(() => {
    const dialog = ref.current
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className="glossary-dialog"
      aria-labelledby="glossary-title"
      onClose={onClose}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog element itself, not on the card inside it.
        if (event.target === ref.current) onClose()
      }}
    >
      <div className="glossary-dialog__card">
        <div className="glossary-dialog__head">
          <h2 id="glossary-title">What the values mean</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={18} weight="bold" aria-hidden="true" />
          </button>
        </div>
        <dl className="glossary__list">
          {TERMS.map(([term, text]) => (
            <div key={term} className="glossary__item">
              <dt>{term}</dt>
              <dd>{text}</dd>
            </div>
          ))}
        </dl>
      </div>
    </dialog>
  )
}
