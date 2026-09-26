import { DeviceMobile } from '@phosphor-icons/react'
import Reveal from './Reveal.jsx'

export default function DemoPlaceholder() {
  return (
    <section id="demo" className="section" aria-labelledby="demo-title">
      <div className="wrap">
        <Reveal className="section__head">
          <p className="eyebrow">Demo</p>
          <h2 id="demo-title">A live walkthrough is on the way.</h2>
        </Reveal>

        <Reveal className="window" index={1}>
          <div className="window__bar" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className="window__body">
            <span className="icon-chip icon-chip--amber">
              <DeviceMobile size={22} weight="bold" aria-hidden="true" />
            </span>
            <h3>Interactive demo arrives with the Android app</h3>
            <p>
              Once the app is ready you will be able to ride along with a simulated trip, watch the
              gyroscope trace react to a pothole, and see the record appear on the map.
            </p>
            <span className="tag tag--amber">Coming soon</span>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
