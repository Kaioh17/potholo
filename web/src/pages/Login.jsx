import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Eye, EyeSlash, Info } from '@phosphor-icons/react'
import Brand from '../components/Brand.jsx'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function validate({ email, password }) {
  const errors = {}
  if (!email.trim()) errors.email = 'Enter your email address.'
  else if (!EMAIL_PATTERN.test(email.trim())) errors.email = 'Enter a valid email, like name@example.com.'
  if (!password) errors.password = 'Enter your password.'
  return errors
}

export default function Login() {
  const [values, setValues] = useState({ email: '', password: '' })
  const [errors, setErrors] = useState({})
  const [showPassword, setShowPassword] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const emailRef = useRef(null)
  const passwordRef = useRef(null)

  const onChange = (event) => {
    const { name, value } = event.target
    setValues((prev) => ({ ...prev, [name]: value }))
    setSubmitted(false)
  }

  const onSubmit = (event) => {
    event.preventDefault()
    const found = validate(values)
    setErrors(found)
    if (found.email) emailRef.current?.focus()
    else if (found.password) passwordRef.current?.focus()
    else setSubmitted(true)
  }

  return (
    <div className="login">
      <div className="login__top wrap">
        <Link to="/" className="login__back">
          <ArrowLeft size={16} weight="bold" aria-hidden="true" />
          Back to site
        </Link>
      </div>

      <main className="login__main">
        <div className="login__card">
          <Brand />
          <h1>Log in</h1>
          <p className="login__sub">Access your Potholo account.</p>

          <form onSubmit={onSubmit} noValidate>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                ref={emailRef}
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                spellCheck={false}
                placeholder="name@example.com"
                value={values.email}
                onChange={onChange}
                aria-invalid={errors.email ? 'true' : undefined}
                aria-describedby={errors.email ? 'email-error' : undefined}
              />
              {errors.email && (
                <p id="email-error" className="field__error">
                  {errors.email}
                </p>
              )}
            </div>

            <div className="field">
              <label htmlFor="password">Password</label>
              <div className="field__wrap">
                <input
                  ref={passwordRef}
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={values.password}
                  onChange={onChange}
                  aria-invalid={errors.password ? 'true' : undefined}
                  aria-describedby={errors.password ? 'password-error' : undefined}
                />
                <button
                  type="button"
                  className="field__toggle"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? (
                    <EyeSlash size={18} weight="bold" aria-hidden="true" />
                  ) : (
                    <Eye size={18} weight="bold" aria-hidden="true" />
                  )}
                </button>
              </div>
              {errors.password && (
                <p id="password-error" className="field__error">
                  {errors.password}
                </p>
              )}
            </div>

            <button type="submit" className="btn login__submit">
              Log in
            </button>
          </form>

          <div className="login__notice" role="status" aria-live="polite">
            {submitted && (
              <p>
                <Info size={18} weight="bold" aria-hidden="true" />
                <span>
                  Sign-in is not connected yet. Accounts will arrive with the Potholo API.
                </span>
              </p>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
