import Brand from './Brand.jsx'

export default function Footer({ wide = false }) {
  return (
    <footer className="footer">
      <div className={`wrap${wide ? ' wrap--wide' : ''} footer__inner`}>
        <Brand />
        <p>A prototype for recording potholes in Chicago from ordinary phones.</p>
      </div>
    </footer>
  )
}
