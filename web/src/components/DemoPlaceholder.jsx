import { Link } from 'react-router-dom'
import { Car } from '@phosphor-icons/react'
import Reveal from './Reveal.jsx'

export default function DemoPlaceholder() {
  return (
    <section id="demo" className="section" aria-labelledby="demo-title">
      <div className="wrap">
        <Reveal className="section__head">
          <p className="eyebrow">Demo</p>
          <h2 id="demo-title">See a pothole hit from the car's side.</h2>
        </Reveal>

        <Reveal className="window" index={1}>
          <div className="window__bar" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className="window__body">
            <span className="icon-chip icon-chip--amber">
              <Car size={22} weight="bold" aria-hidden="true" />
            </span>
            <h3>A simulated drive</h3>
            <p>
              Watch a car drop into a pothole in slow motion, with mock phone readings beside it.
              Live phone data and the map arrive with the Android app.
            </p>
            <Link to="/demo" className="btn">
              Open the demo
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
