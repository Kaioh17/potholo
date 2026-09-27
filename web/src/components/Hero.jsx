import { Link } from 'react-router-dom'
import { ArrowRight } from '@phosphor-icons/react'
import Reveal from './Reveal.jsx'
import { useMediaQuery } from '../useMediaQuery.js'

export default function Hero() {
  // With reduced motion the clip waits on its poster frame until played by hand.
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)')

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
          <video
            key={reduceMotion ? 'still' : 'auto'}
            className="hero__video"
            poster="/media/hero-analysis-poster.jpg"
            width="1280"
            height="720"
            autoPlay={!reduceMotion}
            controls={reduceMotion}
            muted
            loop
            playsInline
            preload="metadata"
            aria-label="Live accelerometer and gyroscope readings plotted over time, with the traces jumping as the phone passes over a pothole"
          >
            <source src="/media/hero-analysis.webm" type="video/webm" />
            <source src="/media/hero-analysis.mp4" type="video/mp4" />
          </video>
        </Reveal>
      </div>
    </section>
  )
}
