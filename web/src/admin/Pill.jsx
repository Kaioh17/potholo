// A coloured status pill. `tone` comes from status.js: green, amber, red, blue or grey.
export default function Pill({ tone, children, title }) {
  return (
    <span className={`pill pill--${tone}`} title={title}>
      <span className="pill__dot" aria-hidden="true" />
      {children}
    </span>
  )
}
