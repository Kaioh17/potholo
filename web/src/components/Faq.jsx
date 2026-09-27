import { useId, useState } from 'react'
import { Plus, Minus } from '@phosphor-icons/react'
import Reveal from './Reveal.jsx'

const ITEMS = [
  {
    q: 'Does Potholo need special hardware?',
    a: 'No. Most phones already contain a gyroscope and accelerometer. The app only needs permission to read them and to know roughly where the phone is.',
  },
  {
    q: 'How does it tell a pothole from a speed bump?',
    a: 'Potholes produce a short, sharp spike in a particular pattern. Speed bumps, rail crossings and hard braking look different, and the service also compares each report with location, speed and reports from other phones.',
  },
  {
    q: 'What happens to my data?',
    a: 'Detection runs on our servers, not the phone. The phone only streams raw accelerometer and gyroscope readings, plus time and location, and the API alone decides what counts as a pothole. Privacy details will be published before any public release.',
  },
  {
    q: 'Where does it work?',
    a: 'Potholo is being built and tested around Chicago first, then it can be extended to other cities.',
  },
  {
    q: 'Can I try it today?',
    a: 'Yes. Try it runs a simulated phone through a real drive and streams its readings to the real detection API, so you can watch a pothole get found and mapped. The Android app, reading a real phone’s sensors instead of a simulated one, comes next.',
  },
]

export default function Faq() {
  const [open, setOpen] = useState(0)
  const baseId = useId()

  return (
    <section id="faq" className="section section--tint" aria-labelledby="faq-title">
      <div className="wrap wrap--narrow">
        <Reveal className="section__head">
          <p className="eyebrow">FAQ</p>
          <h2 id="faq-title">Questions people ask first.</h2>
        </Reveal>

        <Reveal className="faq">
          {ITEMS.map(({ q, a }, i) => {
            const isOpen = open === i
            const panelId = `${baseId}-panel-${i}`
            const buttonId = `${baseId}-button-${i}`
            return (
              <div className="faq__item" key={q}>
                <h3>
                  <button
                    id={buttonId}
                    type="button"
                    className="faq__q"
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    onClick={() => setOpen(isOpen ? -1 : i)}
                  >
                    <span>{q}</span>
                    {isOpen ? (
                      <Minus size={18} weight="bold" aria-hidden="true" />
                    ) : (
                      <Plus size={18} weight="bold" aria-hidden="true" />
                    )}
                  </button>
                </h3>
                <div id={panelId} role="region" aria-labelledby={buttonId} hidden={!isOpen}>
                  <p className="faq__a">{a}</p>
                </div>
              </div>
            )
          })}
        </Reveal>
      </div>
    </section>
  )
}
