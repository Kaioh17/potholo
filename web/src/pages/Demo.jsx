import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Pause, Play, Pulse } from '@phosphor-icons/react'
import Nav from '../components/Nav.jsx'
import Footer from '../components/Footer.jsx'
import CityBlockScene from '../sim/CityBlockScene.jsx'
import { GlossaryDialog, GlossaryToggle } from '../demo/Glossary.jsx'
import { useDemoPhone } from '../demo/useDemoPhone.js'

const READOUT_INTERVAL_MS = 100

// Named speed/drive-time combinations, after the speed categories the API's own
// evaluation scenarios use (mock/scenarios.py), so a first try shows the range the
// real detector is tested against. "Drive time" is real seconds until the front
// wheel is over the pothole - lower feels like a shorter, sharper look at it.
const SCENARIOS = [
  { name: 'Residential', speed: 9, driveTime: 8 },
  { name: 'Everyday test drive', speed: 8, driveTime: 5 },
  { name: 'Arterial', speed: 16, driveTime: 4 },
  { name: 'Highway', speed: 25, driveTime: 2.5 },
]
const DRIVE_TIME_MIN = 2
const DRIVE_TIME_MAX = 10
const DRIVE_TIME_STEP = 0.5

function Tuning({ speed, driveTime, onChange }) {
  return (
    <section className="try__tuning" aria-label="Drive settings">
      <h2>Try a different drive</h2>
      <p className="try__tuning-hint">
        Pick a scenario, or set your own time to the pothole. Both change the drive below and what the
        phone reports.
      </p>
      <div className="try__chips" role="group" aria-label="Scenario">
        {SCENARIOS.map((s) => (
          <button
            key={s.name}
            type="button"
            className="chip"
            aria-pressed={speed === s.speed && driveTime === s.driveTime}
            onClick={() => onChange({ speed: s.speed, driveTime: s.driveTime })}
          >
            {s.name}
            <span>{s.speed} m/s</span>
          </button>
        ))}
      </div>
      <div className="try__slider-row">
        <label className="try__slider">
          <span className="sr-only">Time to pothole</span>
          <input
            type="range"
            min={DRIVE_TIME_MIN}
            max={DRIVE_TIME_MAX}
            step={DRIVE_TIME_STEP}
            value={driveTime}
            onChange={(e) => onChange({ speed, driveTime: Number(e.target.value) })}
          />
        </label>
        <span className="try__slider-value">{driveTime.toFixed(1)}s to impact</span>
      </div>
    </section>
  )
}

// The newest sample, read a few times a second so only this panel re-renders, not once per frame.
function useLiveSample(liveRef) {
  const [live, setLive] = useState({ sample: null, tripId: null })
  useEffect(() => {
    const timer = setInterval(() => setLive({ ...liveRef.current }), READOUT_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [liveRef])
  return live
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

function Row({ label, value, mono }) {
  return (
    <div className="recording__row">
      <dt>{label}</dt>
      <dd className={mono ? 'recording__mono' : undefined}>{value}</dd>
    </div>
  )
}

function statusTag({ error, recent, playing }) {
  if (error) return { text: 'API offline', tone: 'tag--red' }
  if (recent) return { text: 'Pothole found', tone: 'tag--amber' }
  return { text: playing ? 'Sending' : 'Ready', tone: '' }
}

function Recording({ phone, playing, onOpenHelp, showTryCta }) {
  const { deviceId, sampleRate, liveRef, upload } = phone
  const { sample, tripId } = useLiveSample(liveRef)
  const tag = statusTag({ error: upload.error, recent: phone.recentDetection, playing })
  const det = upload.lastDetection

  return (
    <aside className="recording" aria-label="What the phone records and sends">
      <div className="recording__head">
        <p className="recording__title">
          <Pulse size={18} weight="bold" aria-hidden="true" />
          Recording
        </p>
        <span className={`tag ${tag.tone}`.trim()}>{tag.text}</span>
      </div>

      <GlossaryToggle onOpen={onOpenHelp} />

      <dl className="recording__list">
        <Row label="device_id" value={deviceId} mono />
        <Row label="trip_id" value={tripId ?? '-'} mono />
        <Row label="sample_rate_hint" value={`${sampleRate} Hz`} mono />
      </dl>

      {showTryCta ? (
        <div className="recording__cta">
          <p className="recording__cta-text">
            This is a fixed showcase drive. Pick your own phone, speed and time to impact, and see
            your own device send readings to the real API.
          </p>
          <Link to="/try" className="btn btn--sm">
            Try it yourself
          </Link>
        </div>
      ) : (
        <>
          <p className="eyebrow recording__eyebrow">Latest sample in imu</p>
          <dl className="recording__metrics" aria-live="off">
            <Metric label="ax" value={sample ? signed(sample.ax, 2) : '-'} unit="m/s²" />
            <Metric label="gx" value={sample ? signed(sample.gx, 3) : '-'} unit="rad/s" />
            <Metric label="ay" value={sample ? signed(sample.ay, 2) : '-'} unit="m/s²" />
            <Metric label="gy" value={sample ? signed(sample.gy, 3) : '-'} unit="rad/s" />
            <Metric label="az" value={sample ? signed(sample.az, 2) : '-'} unit="m/s²" />
            <Metric label="gz" value={sample ? signed(sample.gz, 3) : '-'} unit="rad/s" />
            <Metric label="t" value={sample ? sample.t.toFixed(2) : '-'} unit="s" />
            <Metric label="Batches sent" value={String(upload.batches)} unit="" />
          </dl>

          <p className="eyebrow recording__eyebrow">API response</p>
          <dl className="recording__list">
            <Row label="POST" value="/v1/batches" mono />
            <Row label="Samples ingested" value={upload.samples.toLocaleString()} />
            <Row label="Potholes found" value={String(upload.detections)} />
            <Row label="Severity" value={det ? det.severity.toFixed(0) : '-'} />
            <Row label="Confidence" value={det ? det.confidence.toFixed(2) : '-'} />
            <Row label="Location" value={det ? `${det.lat.toFixed(5)}, ${det.lon.toFixed(5)}` : '-'} mono />
          </dl>
          {upload.error && (
            <p className="recording__error">
              Could not send: {upload.error}. Start it with <code>cd api &amp;&amp; fastapi dev</code>.
            </p>
          )}

          <p className="eyebrow recording__eyebrow">Last request body</p>
          <pre className="recording__body" tabIndex={0}>
            {upload.lastBody ?? 'Press Play. The first body is sent once three seconds have been recorded.'}
          </pre>

          <p className="recording__note">
            The readings are a recorded trace with a little random variation on every value. They are sent to
            the real API in the format a phone app would use, and the API alone decides what counts as a
            pothole.
          </p>
        </>
      )}
    </aside>
  )
}

// The car, its controls and the phone's recording.  Uploads as `deviceId`, or as a random demo phone.
// `tunable` adds a scenario picker and a time-to-pothole slider above the drive (used on /try only;
// /demo stays the fixed showcase).
export function DemoPlayer({ deviceId, tunable = false }) {
  const [playing, setPlaying] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [speed, setSpeed] = useState(8)
  const [driveTime, setDriveTime] = useState(5)
  const phone = useDemoPhone(playing, deviceId, { speed, driveTime })

  return (
    <>
      {tunable && (
        <Tuning
          speed={speed}
          driveTime={driveTime}
          onChange={(next) => {
            setSpeed(next.speed)
            setDriveTime(next.driveTime)
          }}
        />
      )}
      <div className="demo__grid">
        <div className="window demo__stage">
          <div className="window__bar" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className="demo__controls">
            <button type="button" className="btn btn--sm" onClick={() => setPlaying((p) => !p)}>
              {playing ? <Pause size={16} weight="bold" aria-hidden="true" /> : <Play size={16} weight="bold" aria-hidden="true" />}
              {playing ? 'Pause' : 'Play'}
            </button>
            <p className="demo__status">
              {playing ? 'Sending readings to the API as they are recorded.' : 'Paused. Nothing is sent until you press Play.'}
            </p>
          </div>
          <div className="demo__canvas">
            <CityBlockScene playing={playing} speed={speed} driveTime={driveTime} onTelemetry={phone.onTelemetry} />
          </div>
        </div>
        <Recording
          phone={phone}
          playing={playing}
          onOpenHelp={() => setHelpOpen(true)}
          showTryCta={!tunable}
        />
      </div>
      <GlossaryDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
    </>
  )
}

export default function Demo() {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Nav />
      <main id="main" className="demo">
        <div className="wrap">
          <Link to="/" className="login__back demo__back">
            <ArrowLeft size={16} weight="bold" aria-hidden="true" />
            Back to site
          </Link>

          <header className="demo__head">
            <p className="eyebrow">Demo</p>
            <h1>Drive through a pothole.</h1>
            <p className="demo__lede">
              Press Play and a simulated car drives down a Chicago-style street and hits a pothole. Time slows so you
              can watch the front wheel drop in, the nose dip, and the rear wheel follow.
              While it drives, this page acts as the phone in the car. It sends accelerometer, gyroscope and
              location readings to the API as they are recorded, and the API works out whether there was a pothole.
            </p>
          </header>

          <DemoPlayer />
        </div>
      </main>
      <Footer />
    </>
  )
}
