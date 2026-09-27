import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ChatCircleText, DeviceMobile, Eye, Info, SignOut } from '@phosphor-icons/react'
import Nav from '../components/Nav.jsx'
import Footer from '../components/Footer.jsx'
import Clamp from '../components/Clamp.jsx'
import { API_URL } from '../admin/useFleet.js'
import { DemoPlayer } from './Demo.jsx'

const STORAGE_KEY = 'potholo.userId'
const MIN_NAME_LENGTH = 4
const STATS_INTERVAL_MS = 3000

// Storage can be blocked (private windows), and the page works without it.
function remembered(id) {
  try {
    if (id === undefined) return localStorage.getItem(STORAGE_KEY)
    if (id === null) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, id)
  } catch {
    /* nothing to remember with */
  }
  return null
}

async function request(path, options) {
  let response
  try {
    response = await fetch(`${API_URL}${path}`, options)
  } catch {
    throw new ApiError(0, 'The API is not reachable. Start it with cd api && fastapi dev.')
  }
  if (response.ok) return response.json()
  const detail = await response.json().catch(() => ({}))
  throw new ApiError(response.status, messageFrom(detail) ?? `The API answered ${response.status}.`)
}

class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

// The API's message for a rejected field: a string for 409, a list of validation errors for 422.
function messageFrom({ detail }) {
  if (typeof detail === 'string') return detail
  const first = Array.isArray(detail) ? detail[0]?.msg : null
  return first?.replace(/^Value error, /, '') ?? null
}

function JoinForm({ onJoined }) {
  const [phones, setPhones] = useState([])
  const [values, setValues] = useState({ name: '', phone: '' })
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const nameRef = useRef(null)
  const phoneRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    request('/v1/phones')
      .then((list) => !cancelled && setPhones(list))
      .catch((error) => !cancelled && setErrors({ form: error.message }))
    return () => {
      cancelled = true
    }
  }, [])

  const onChange = (event) => {
    const { name, value } = event.target
    setValues((prev) => ({ ...prev, [name]: value }))
    setErrors((prev) => ({ ...prev, [name]: undefined, form: undefined }))
  }

  const onSubmit = async (event) => {
    event.preventDefault()
    const name = values.name.trim().replace(/\s+/g, ' ')
    const found = {}
    if (name.length < MIN_NAME_LENGTH) found.name = `Name must be longer than ${MIN_NAME_LENGTH - 1} characters.`
    if (!values.phone) found.phone = 'Pick the phone you will use.'
    setErrors(found)
    if (found.name) return nameRef.current?.focus()
    if (found.phone) return phoneRef.current?.focus()

    setBusy(true)
    try {
      const user = await request('/v1/users/join', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, phone: values.phone }),
      })
      onJoined(user)
    } catch (error) {
      if (error.status === 409 || error.status === 422) {
        setErrors({ name: error.message })
        nameRef.current?.focus()
      } else setErrors({ form: error.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login__card try__join">
      <h1>Try Potholo</h1>
      <p className="login__sub">
        Pick a name and a phone. The API gives that phone its own device id, and everything it sends in the demo
        is filed under it.
      </p>
      <form onSubmit={onSubmit} noValidate>
        <div className="field">
          <label htmlFor="name">Name</label>
          <input
            ref={nameRef}
            id="name"
            name="name"
            type="text"
            autoComplete="nickname"
            maxLength={40}
            spellCheck={false}
            value={values.name}
            onChange={onChange}
            aria-invalid={errors.name ? 'true' : undefined}
            aria-describedby={errors.name ? 'name-error' : 'name-hint'}
          />
          {errors.name ? (
            <p id="name-error" className="field__error">
              {errors.name}
            </p>
          ) : (
            <p id="name-hint" className="field__hint">
              At least 4 characters, and not already taken.
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor="phone">Phone</label>
          <select
            ref={phoneRef}
            id="phone"
            name="phone"
            value={values.phone}
            onChange={onChange}
            aria-invalid={errors.phone ? 'true' : undefined}
            aria-describedby={errors.phone ? 'phone-error' : undefined}
          >
            <option value="">Choose a phone</option>
            {phones.map((phone) => (
              <option key={phone.slug} value={phone.slug}>
                {phone.label}
              </option>
            ))}
          </select>
          {errors.phone && (
            <p id="phone-error" className="field__error">
              {errors.phone}
            </p>
          )}
        </div>

        <button type="submit" className="btn login__submit" disabled={busy}>
          {busy ? 'Joining...' : 'Start the demo'}
        </button>
        {errors.form && (
          <p className="field__error" role="alert">
            {errors.form}
          </p>
        )}
      </form>
    </div>
  )
}

// What the API has recorded for this user's phone, refreshed while the page is open.
function useUserView(userId) {
  const [view, setView] = useState(null)
  useEffect(() => {
    let cancelled = false
    const load = () =>
      request(`/v1/users/${userId}`)
        .then((next) => !cancelled && setView(next))
        // Keep the last good numbers on screen through a blip.
        .catch(() => {})
    load()
    const timer = setInterval(load, STATS_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [userId])
  return view
}

function Stat({ label, value }) {
  return (
    <div className="metric">
      <dt>{label}</dt>
      <dd>
        <span>{value}</span>
      </dd>
    </div>
  )
}

function YourPhone({ user, onLeave }) {
  const view = useUserView(user.user_id)
  const device = view?.device

  return (
    <section className="try__phone" aria-label="Your phone">
      <div className="try__who">
        <DeviceMobile size={22} weight="bold" aria-hidden="true" />
        <div>
          <p className="try__name">{user.name}</p>
          <p className="try__device">
            {user.phone.label} <span aria-hidden="true">·</span> <code>{user.device_id}</code>
          </p>
        </div>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onLeave}>
          <SignOut size={16} weight="bold" aria-hidden="true" />
          Change name
        </button>
      </div>
      <dl className="try__stats">
        <Stat label="Batches received" value={device ? device.batches : 0} />
        <Stat label="Samples ingested" value={device ? device.samples.toLocaleString() : 0} />
        <Stat label="Potholes found" value={device ? device.detections : 0} />
        <Stat label="Confirmed with others" value={device ? device.confirmed_clusters : 0} />
      </dl>
    </section>
  )
}

// Read on demand, not polled: a Claude call is a real request, and the
// numbers it summarises only move once every few seconds anyway.
function Summary({ userId }) {
  const [state, setState] = useState({ status: 'idle' })

  const load = async () => {
    setState({ status: 'loading' })
    try {
      const result = await request(`/v1/users/${userId}/summary`)
      setState({ status: 'done', overview: result.overview, sections: result.sections })
    } catch (error) {
      setState({ status: 'error', message: error.message })
    }
  }

  return (
    <section className="try__summary" aria-label="Your pothole summary">
      <div className="try__summary-head">
        <h2>What your drive found</h2>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={load}
          disabled={state.status === 'loading'}
        >
          <ChatCircleText size={16} weight="bold" aria-hidden="true" />
          {state.status === 'loading' ? 'Reading your data...' : 'Get my summary'}
        </button>
      </div>
      {state.status === 'done' && (
        <div className="try__summary-body">
          <Clamp className="try__summary-text">{state.overview}</Clamp>
          {state.sections.length > 0 && (
            <dl className="try__summary-sections">
              {state.sections.map((section) => (
                <div key={section.key} className="try__summary-section">
                  <dt>{section.title}</dt>
                  <dd>
                    <Clamp>{section.body}</Clamp>
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
      {state.status === 'error' && (
        <p className="field__error" role="alert">
          {state.message}
        </p>
      )}
    </section>
  )
}

export default function Try() {
  // `undefined` while the remembered user is looked up, `null` when there is none.
  const [user, setUser] = useState(() => (remembered() ? undefined : null))

  useEffect(() => {
    const id = remembered()
    if (!id) return
    let cancelled = false
    request(`/v1/users/${id}`)
      .then((view) => {
        if (cancelled) return
        const { device: _device, ...rest } = view
        setUser(rest)
      })
      .catch((error) => {
        if (cancelled) return
        // Only forget the user when the API says it does not know them, not when it is unreachable.
        if (error.status === 404 || error.status === 422) remembered(null)
        setUser(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const joined = (next) => {
    remembered(next.user_id)
    setUser(next)
  }
  const leave = () => {
    remembered(null)
    setUser(null)
  }

  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Nav />
      <main id="main" className="demo">
        <div className="wrap">
          <div className="demo__top demo__back">
            <Link to="/" className="login__back">
              <ArrowLeft size={16} weight="bold" aria-hidden="true" />
              Back to site
            </Link>
            <Link to="/admin" className="btn btn--ghost btn--sm">
              <Eye size={16} weight="bold" aria-hidden="true" />
              See what admin sees
            </Link>
          </div>

          <p className="notice">
            <Info size={18} weight="bold" aria-hidden="true" />
            This is a prototype. The phone below is simulated, not your real device, and readings are demo data
            only.
          </p>

          {user === undefined ? null : user === null ? (
            <JoinForm onJoined={joined} />
          ) : (
            <>
              <header className="demo__head">
                <p className="eyebrow">Try it</p>
                <h1>Drive as {user.name}.</h1>
                <p className="demo__lede">
                  Press Play and your simulated {user.phone.label} rides through the same pothole as the demo. Its
                  readings reach the API under your device id, so the counts below are yours alone.
                </p>
              </header>
              <YourPhone user={user} onLeave={leave} />
              <Summary userId={user.user_id} />
              <DemoPlayer key={user.device_id} deviceId={user.device_id} tunable />
            </>
          )}
        </div>
      </main>
      <Footer />
    </>
  )
}
