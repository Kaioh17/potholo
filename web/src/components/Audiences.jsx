import { ShieldCheck, Bank, ChartLineUp } from '@phosphor-icons/react'
import Clamp from './Clamp.jsx'
import Reveal from './Reveal.jsx'

export default function Audiences() {
  return (
    <section id="who" className="section section--tint" aria-labelledby="who-title">
      <div className="wrap">
        <Reveal className="section__head">
          <p className="eyebrow">Who it helps</p>
          <h2 id="who-title">One record, three reasons it matters.</h2>
        </Reveal>

        <div className="bento">
          <Reveal as="article" className="card card--wide">
            <span className="icon-chip icon-chip--amber">
              <ShieldCheck size={22} weight="bold" aria-hidden="true" />
            </span>
            <span className="tag tag--amber">Insurance claims</span>
            <h3>Proof of where and when the damage happened.</h3>
            <Clamp>
              A wheel or tire claim usually turns on one question: was the pothole really there on
              that day? Potholo keeps a timestamped, location-tagged trail of reports for each
              pothole, so drivers and insurers can point to evidence instead of arguing from memory.
            </Clamp>
          </Reveal>

          <Reveal as="article" index={1} className="card">
            <span className="icon-chip icon-chip--blue">
              <Bank size={22} weight="bold" aria-hidden="true" />
            </span>
            <span className="tag tag--blue">Government allocation</span>
            <h3>Put repair money where roads are worst.</h3>
            <p>
              Ranked, mapped pothole counts by ward and street give budget teams a defensible basis
              for deciding which crews go where first.
            </p>
          </Reveal>

          <Reveal as="article" index={2} className="card">
            <span className="icon-chip icon-chip--green">
              <ChartLineUp size={22} weight="bold" aria-hidden="true" />
            </span>
            <span className="tag tag--green">Prevention and analysis</span>
            <h3>Find out why roads fail, then stop it.</h3>
            <p>
              Repeat offenders, freeze-thaw patterns and repair quality all show up in the data.
              Analysts can act on causes instead of only patching symptoms.
            </p>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
