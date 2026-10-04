import { useState } from 'react'
import Button from '../../components/common/Button.jsx'
import Card from '../../components/common/Card.jsx'
import Alert from '../../components/common/Alert.jsx'
import useAuth from '../../hooks/useAuth.js'

export function ResetPasswordPage({ navigateTo }) {
  const { isAuthenticated, isPasswordRecovery, changePassword } = useAuth()

  const [newPassword, setNewPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [completed, setCompleted] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setErrorMsg('')

    if (!newPassword || newPassword.length < 8) {
      setErrorMsg('Please enter a new password with at least 8 characters.')
      return
    }

    setSubmitting(true)
    try {
      const result = await changePassword(newPassword)
      if (!result.success) {
        setErrorMsg(result.error)
        return
      }
      setCompleted(true)
      setNewPassword('')
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
          Password Security
        </span>
        <h1 style={{ margin: '0.35rem 0 0.5rem', fontSize: '2rem' }}>Set a New Password</h1>
        <p style={{ fontSize: '0.9375rem' }}>
          Choose a strong new password for your Barangay Timugan TICORE account.
        </p>
      </div>

      {errorMsg && (
        <div style={{ marginBottom: '1.25rem' }}>
          <Alert type="error" title="Password Update Failed">
            {errorMsg}
          </Alert>
        </div>
      )}

      <Card>
        {completed ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <Alert type="success" title="Password Updated Successfully">
              Your account password has been changed. You can now continue using your account securely.
            </Alert>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <Button variant="primary" onClick={() => navigateTo('account')}>
                Go to My Account
              </Button>
              <Button variant="outline" onClick={() => navigateTo('home')}>
                Return to Home
              </Button>
            </div>
          </div>
        ) : !isAuthenticated && !isPasswordRecovery ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <Alert type="warning" title="Recovery Session Required">
              This password reset link is inactive or has expired. Please request a new password reset link or sign in to your account to update your password.
            </Alert>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <Button variant="primary" onClick={() => navigateTo('forgot-password')}>
                Request New Reset Link
              </Button>
              <Button variant="outline" onClick={() => navigateTo('login')}>
                Sign In
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            <div className="form-group">
              <label className="form-label" htmlFor="new-password">
                New Password <span className="required" aria-hidden="true">*</span>
              </label>
              <div className="input-with-action">
                <input
                  id="new-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  enterKeyHint="done"
                  required
                  minLength={8}
                  className="form-input"
                  placeholder="Minimum 8 characters"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
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
              <span className="form-hint">
                Use at least 8 characters. Avoid reusing passwords from other sites.
              </span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', marginTop: '1.5rem' }}>
              <Button
                type="button"
                variant="outline"
                onClick={() => navigateTo(isAuthenticated ? 'account' : 'login')}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={submitting}
              >
                {submitting ? 'Updating Password...' : 'Save New Password'}
              </Button>
            </div>
          </form>
        )}
      </Card>
    </div>
  )
}

export default ResetPasswordPage

