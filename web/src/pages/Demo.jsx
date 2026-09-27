import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Pause, Play, Pulse } from '@phosphor-icons/react'
import Nav from '../components/Nav.jsx'
import Footer from '../components/Footer.jsx'
import CityBlockScene from '../sim/CityBlockScene.jsx'
import { GlossaryDialog, GlossaryToggle } from '../demo/Glossary.jsx'
import { useDemoPhone } from '../demo/useDemoPhone.js'

const READOUT_INTERVAL_MS = 100

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

function Recording({ phone, playing, onOpenHelp }) {
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
        The readings are a recorded trace with a little random variation on every value. They are sent to the
        real API in the format a phone app would use, and the API alone decides what counts as a pothole.
      </p>
    </aside>
  )
}

// The car, its controls and the phone's recording.  Uploads as `deviceId`, or as a random demo phone.
export function DemoPlayer({ deviceId }) {
  const [playing, setPlaying] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const phone = useDemoPhone(playing, deviceId)

  return (
    <>
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
            <CityBlockScene playing={playing} onTelemetry={phone.onTelemetry} />
          </div>
        </div>
        <Recording phone={phone} playing={playing} onOpenHelp={() => setHelpOpen(true)} />
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
              Press Play and a simulated car drives down a Chicago-style street and hits a pothole. Time slows so you
              can watch the front wheel drop in, the nose dip, and the rear wheel follow.
              While it drives, this page acts as the phone in the car. It sends accelerometer, gyroscope and
              location readings to the API as they are recorded, and the API works out whether there was a pothole.
            </p>
          </header>

          <DemoPlayer />
        </div>
      </main>
      <Footer wide />
    </>
  )
}
