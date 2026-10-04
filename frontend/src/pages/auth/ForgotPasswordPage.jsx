import { useState } from 'react'
import Button from '../../components/common/Button.jsx'
import Card from '../../components/common/Card.jsx'
import Alert from '../../components/common/Alert.jsx'
import useAuth from '../../hooks/useAuth.js'

export function ForgotPasswordPage({ navigateTo }) {
  const { sendPasswordReset } = useAuth()

  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setErrorMsg('')

    const cleanEmail = email.trim()
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setErrorMsg('Please enter a valid email address.')
      return
    }

    setSubmitting(true)
    try {
      const result = await sendPasswordReset(cleanEmail)
      if (!result.success && result.error && result.error.includes('Too many attempts')) {
        setErrorMsg(result.error)
        return
      }
      // Always display safe non-enumerating confirmation message
      setSubmitted(true)
    } finally {
      setSubmitting(false)
    }
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
          Account Recovery
        </span>
        <h1 style={{ margin: '0.35rem 0 0.5rem', fontSize: '2rem' }}>Forgot Your Password?</h1>
        <p style={{ fontSize: '0.9375rem' }}>
          Enter your registered email address and we will send you a secure link to reset your TICORE password.
        </p>
      </div>

      {errorMsg && (
        <div style={{ marginBottom: '1.25rem' }}>
          <Alert type="error" title="Unable to Process Request">
            {errorMsg}
          </Alert>
        </div>
      )}

      <Card>
        {submitted ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <Alert type="success" title="Reset Instructions Sent">
              If an account is associated with <strong>{email.trim()}</strong>, you will receive an email with instructions to reset your password shortly.
            </Alert>
            <p style={{ fontSize: '0.875rem', margin: 0 }}>
              Please check your spam or promotions folder if you do not see the message within a few minutes.
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <Button variant="primary" onClick={() => navigateTo('login')}>
                Return to Sign In
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setSubmitted(false)
                  setEmail('')
                }}
              >
                Send to Another Email
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            <div className="form-group">
              <label className="form-label" htmlFor="recovery-email">
                Registered Email Address <span className="required" aria-hidden="true">*</span>
              </label>
              <input
                id="recovery-email"
                name="email"
                type="email"
                autoComplete="username"
                enterKeyHint="done"
                required
                className="form-input"
                placeholder="resident@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', marginTop: '1.5rem' }}>
              <Button
                type="button"
                variant="outline"
                onClick={() => navigateTo('login')}
                disabled={submitting}
              >
                ← Back to Sign In
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={submitting}
              >
                {submitting ? 'Sending Reset Link...' : 'Send Password Reset Link'}
              </Button>
            </div>
          </form>
        )}
      </Card>
    </div>
  )
}

export default ForgotPasswordPage

