import { useState, useEffect, useRef } from 'react'
import Button from '../../components/common/Button.jsx'
import Card from '../../components/common/Card.jsx'
import Alert from '../../components/common/Alert.jsx'
import Badge from '../../components/common/Badge.jsx'
import useAuth from '../../hooks/useAuth.js'
import { supabase } from '../../lib/supabaseClient.js'
import { isVerifiedOfficial, sanitizeAuthError } from '../../utils/authorization.js'
import { resendConfirmationEmail } from '../../services/authService.js'

/**
 * Safely parses authentication callback parameters from URL hash and query string.
 * Never leaks raw tokens or secrets.
 */
function extractAuthCallbackDetails() {
  if (typeof window === 'undefined') {
    return { hasError: false, hasTokens: false }
  }

  const hashString = (window.location.hash || '').replace(/^#\/?/, '')
  const searchString = (window.location.search || '').replace(/^\?/, '')

  const searchParams = new URLSearchParams(searchString)

  let hashQueryPart = hashString
  if (hashString.includes('?')) {
    hashQueryPart = hashString.split('?')[1]
  }
  const hashParams = new URLSearchParams(hashQueryPart)

  const rawError =
    hashParams.get('error') ||
    searchParams.get('error') ||
    (hashString.includes('error=') ? 'access_denied' : null)

  const rawErrorCode =
    hashParams.get('error_code') ||
    searchParams.get('error_code') ||
    (hashString.includes('otp_expired') ? 'otp_expired' : null)

  const rawDescription =
    hashParams.get('error_description') ||
    searchParams.get('error_description') ||
    ''

  const decodedDescription = rawDescription
    ? decodeURIComponent(rawDescription.replace(/\+/g, ' '))
    : ''

  const hasAccessToken =
    hashParams.has('access_token') ||
    hashString.includes('access_token=') ||
    hashString.includes('type=signup') ||
    hashString.includes('type=email_change')

  const hasPkceCode = searchParams.has('code') || hashParams.has('code')

  return {
    hasError: Boolean(rawError || rawErrorCode),
    error: rawError,
    errorCode: rawErrorCode,
    errorDescription: decodedDescription,
    hasTokens: Boolean(hasAccessToken || hasPkceCode),
  }
}

export function AuthCallbackPage({ navigateTo }) {
  const {
    isAuthenticated,
    profile,
    setAuthNotice,
  } = useAuth()

  const [callbackState, setCallbackState] = useState(() => {
    const details = extractAuthCallbackDetails()
    if (details.hasError) {
      return {
        mode: 'error',
        errorCode: details.errorCode,
        errorDescription: details.errorDescription,
      }
    }
    if (details.hasTokens) {
      return {
        mode: 'verifying',
        errorCode: null,
        errorDescription: null,
      }
    }
    return {
      mode: 'idle',
      errorCode: null,
      errorDescription: null,
    }
  })

  const [resendEmail, setResendEmail] = useState('')
  const [resending, setResending] = useState(false)
  const [resendNotice, setResendNotice] = useState(null)
  const cleanedUrlRef = useRef(false)

  // Strip tokens/error hashes from browser address bar and history immediately for security
  useEffect(() => {
    if (typeof window !== 'undefined' && !cleanedUrlRef.current) {
      cleanedUrlRef.current = true
      try {
        const cleanPath = window.location.pathname || '/'
        window.history.replaceState(null, '', `${cleanPath}#auth-callback`)
      } catch {
        // Ignore replaceState errors
      }
    }
  }, [])

  // When tokens were present and the user session becomes active, redirect to their authoritative destination
  useEffect(() => {
    if (isAuthenticated && profile) {
      setAuthNotice({
        type: 'success',
        title: 'Account Confirmed',
        message: 'Your email address has been verified successfully. Welcome to TICORE!',
      })
      const destination = isVerifiedOfficial(profile) ? 'official-portal' : 'account'
      navigateTo(destination)
    }
  }, [isAuthenticated, profile, navigateTo, setAuthNotice])

  // Fallback timeout for verifying state in case token exchange fails silently
  useEffect(() => {
    if (callbackState.mode === 'verifying') {
      const timer = setTimeout(async () => {
        // Final check with Supabase getSession
        try {
          const { data } = await supabase.auth.getSession()
          if (!data?.session) {
            setCallbackState({
              mode: 'error',
              errorCode: 'session_exchange_failed',
              errorDescription: 'The email verification session could not be established. The link may have expired or was already used.',
            })
          }
        } catch {
          setCallbackState({
            mode: 'error',
            errorCode: 'session_exchange_failed',
            errorDescription: 'Unable to complete verification. Please sign in or request a new confirmation email.',
          })
        }
      }, 4000)

      return () => clearTimeout(timer)
    }
  }, [callbackState.mode])

  const handleResendConfirmation = async (e) => {
    e.preventDefault()
    setResendNotice(null)

    const clean = resendEmail.trim().toLowerCase()
    if (!clean) {
      setResendNotice({
        type: 'error',
        message: 'Please enter your registered email address.',
      })
      return
    }

    setResending(true)
    try {
      const { error } = await resendConfirmationEmail(clean)
      if (error) {
        setResendNotice({
          type: 'error',
          message: sanitizeAuthError(error, 'general'),
        })
      } else {
        setResendNotice({
          type: 'success',
          message: `A new confirmation email has been dispatched to ${clean}. Please check your inbox and click the latest link.`,
        })
        setResendEmail('')
      }
    } catch {
      setResendNotice({
        type: 'error',
        message: 'Unable to send confirmation email at this time. Please try again shortly.',
      })
    } finally {
      setResending(false)
    }
  }

  // --- RENDERING MODES ---

  if (callbackState.mode === 'verifying') {
    return (
      <div className="container" style={{ paddingTop: '3.5rem', maxWidth: '560px' }}>
        <Card
          title="Verifying Your Email..."
          subtitle="Barangay Timugan Court Reservation System"
          headerRight={<Badge status="pending">Confirming</Badge>}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <p style={{ fontSize: '0.9375rem', margin: 0, color: 'var(--color-text-secondary)' }}>
              Please wait while TICORE verifies your account confirmation link and synchronizes your profile...
            </p>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                padding: '1rem',
                backgroundColor: 'var(--color-surface-muted)',
                borderRadius: 'var(--radius-md)',
                fontSize: '0.875rem',
              }}
            >
              <span
                style={{
                  display: 'inline-block',
                  width: '16px',
                  height: '16px',
                  border: '2px solid var(--color-primary)',
                  borderTopColor: 'transparent',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite',
                }}
                aria-hidden="true"
              />
              <span>Connecting to Supabase Authentication...</span>
            </div>
          </div>
        </Card>
      </div>
    )
  }

  // Error or Link Expired
  const isOtpExpired =
    callbackState.errorCode === 'otp_expired' ||
    String(callbackState.errorDescription || '').toLowerCase().includes('expired')

  const title = isOtpExpired
    ? 'Email Confirmation Link Expired'
    : 'Authentication Verification Notice'

  const subtitle = isOtpExpired
    ? 'The link in your email has expired or has already been used'
    : 'Unable to verify email confirmation link'

  return (
    <div className="container" style={{ paddingTop: '3rem', maxWidth: '600px' }}>
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
          Barangay Timugan Civic Portal
        </span>
        <h1 style={{ margin: '0.35rem 0 0.5rem', fontSize: '2rem' }}>
          {title}
        </h1>
        <p style={{ fontSize: '0.9375rem', color: 'var(--color-text-secondary)', margin: 0 }}>
          {subtitle}
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <Alert type="warning" title={isOtpExpired ? 'Link No Longer Active' : 'Confirmation Incomplete'}>
          {isOtpExpired
            ? 'For security reasons, email confirmation links are time-limited. If you previously clicked this link, your account may already be confirmed.'
            : (callbackState.errorDescription || 'The authentication link could not be verified. You may request a new verification email below.')}
        </Alert>

        <Card title="What would you like to do?">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div
              style={{
                backgroundColor: 'var(--color-surface-muted)',
                borderRadius: 'var(--radius-md)',
                padding: '1rem',
                fontSize: '0.875rem',
                lineHeight: 1.6,
              }}
            >
              <p style={{ margin: '0 0 0.5rem 0', fontWeight: 600 }}>
                Helpful Tips:
              </p>
              <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
                <li>
                  <strong>Already clicked the link before?</strong> Your account is likely already confirmed. You can go straight to <strong>Sign In</strong>.
                </li>
                <li>
                  <strong>Never confirmed?</strong> Enter your email below to request a fresh verification link.
                </li>
              </ul>
            </div>

            {/* Resend Confirmation Email Form */}
            <form onSubmit={handleResendConfirmation} noValidate>
              <div className="form-group" style={{ marginBottom: '0.75rem' }}>
                <label className="form-label" htmlFor="resend-email">
                  Request New Confirmation Link
                </label>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  <input
                    id="resend-email"
                    type="email"
                    className="form-input"
                    placeholder="Enter your registered email"
                    value={resendEmail}
                    onChange={(e) => setResendEmail(e.target.value)}
                    disabled={resending}
                    style={{ flex: '1 1 240px' }}
                  />
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={resending}
                  >
                    {resending ? 'Sending...' : 'Resend Email'}
                  </Button>
                </div>
              </div>
            </form>

            {resendNotice && (
              <Alert type={resendNotice.type} title={resendNotice.type === 'success' ? 'Dispatched' : 'Notice'}>
                {resendNotice.message}
              </Alert>
            )}

            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '0.75rem',
                paddingTop: '1rem',
                borderTop: '1px solid var(--color-border-subtle)',
              }}
            >
              <Button
                variant="primary"
                onClick={() => navigateTo('login')}
              >
                Go to Sign In
              </Button>
              <Button
                variant="outline"
                onClick={() => navigateTo('register')}
              >
                Register Account
              </Button>
              <Button
                variant="ghost"
                onClick={() => navigateTo('home')}
              >
                Return to Home
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}

export default AuthCallbackPage
