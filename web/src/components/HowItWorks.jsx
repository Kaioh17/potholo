import { DeviceMobile, Pulse, Cpu, MapPinLine } from '@phosphor-icons/react'
import Reveal from './Reveal.jsx'

const STEPS = [
  {
    icon: DeviceMobile,
    title: 'The phone listens',
    body: 'The Potholo app samples the gyroscope and accelerometer while a driver is on the road. Everything runs on the phone.',
  },
  {
    icon: Pulse,
    title: 'A jolt is flagged',
    body: 'A sharp, short spike that does not match speed bumps, rail crossings or braking is marked as a pothole candidate.',
  },
  {
    icon: Cpu,
    title: 'The API checks it',
    body: 'A FastAPI service compares candidates with location, speed, time and reports from other phones on the same stretch.',
  },
  {
    icon: MapPinLine,
    title: 'A record is created',
    body: 'Confirmed potholes become timestamped, mapped records that can be searched, exported and tracked until repaired.',
  },
]

export default function HowItWorks() {
  return (
    <section id="how" className="section" aria-labelledby="how-title">
      <div className="wrap">
        <Reveal className="section__head">
          <p className="eyebrow">How it works</p>
          <h2 id="how-title">From a jolt in a cup holder to a record on a map.</h2>
        </Reveal>
        <ol className="steps">
          {STEPS.map(({ icon: Icon, title, body }, i) => (
            <Reveal as="li" key={title} index={i} className="step">
              <span className="step__num">0{i + 1}</span>
              <span className="icon-chip">
                <Icon size={22} weight="bold" aria-hidden="true" />
              </span>
              <h3>{title}</h3>
              <p>{body}</p>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  )
}
