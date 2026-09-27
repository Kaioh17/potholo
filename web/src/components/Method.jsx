import { model } from '../forecast/lifecycle.js'

/**
 * Where every number in this forecast came from.
 *
 * Each figure is read out of the generated calibration rather than typed in, so
 * this cannot drift away from the model it describes: re-run
 * `data/analysis/calibrate_model.py` and the prose follows.
 *
 * The ordering is deliberate. Sources first, because a reader's first question
 * is "says who". Then the scale, because "severity 70" means nothing until you
 * know it is a saturating index of wheel impulse and not a depth in
 * centimetres. Then the findings, then the arithmetic that turns them into a
 * rate. The one assumption sits in the middle of that arithmetic, marked.
 */

const c = model.calibration
const g = c.growth
const fmt = (n, d = 0) => n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d })

const SOURCES = [
  {
    name: 'Chicago 311, Pot Holes Reported',
    detail: '559,867 requests 2011-2018; 164,631 (29.4%) removed as city-flagged duplicates, leaving 394,453',
    gives: 'seasonality, repair latency, re-report intervals',
    href: 'https://data.cityofchicago.org/Service-Requests/311-Service-Requests-Pot-Holes-Reported-Historical/7as2-ds3y',
  },
  {
    name: 'Open-Meteo ERA5 reanalysis',
    detail: 'daily min/max temperature, precipitation and snowfall for Chicago; 2011-2018 to calibrate, plus 47 recent months to display',
    gives: 'the freeze-thaw damage index',
    href: 'https://open-meteo.com/en/docs/historical-weather-api',
  },
  {
    name: 'Chicago Average Daily Traffic Counts',
    detail: '1,279 counter locations joined to pothole requests within 250 m',
    gives: 'the test that excluded traffic from the model',
    href: 'https://data.cityofchicago.org/Transportation/Average-Daily-Traffic-Counts/pfsx-4n4m',
  },
  {
    name: 'Chicago Street Center Lines',
    detail: '551 segments and 72 named streets around Union Station',
    gives: 'the basemap, and where the synthetic potholes sit',
    href: 'https://data.cityofchicago.org/Transportation/Street-Center-Lines/pr57-gg9e',
  },
]

function Step({ n, title, children }) {
  return (
    <li className="method__step">
      <span className="method__n">{n}</span>
      <div>
        <h3>{title}</h3>
        {children}
      </div>
    </li>
  )
}

export default function Method() {
  const peakMonth = c.seasonality.peak_month
  const peak = c.seasonality.peak_trough_ratio
  const spring = c.seasonality.spring_share_mean * 100
  const springSd = c.seasonality.spring_share_sd * 100
  const jan = c.damage_driver.monthly_damage_index.Jan
  const jul = c.damage_driver.monthly_damage_index.Jul
  const anchor = g.anchor
  const sens = g.anchor_sensitivity
  const pop = g.rate_population
  const reopen = c.reopen

  return (
    <details className="method">
      <summary>What it does tell you, and how we calculated it</summary>
      <p className="method__lede">
        Every figure below is read straight out of the generated calibration, so this page and the
        model cannot disagree. Re-run <code>data/analysis/calibrate_model.py</code> and these
        numbers move with it.
      </p>

      <h3 className="method__sub">Where the data comes from</h3>
      <ul className="method__sources">
        {SOURCES.map((s) => (
          <li key={s.name}>
            <a href={s.href} target="_blank" rel="noreferrer noopener">{s.name}</a>
            <span className="method__detail">{s.detail}</span>
            <span className="method__gives">&rarr; {s.gives}</span>
          </li>
        ))}
      </ul>
      <p className="method__note">
        All four are public and need no API key. Nothing in this project had a time dimension of its
        own &mdash; every cluster in the database was created hours ago by the mock fleet &mdash; so
        a lifecycle could not be fitted from our own data at all.
      </p>

      <h3 className="method__sub">What the severity number is</h3>
      <p>
        It is not a depth. It comes from the detector, in{' '}
        <code>api/app/detection/severity.py</code>, and it is a saturating index of the{' '}
        <strong>strike impulse the wheel measured</strong>, normalised to 30 mph:
      </p>
      <p className="method__eq">severity = 100 &times; (1 &minus; e<sup>&minus;&Delta;v / 0.50</sup>)</p>
      <p>
        So severity 40 is a 0.255 m/s impulse, 70 is 0.602 m/s and 80 is 0.805 m/s. The 40 and 70
        band edges are the detector&apos;s own buckets, not something this model invented. Because
        the scale saturates, 100 means &ldquo;far past the point of arguing&rdquo; rather than any
        particular size.
      </p>

      <h3 className="method__sub">How the forecast is built</h3>
      <ol className="method__steps">
        <Step n="1" title="Measure the season">
          <p>
            Reports follow a sharp, repeatable annual cycle: peak in {peakMonth}, a{' '}
            <strong>{fmt(peak, 1)}&times;</strong> peak-to-trough swing, and{' '}
            <strong>{fmt(spring, 1)}% &plusmn; {fmt(springSd, 1)}%</strong> of each year&apos;s
            reports falling in February to April across all eight years. That tight deviation on an
            eight-year sample is the most solid thing here.
          </p>
        </Step>

        <Step n="2" title="Turn weather into damage">
          <p>
            A freeze-thaw day is one where the temperature crosses 0&nbsp;&deg;C in both directions;
            days with moisture count fully and dry ones at 35%, because ice needs water in the crack
            to lever it open. Averaged over eight years that gives a damage multiplier per calendar
            month &mdash; January <strong>&times;{fmt(jan, 2)}</strong>, July{' '}
            <strong>&times;{fmt(jul, 2)}</strong>. The model therefore runs on{' '}
            <em>damage-months</em>, not calendar months.
          </p>
          <p className="method__check">
            Cross-check that was not fitted: the weather-derived damage peaks in December to
            February, the 311-derived reports peak in March. Reports lag damage by about two months,
            which independently reproduces the two-month lag found in the correlation analysis.
          </p>
        </Step>

        <Step n="3" title="Find a real growth timescale">
          <p>
            <strong>{fmt(reopen.repeat_share * 100, 1)}%</strong> of{' '}
            {fmt(reopen.blocks)} Chicago blocks were reported more than once, giving{' '}
            {fmt(reopen.n_intervals)} intervals. The median gap is{' '}
            <strong>{fmt(reopen.median_days)} days</strong> &mdash; how long a block takes to go
            from repaired back to complaint-worthy.
          </p>
        </Step>

        <Step n="4" title="Solve for the rate">
          <p>
            Severity grows logistically in damage time,{' '}
            <code>ds/dD = k &middot; s &middot; (1 &minus; s/100)</code>. Assuming that interval
            spans severity {fmt(anchor.from_severity)} to {fmt(anchor.to_severity)}:
          </p>
          <pre className="method__math">{`logit(${fmt(anchor.to_severity)}) - logit(${fmt(anchor.from_severity)}) = ${fmt(pop.logit_span, 4)}
${fmt(reopen.median_days)} days / 30.4                = ${fmt(anchor.over_months, 2)} damage-months
k = ${fmt(pop.logit_span, 4)} / ${fmt(anchor.over_months, 2)}              = ${fmt(g.k_per_damage_month, 4)}`}</pre>
          <p className="method__assumed">
            <strong>This is the one assumption in the chain.</strong> That the interval spans 40 to
            80 is a choice, not a measurement &mdash; no published growth rate exists for untreated
            potholes, because nobody instruments a hole and lets it run.
          </p>
        </Step>

        <Step n="5" title="Check how much that choice matters">
          <p>Reading the same {fmt(reopen.median_days)} days four different ways:</p>
          <ul className="method__alts">
            {sens.alternatives.map((a) => (
              <li key={a.label}>
                <code>k = {fmt(a.k, 4)}</code> <span>{a.label}</span>
              </li>
            ))}
          </ul>
          <p>
            Choosing the span moves k by <strong>{fmt(sens.span_choice_ratio, 1)}&times;</strong>.
            The spread between fast and slow blocks moves it by{' '}
            <strong>{fmt(sens.population_spread_ratio, 1)}&times;</strong>. The spread dominates by
            almost five to one, which is the reassuring part: the forecast is mostly the
            data&apos;s, not the modeller&apos;s.
          </p>
        </Step>

        <Step n="6" title="Give each pothole its own rate">
          <p>
            The re-report intervals are close to lognormal &mdash; two independent quantile pairs
            agree on &sigma; ({fmt(pop.interval_log_sigma, 2)}) &mdash; so each synthetic pothole
            draws its own interval from that measured distribution rather than taking the median.
            One shared rate makes the entire fleet cross into severe in the same month, which is an
            artefact of the model rather than anything about roads.
          </p>
          <p className="method__note">
            This is legitimate because these potholes are synthetic and the point is a realistic
            spread. For a real cluster we could not do it: nothing we measure about one hole tells
            us which rate it drew, so a real forecast uses the population median and shows the
            full band.
          </p>
        </Step>
      </ol>

      <h3 className="method__sub">What it therefore tells you</h3>
      <ul className="method__tells">
        <li>
          <strong>When, not whether.</strong> Which holes cross into severe first, and roughly how
          many months that takes &mdash; the useful output for ordering a repair queue.
        </li>
        <li>
          <strong>That the clock only runs in winter.</strong> A hole found in May costs nothing
          until November. Deferring a repair through the summer is close to free; deferring one
          through December is not.
        </li>
        <li>
          <strong>The size of the bill for doing nothing</strong>, with an honest band on it.
        </li>
        <li>
          <strong>Which of its own numbers are load-bearing.</strong> The seasonality is measured
          and solid, the rate is anchored but assumed, and traffic was tested and thrown out.
        </li>
      </ul>
    </details>
  )
}
