import { useState } from 'react'
import Button from '../../components/common/Button.jsx'
import Card from '../../components/common/Card.jsx'
import Alert from '../../components/common/Alert.jsx'
import Badge from '../../components/common/Badge.jsx'
import useAuth from '../../hooks/useAuth.js'
import { isValidPhMobileNumber } from '../../utils/authorization.js'

export function RegisterPage({ navigateTo }) {
  const { signUp, isAuthenticated } = useAuth()

  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    mobileNumber: '',
    password: '',
    residencyType: 'timugan_resident',
    province: 'Laguna',
    cityMunicipality: 'Los Baños',
    barangay: 'Timugan',
    purokStreet: '',
    houseLotDetails: '',
  })

  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [confirmationRequired, setConfirmationRequired] = useState(false)

  const handleFieldChange = (field, value) => {
    setFormData((prev) => {
      const next = { ...prev, [field]: value }
      if (field === 'residencyType') {
        if (value === 'timugan_resident') {
          next.province = 'Laguna'
          next.cityMunicipality = 'Los Baños'
          next.barangay = 'Timugan'
        } else if (value === 'los_banos_resident') {
          next.province = 'Laguna'
          next.cityMunicipality = 'Los Baños'
        }
      }
      return next
    })
  }

  const validateForm = () => {
    if (formData.fullName.trim().length < 2) {
      return 'Please enter your full name (at least 2 characters).'
    }
    if (!formData.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) {
      return 'Please enter a valid email address.'
    }
    if (!isValidPhMobileNumber(formData.mobileNumber)) {
      return 'Please enter a valid 11-digit Philippine mobile number (e.g., 09171234567).'
    }
    if (formData.password.length < 8) {
      return 'Password must be at least 8 characters long.'
    }
    if (formData.province.trim().length < 2 || formData.cityMunicipality.trim().length < 2 || formData.barangay.trim().length < 2) {
      return 'Please complete your Province, Municipality/City, and Barangay address fields.'
    }
    if (!formData.purokStreet.trim()) {
      return 'Please provide your Purok, Zone, or Street address.'
    }
    return null
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setErrorMsg('')

    const validationError = validateForm()
    if (validationError) {
      setErrorMsg(validationError)
      window.scrollTo({ top: 80, behavior: 'smooth' })
      return
    }

    setSubmitting(true)
    try {
      const result = await signUp(formData)
      if (!result.success) {
        setErrorMsg(result.error)
        window.scrollTo({ top: 80, behavior: 'smooth' })
        return
      }

      if (result.requiresEmailConfirmation) {
        setConfirmationRequired(true)
        window.scrollTo({ top: 80, behavior: 'smooth' })
        return
      }

      navigateTo('account')
    } finally {
      setSubmitting(false)
    }
  }

  if (isAuthenticated) {
    return (
      <div className="container" style={{ paddingTop: '3rem', maxWidth: '580px' }}>
        <Card title="Account Active" subtitle="You are already signed in">
          <p style={{ marginBottom: '1.25rem', fontSize: '0.9375rem' }}>
            Your resident session is currently active. You can view or update your profile details in your account area.
          </p>
          <Button variant="primary" onClick={() => navigateTo('account')}>
            Go to My Account
          </Button>
        </Card>
      </div>
    )
  }

  if (confirmationRequired) {
    return (
      <div className="container" style={{ paddingTop: '3rem', maxWidth: '600px' }}>
        <Card
          title="Verify Your Email Address"
          subtitle="Resident Account Created"
          headerRight={<Badge status="pending">Verification Sent</Badge>}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <Alert type="success" title="Registration Submitted">
              We have created your resident account for <strong>{formData.email}</strong>. Please check your inbox and click the confirmation link to activate your session.
            </Alert>
            <p style={{ fontSize: '0.875rem', margin: 0 }}>
              Once confirmed, your structured residence profile in Barangay Timugan will be automatically linked with default <strong>Resident</strong> permissions.
            </p>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <Button variant="primary" onClick={() => navigateTo('login')}>
                Proceed to Sign In
              </Button>
              <Button variant="outline" onClick={() => navigateTo('home')}>
                Return to Home
              </Button>
            </div>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="container" style={{ paddingTop: '2.5rem', maxWidth: '720px' }}>
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
          Resident Registration
        </span>
        <h1 style={{ margin: '0.35rem 0 0.5rem', fontSize: '2rem' }}>Create a Resident Account</h1>
        <p style={{ fontSize: '0.9375rem' }}>
          Register for online court reservations at Barangay Timugan Covered Court. All public registrations are assigned the standard <strong>Resident</strong> role.
        </p>
      </div>

      {errorMsg && (
        <div style={{ marginBottom: '1.25rem' }}>
          <Alert type="error" title="Registration Error">
            {errorMsg}
          </Alert>
        </div>
      )}

      <Card
        title="Resident Account & Residence Information"
        subtitle="Complete your account credentials and structured residence address"
        headerRight={<Badge status="available">Role: Resident</Badge>}
      >
        <form onSubmit={handleSubmit} noValidate>
          {/* Section 1: Credentials & Identity */}
          <div className="form-row form-row-2">
            <div className="form-group">
              <label className="form-label" htmlFor="reg-full-name">
                Full Name <span className="required" aria-hidden="true">*</span>
              </label>
              <input
                id="reg-full-name"
                name="fullName"
                type="text"
                autoComplete="name"
                required
                className="form-input"
                placeholder="e.g. Juan C. Dela Cruz"
                value={formData.fullName}
                onChange={(e) => handleFieldChange('fullName', e.target.value)}
                disabled={submitting}
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="reg-mobile">
                Mobile Number (PH) <span className="required" aria-hidden="true">*</span>
              </label>
              <input
                id="reg-mobile"
                name="mobileNumber"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                required
                className="form-input"
                placeholder="e.g. 0917 123 4567"
                value={formData.mobileNumber}
                onChange={(e) => handleFieldChange('mobileNumber', e.target.value)}
                disabled={submitting}
              />
              <span className="form-hint">11-digit PH mobile number (09XXXXXXXXX).</span>
            </div>
          </div>

          <div className="form-row form-row-2">
            <div className="form-group">
              <label className="form-label" htmlFor="reg-email">
                Email Address <span className="required" aria-hidden="true">*</span>
              </label>
              <input
                id="reg-email"
                name="email"
                type="email"
                autoComplete="username"
                required
                className="form-input"
                placeholder="juan.delacruz@example.com"
                value={formData.email}
                onChange={(e) => handleFieldChange('email', e.target.value)}
                disabled={submitting}
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="new-password">
                Create Password <span className="required" aria-hidden="true">*</span>
              </label>
              <div className="input-with-action">
                <input
                  id="new-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  minLength={8}
                  className="form-input"
                  placeholder="Minimum 8 characters"
                  value={formData.password}
                  onChange={(e) => handleFieldChange('password', e.target.value)}
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
              <span className="form-hint">Use at least 8 characters. Password pasting is supported.</span>
            </div>
          </div>

          {/* Section 2: Structured Address */}
          <div
            style={{
              backgroundColor: 'var(--color-surface-muted)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              padding: '1.25rem',
              marginTop: '0.75rem',
              marginBottom: '1.25rem',
            }}
          >
            <h4 style={{ fontSize: '0.9375rem', marginBottom: '0.25rem', color: 'var(--color-primary-dark)' }}>
              Structured Residence Address
            </h4>
            <p style={{ fontSize: '0.8125rem', marginBottom: '1rem' }}>
              Used to pre-fill court reservation requests and verify Barangay Timugan resident priority.
            </p>

            <div className="form-group">
              <label className="form-label" htmlFor="reg-residency-type">
                Residency Classification <span className="required" aria-hidden="true">*</span>
              </label>
              <select
                id="reg-residency-type"
                className="form-select"
                value={formData.residencyType}
                onChange={(e) => handleFieldChange('residencyType', e.target.value)}
                disabled={submitting}
              >
                <option value="timugan_resident">Barangay Timugan Resident (Priority)</option>
                <option value="los_banos_resident">Other Los Baños Resident</option>
                <option value="non_resident">Outside Los Baños / Visitor</option>
              </select>
            </div>

            <div className="form-row form-row-3">
              <div className="form-group">
                <label className="form-label" htmlFor="reg-province">
                  Province <span className="required" aria-hidden="true">*</span>
                </label>
                <input
                  id="reg-province"
                  type="text"
                  autoComplete="address-level1"
                  required
                  className="form-input"
                  value={formData.province}
                  onChange={(e) => handleFieldChange('province', e.target.value)}
                  disabled={submitting}
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="reg-city">
                  Municipality / City <span className="required" aria-hidden="true">*</span>
                </label>
                <input
                  id="reg-city"
                  type="text"
                  autoComplete="address-level2"
                  required
                  className="form-input"
                  value={formData.cityMunicipality}
                  onChange={(e) => handleFieldChange('cityMunicipality', e.target.value)}
                  disabled={submitting}
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="reg-barangay">
                  Barangay <span className="required" aria-hidden="true">*</span>
                </label>
                <input
                  id="reg-barangay"
                  type="text"
                  required
                  className="form-input"
                  value={formData.barangay}
                  onChange={(e) => handleFieldChange('barangay', e.target.value)}
                  disabled={submitting}
                />
              </div>
            </div>

            <div className="form-row form-row-2">
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" htmlFor="reg-purok">
                  Purok / Zone / Street <span className="required" aria-hidden="true">*</span>
                </label>
                <input
                  id="reg-purok"
                  type="text"
                  autoComplete="address-line1"
                  required
                  className="form-input"
                  placeholder="e.g. Purok 2, Rizal St."
                  value={formData.purokStreet}
                  onChange={(e) => handleFieldChange('purokStreet', e.target.value)}
                  disabled={submitting}
                />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" htmlFor="reg-house">
                  House No. / Lot Details
                </label>
                <input
                  id="reg-house"
                  type="text"
                  autoComplete="address-line2"
                  className="form-input"
                  placeholder="e.g. Block 4, Lot 12"
                  value={formData.houseLotDetails}
                  onChange={(e) => handleFieldChange('houseLotDetails', e.target.value)}
                  disabled={submitting}
                />
              </div>
            </div>
          </div>

          {/* Privacy & Role Security Notice */}
          <div
            style={{
              padding: '0.875rem 1rem',
              borderRadius: 'var(--radius-md)',
              backgroundColor: '#f8fafc',
              border: '1px solid var(--color-border)',
              fontSize: '0.8125rem',
              color: 'var(--color-text-secondary)',
              marginBottom: '1.5rem',
            }}
          >
            <strong>Privacy & Role Security:</strong> Your personal information is stored securely in Barangay Timugan&apos;s database and protected by Row Level Security (RLS). Public accounts always start with the <strong>Resident</strong> role and cannot self-assign official privileges.
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            <Button
              type="button"
              variant="outline"
              onClick={() => navigateTo('login')}
              disabled={submitting}
            >
              Already have an account? Sign In
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={submitting}
            >
              {submitting ? 'Creating Resident Account...' : 'Create Resident Account'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}

export default RegisterPage

