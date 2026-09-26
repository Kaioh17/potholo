import Nav from '../components/Nav.jsx'
import Hero from '../components/Hero.jsx'
import HowItWorks from '../components/HowItWorks.jsx'
import Audiences from '../components/Audiences.jsx'
import DemoPlaceholder from '../components/DemoPlaceholder.jsx'
import Faq from '../components/Faq.jsx'
import Footer from '../components/Footer.jsx'

export default function Landing() {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Nav />
      <main id="main">
        <Hero />
        <HowItWorks />
        <Audiences />
        <DemoPlaceholder />
        <Faq />
      </main>
      <Footer />
    </>
  )
}
