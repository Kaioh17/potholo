import { CloudRain, Drop, Snowflake, Sun, ThermometerSimple } from '@phosphor-icons/react'
import { climateFor, model } from '../forecast/lifecycle.js'

/**
 * The drivers behind the month on screen.
 *
 * The map shows potholes getting worse; this says why, in the order the
 * mechanism actually runs: water arrives, the temperature crosses zero and back,
 * that crossing does the damage, and the damage is what the growth curve
 * integrates. Reading left to right is reading the causal chain.
 *
 * The freeze-thaw count is given the most weight because it is the only one of
 * these that the growth model actually consumes. Rainfall and temperature are
 * shown because they explain the freeze-thaw number, not because the model reads
 * them separately -- and putting July's 102 mm of rain next to its zero
 * freeze-thaw days is the clearest way to show that water alone does nothing.
 */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

const Stat = ({ icon, label, value, sub, tone }) => (
  <div className={`cond__stat${tone ? ` cond__stat--${tone}` : ''}`}>
    <span className="cond__icon">{icon}</span>
    <span className="cond__body">
      <span className="cond__label">{label}</span>
      <span className="cond__value">{value}</span>
      {sub && <span className="cond__sub">{sub}</span>}
    </span>
  </div>
)

export default function Conditions({ at, monthlyGrowth }) {
  const c = climateFor(at)
  const damaging = c.ft_days > 0

  return (
    <section className="cond" aria-label={`Conditions for ${MONTHS[at.getMonth()]} ${at.getFullYear()}`}>
      <header className="cond__head">
        <div className="cond__when">
          <p className="cond__month">{MONTHS[at.getMonth()]}</p>
          <p className="cond__year">{at.getFullYear()}</p>
        </div>
        <span className={`tag ${c.actual ? 'tag--green' : 'tag--amber'}`}>
          {c.actual ? 'weather as recorded' : 'typical Chicago month'}
        </span>
      </header>

      <div className="cond__grid">
        <Stat
          icon={c.snow_cm > 0.5 ? <Snowflake size={18} weight="bold" /> : <CloudRain size={18} weight="bold" />}
          label={c.snow_cm > 0.5 ? 'Snowfall' : 'Rainfall'}
          value={c.snow_cm > 0.5 ? `${c.snow_cm.toFixed(0)} cm` : `${c.precip_mm.toFixed(0)} mm`}
          sub={c.snow_cm > 0.5 ? `plus ${c.precip_mm.toFixed(0)} mm water` : 'no snow'}
        />
        <Stat
          icon={<ThermometerSimple size={18} weight="bold" />}
          label="Temperature"
          value={`${c.tmin_c.toFixed(0)} to ${c.tmax_c.toFixed(0)} C`}
          sub="daily mean low and high"
        />
        <Stat
          icon={damaging ? <Snowflake size={18} weight="bold" /> : <Sun size={18} weight="bold" />}
          label="Freeze-thaw days"
          value={c.ft_days.toFixed(c.actual ? 0 : 1)}
          sub={damaging ? 'water freezes, expands, levers the crack' : 'nothing crosses zero'}
          tone={damaging ? 'active' : 'idle'}
        />
        <Stat
          icon={<Drop size={18} weight="bold" />}
          label="Damage this month"
          value={`x${c.damage_index.toFixed(2)}`}
          sub={
            c.damage_index >= 1
              ? `${c.damage_index.toFixed(1)} months of wear in one`
              : c.damage_index > 0
                ? 'less than an average month'
                : 'no measurable wear'
          }
          tone={c.damage_index >= 1 ? 'active' : 'idle'}
        />
      </div>

      <p className="cond__chain">
        {damaging ? (
          <>
            Water is in the cracks and the temperature crosses zero{' '}
            <strong>{c.ft_days.toFixed(c.actual ? 0 : 1)} times</strong> this month. Each crossing
            expands the ice by about 9% and levers the crack wider, so severity grows at{' '}
            <strong>{(model.k * c.damage_index).toFixed(3)}</strong> per month here
            {monthlyGrowth != null && monthlyGrowth > 0.05 && (
              <> &mdash; about <strong>{monthlyGrowth.toFixed(1)} points</strong> of severity across the fleet</>
            )}
            .
          </>
        ) : (
          <>
            {c.precip_mm.toFixed(0)} mm of rain fell and nothing froze, so nothing was levered apart.
            This is the part the mechanism makes counter-intuitive: Chicago gets{' '}
            <strong>more rain in July than in January</strong>, and July does no damage at all.
            Potholes hold still through the summer.
          </>
        )}
      </p>
    </section>
  )
}
