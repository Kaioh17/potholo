import { Link } from 'react-router-dom'
import { ArrowRight } from '@phosphor-icons/react'
import RoadScene from './RoadScene.jsx'
import Reveal from './Reveal.jsx'

export default function Hero() {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="wrap hero__grid">
        <div className="hero__copy">
          <Reveal as="span" className="tag tag--amber">
            Chicago road data
          </Reveal>
          <Reveal as="h1" id="hero-title" index={1}>
            Every phone on the road is a pothole sensor.
          </Reveal>
          <Reveal as="p" index={2} className="hero__lede">
            Potholo reads the gyroscope already inside your phone, recognises the jolt of a pothole,
            and turns it into a mapped, cross-checked record. No new hardware, no survey crews.
          </Reveal>
          <Reveal index={3} className="hero__actions">
            <Link to="/try" className="btn">
              Try it
              <ArrowRight size={16} weight="bold" aria-hidden="true" />
            </Link>
            <a href="#how" className="btn btn--ghost">
              See how it works
            </a>
          </Reveal>
        </div>
        <Reveal index={2} className="hero__art">
          <RoadScene />
        </Reveal>
      </div>
    </section>
  )
}
