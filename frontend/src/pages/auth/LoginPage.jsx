import { useState } from 'react'
import Button from '../../components/common/Button.jsx'
import Card from '../../components/common/Card.jsx'
import Alert from '../../components/common/Alert.jsx'
import Badge from '../../components/common/Badge.jsx'
import useAuth from '../../hooks/useAuth.js'
import { isVerifiedOfficial } from '../../utils/authorization.js'

export function LoginPage({ navigateTo }) {
  const {
    signIn,
    isAuthenticated,
    profile,
    authNotice,
    clearAuthNotice,
    intendedRoute,
    setIntendedRoute,
  } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setErrorMsg('')
    clearAuthNotice()

    const cleanEmail = email.trim()
    if (!cleanEmail || !password) {
      setErrorMsg('Please enter both your email address and password.')
      return
    }

    setSubmitting(true)
    try {
      const result = await signIn({ email: cleanEmail, password })
      if (!result.success) {
        setErrorMsg(result.error)
        return
      }

      const targetPage =
        intendedRoute ||
        (isVerifiedOfficial(result.profile) ? 'official-portal' : 'account')

      setIntendedRoute(null)
      navigateTo(targetPage)
    } finally {
      setSubmitting(false)
    }
  }

  if (isAuthenticated && profile) {
    return (
      <div className="container" style={{ paddingTop: '3rem', maxWidth: '560px' }}>
        <Card
          title="Already Signed In"
          subtitle="Active Barangay Timugan Session"
          headerRight={
            <Badge status={isVerifiedOfficial(profile) ? 'available' : 'pending'}>
              {profile.role}
            </Badge>
          }
        >
          <p style={{ marginBottom: '1.25rem', fontSize: '0.9375rem' }}>
            You are currently signed in as <strong>{profile.full_name}</strong> ({profile.email}).
          </p>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <Button variant="primary" onClick={() => navigateTo('account')}>
              Go to My Account
            </Button>
            {isVerifiedOfficial(profile) && (
              <Button variant="secondary" onClick={() => navigateTo('official-portal')}>
                Open Official Portal
              </Button>
            )}
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="container" style={{ paddingTop: '2.5rem', maxWidth: '520px' }}>
      <div style={{ marginBottom: '1.75rem' }}>
        <span
          style={{
            fontSize: '0.8125rem',
            fontWeight: 700,
            color: 'var(--color-primary)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          Barangay Timugan Portal
        </span>
        <h1 style={{ margin: '0.35rem 0 0.5rem', fontSize: '2rem' }}>Sign In to TICORE</h1>
        <p style={{ fontSize: '0.9375rem' }}>
          Access your court reservation profile, manage your schedule, or sign in with verified Barangay Official credentials.
        </p>
      </div>

      {authNotice && (
        <div style={{ marginBottom: '1.25rem' }}>
          <Alert type={authNotice.type || 'info'} title={authNotice.title}>
            {authNotice.message}
          </Alert>
        </div>
      )}

      {errorMsg && (
        <div style={{ marginBottom: '1.25rem' }}>
          <Alert type="error" title="Sign-In Failed">
            {errorMsg}
          </Alert>
        </div>
      )}

      <Card>
        <form onSubmit={handleSubmit} noValidate>
          <div className="form-group">
            <label className="form-label" htmlFor="email">
              Email Address <span className="required" aria-hidden="true">*</span>
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              enterKeyHint="next"
              required
              className="form-input"
              placeholder="resident@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={submitting}
            />
          </div>

          <div className="form-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label className="form-label" htmlFor="current-password">
                Password <span className="required" aria-hidden="true">*</span>
              </label>
              <button
                type="button"
                onClick={() => navigateTo('forgot-password')}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--color-primary)',
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                Forgot password?
              </button>
            </div>
            <div className="input-with-action">
              <input
                id="current-password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                enterKeyHint="done"
                required
                className="form-input"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
              />
              <button
                type="button"
                className="input-action-btn"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          <div style={{ marginTop: '1.5rem' }}>
            <Button
              type="submit"
              variant="primary"
              disabled={submitting}
              style={{ width: '100%' }}
            >
              {submitting ? 'Signing In...' : 'Sign In'}
            </Button>
          </div>
        </form>

        <div
          style={{
            marginTop: '1.5rem',
            paddingTop: '1.25rem',
            borderTop: '1px solid var(--color-border-subtle)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
            fontSize: '0.875rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
            <span style={{ color: 'var(--color-text-secondary)' }}>
              New to TICORE?
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigateTo('register')}
            >
              Create Resident Account
            </Button>
          </div>

          <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', margin: 0 }}>
            <strong>Official Access Notice:</strong> Barangay Official accounts cannot be created through public registration. Verified officials sign in above using their authorized credentials.
          </p>
        </div>
      </Card>
    </div>
  )
}

export default LoginPage

