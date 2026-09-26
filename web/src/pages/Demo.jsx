import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Pulse } from '@phosphor-icons/react'
import Nav from '../components/Nav.jsx'
import Footer from '../components/Footer.jsx'
import CityBlockScene from '../sim/CityBlockScene.jsx'

const RAD_TO_DEG = 180 / Math.PI
const READOUT_INTERVAL_MS = 100
const EVENT_HOLD_MS = 2500

// What the mock phone reports about itself. These are fixed for the trip.
const TRIP_INFO = [
  ['Vehicle type', 'Sedan, 1,200 kg'],
  ['Wheelbase', '2.60 m'],
  ['Device', 'Phone, rigidly mounted'],
  ['Sample rate', '50 Hz'],
  ['Location', 'Chicago, IL'],
]

// The scene reports every frame into a ref, and the panel samples it a few times a
// second, so only this small panel re-renders.
function useReadout(telemetryRef) {
  const [readout, setReadout] = useState(null)
  const eventUntil = useRef(0)
  const peak = useRef({ value: 0, loopTime: 0 })

  useEffect(() => {
    const timer = setInterval(() => {
      const t = telemetryRef.current
      const now = performance.now()
      if (t.loopTime < peak.current.loopTime) peak.current.value = 0 // a new pass started
      peak.current.loopTime = t.loopTime
      peak.current.value = Math.max(peak.current.value, Math.abs(t.verticalAccel))
      if (t.wheelInHole > 0) eventUntil.current = now + EVENT_HOLD_MS
      setReadout({
        speed: t.speed,
        timeScale: t.timeScale,
        verticalAccel: t.verticalAccel,
        pitchRate: t.pitchRate * RAD_TO_DEG,
        rollRate: t.rollRate * RAD_TO_DEG,
        peak: peak.current.value,
        hit: now < eventUntil.current,
      })
    }, READOUT_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [telemetryRef])

  return readout
}

const signed = (value, digits) => `${value >= 0 ? '+' : '-'}${Math.abs(value).toFixed(digits)}`

function Metric({ label, value, unit }) {
  return (
    <div className="metric">
      <dt>{label}</dt>
      <dd>
        <span>{value}</span>
        <small>{unit}</small>
      </dd>
    </div>
  )
}

function Recording({ readout }) {
  const r = readout ?? { speed: 0, timeScale: 1, verticalAccel: 0, pitchRate: 0, rollRate: 0, peak: 0, hit: false }
  return (
    <aside className="recording" aria-label="Simulated recording">
      <div className="recording__head">
        <p className="recording__title">
          <Pulse size={18} weight="bold" aria-hidden="true" />
          Recording
        </p>
        <span className={`tag ${r.hit ? 'tag--amber' : ''}`.trim()}>{r.hit ? 'Pothole hit' : 'Smooth road'}</span>
      </div>

      <dl className="recording__list">
        {TRIP_INFO.map(([label, value]) => (
          <div key={label} className="recording__row">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      <p className="eyebrow recording__eyebrow">Live sensor values</p>
      <dl className="recording__metrics" aria-live="off">
        <Metric label="Speed" value={(r.speed * 3.6).toFixed(1)} unit="km/h" />
        <Metric label="Vertical accel" value={signed(r.verticalAccel, 2)} unit="m/s²" />
        <Metric label="Pitch rate" value={signed(r.pitchRate, 2)} unit="°/s" />
        <Metric label="Roll rate" value={signed(r.rollRate, 2)} unit="°/s" />
        <Metric label="Peak this pass" value={r.peak.toFixed(2)} unit="m/s²" />
        <Metric label="Playback" value={`${r.timeScale.toFixed(2)}x`} unit="" />
      </dl>

      <p className="recording__note">
        Simulated values. They come from the same suspension model that moves the car, not from a real phone.
      </p>
    </aside>
  )
}

export default function Demo() {
  const telemetryRef = useRef({ loopTime: 0, timeScale: 1, speed: 0, verticalAccel: 0, pitchRate: 0, rollRate: 0, wheelInHole: 0 })
  const onTelemetry = useCallback((telemetry) => {
    telemetryRef.current = telemetry
  }, [])
  const readout = useReadout(telemetryRef)

  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Nav wide />
      <main id="main" className="demo">
        <div className="wrap wrap--wide">
          <Link to="/" className="login__back demo__back">
            <ArrowLeft size={16} weight="bold" aria-hidden="true" />
            Back to site
          </Link>

          <header className="demo__head">
            <p className="eyebrow">Demo</p>
            <h1>Drive through a pothole.</h1>
            <p className="demo__lede">
              A simulated car drives down a Chicago-style street and hits a pothole. Time slows so you can watch the
              front wheel drop in, the nose dip, and the rear wheel follow.
              The panel shows the kind of readings a phone in the car would record.
            </p>
          </header>

          <div className="demo__grid">
            <div className="window demo__stage">
              <div className="window__bar" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <div className="demo__canvas">
                <CityBlockScene onTelemetry={onTelemetry} />
              </div>
            </div>
            <Recording readout={readout} />
          </div>
        </div>
      </main>
      <Footer wide />
    </>
  )
}
