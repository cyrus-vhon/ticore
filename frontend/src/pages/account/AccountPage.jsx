import { useState, useEffect } from 'react'
import Button from '../../components/common/Button.jsx'
import Card from '../../components/common/Card.jsx'
import Alert from '../../components/common/Alert.jsx'
import Badge from '../../components/common/Badge.jsx'
import useAuth from '../../hooks/useAuth.js'
import { isValidPhMobileNumber, PERMISSIONS } from '../../utils/authorization.js'
import {
  fetchMyVerificationStatus,
  requestContactOtpChallenge,
  verifyContactOtpChallenge,
} from '../../services/officialVerificationService.js'

const DISPLAY_PERMISSION_LIST = [
  { key: PERMISSIONS.CAN_MANAGE_RESERVATIONS, label: 'canManageReservations' },
  { key: PERMISSIONS.CAN_MANAGE_COURT_CLOSURES, label: 'canManageCourtClosures' },
  { key: PERMISSIONS.CAN_CREATE_OFFICIAL, label: 'canCreateOfficial' },
  { key: PERMISSIONS.CAN_VIEW_REPORTS, label: 'canViewReports' },
]

export function AccountPage({ navigateTo }) {
  const {
    user,
    profile,
    isOfficial,
    hasPermission,
    updateProfile,
    refreshProfile,
    signOut,
  } = useAuth()

  const [draftEdits, setDraftEdits] = useState({})
  const [saving, setSaving] = useState(false)
  const [statusNotice, setStatusNotice] = useState(null)

  const [verificationInfo, setVerificationInfo] = useState(null)
  const [otpChannel, setOtpChannel] = useState('mobile')
  const [otpChallengeActive, setOtpChallengeActive] = useState(false)
  const [otpCodeInput, setOtpCodeInput] = useState('')
  const [otpPreviewCode, setOtpPreviewCode] = useState('')
  const [otpBusy, setOtpBusy] = useState(false)
  const [otpNotice, setOtpNotice] = useState(null)

  useEffect(() => {
    if (!user?.id) return
    let active = true
    fetchMyVerificationStatus().then(({ statusData }) => {
      if (!active) return
      if (statusData) {
        setVerificationInfo(statusData)
      }
    })
    return () => {
      active = false
    }
  }, [user])

  const formData = {
    full_name: draftEdits.full_name ?? profile?.full_name ?? '',
    mobile_number: draftEdits.mobile_number ?? profile?.mobile_number ?? '',
    residency_type: draftEdits.residency_type ?? profile?.residency_type ?? 'timugan_resident',
    province: draftEdits.province ?? profile?.province ?? 'Laguna',
    city_municipality: draftEdits.city_municipality ?? profile?.city_municipality ?? 'Los Baños',
    barangay: draftEdits.barangay ?? profile?.barangay ?? 'Timugan',
    purok_street: draftEdits.purok_street ?? profile?.purok_street ?? '',
    house_lot_details: draftEdits.house_lot_details ?? profile?.house_lot_details ?? '',
  }

  const handleFieldChange = (field, value) => {
    setDraftEdits((prev) => ({
      ...prev,
      [field]: value,
    }))
  }

  const handleProfileSave = async (e) => {
    e.preventDefault()
    setStatusNotice(null)

    if (formData.full_name.trim().length < 2) {
      setStatusNotice({
        type: 'error',
        title: 'Validation Error',
        message: 'Full name must be at least 2 characters long.',
      })
      return
    }

    if (formData.mobile_number && !isValidPhMobileNumber(formData.mobile_number)) {
      setStatusNotice({
        type: 'error',
        title: 'Validation Error',
        message: 'Please enter a valid 11-digit Philippine mobile number (e.g., 09171234567).',
      })
      return
    }

    setSaving(true)
    try {
      const result = await updateProfile(formData)
      if (!result.success) {
        setStatusNotice({
          type: 'error',
          title: 'Unable to Save Changes',
          message: result.error,
        })
        return
      }

      setStatusNotice({
        type: 'success',
        title: 'Profile Updated',
        message: 'Your Barangay Timugan account profile has been saved.',
      })
    } finally {
      setSaving(false)
    }
  }

  const handleRequestOtp = async () => {
    setOtpBusy(true)
    setOtpNotice(null)
    try {
      const targetContact =
        otpChannel === 'mobile'
          ? formData.mobile_number || profile?.mobile_number || ''
          : user?.email || profile?.email || ''

      const res = await requestContactOtpChallenge({
        channel: otpChannel,
        targetContact,
      })

      if (!res.success) {
        setOtpNotice({
          type: 'error',
          title: 'OTP Challenge Blocked',
          message: res.error,
        })
        return
      }

      setOtpChallengeActive(true)
      setOtpCodeInput('')
      setOtpPreviewCode(res.verificationCodePreview || '')
      setOtpNotice({
        type: 'info',
        title: 'OTP Challenge Issued (Valid for 5 Minutes)',
        message: `Enter the 6-digit verification code to confirm ownership of your ${otpChannel}. Note: Contact OTP verification confirms contact ownership only and never grants Official privileges.`,
      })
    } finally {
      setOtpBusy(false)
    }
  }

  const handleVerifyOtp = async (e) => {
    e.preventDefault()
    setOtpBusy(true)
    setOtpNotice(null)
    try {
      const res = await verifyContactOtpChallenge(otpCodeInput)
      if (!res.success) {
        setOtpNotice({
          type: 'error',
          title: 'OTP Verification Failed',
          message: res.error,
        })
        return
      }

      setOtpChallengeActive(false)
      setOtpCodeInput('')
      setOtpPreviewCode('')
      await refreshProfile()
      const { statusData } = await fetchMyVerificationStatus()
      if (statusData) {
        setVerificationInfo(statusData)
      }

      setOtpNotice({
        type: 'success',
        title: 'Contact Ownership Verified',
        message: `Your contact method is now verified. Account role remains '${res.result?.role || profile?.role || 'resident'}' (OTP never promotes an account to Official).`,
      })
    } finally {
      setOtpBusy(false)
    }
  }

  const handleSignOut = async () => {
    await signOut()
    navigateTo('home')
  }

  const roleBadgeStatus = isOfficial ? 'available' : 'pending'
  const roleLabel = isOfficial ? 'Verified Official' : 'Resident'
  const contactVerified = Boolean(
    verificationInfo?.contact_verified || profile?.contact_verified_at
  )
  const latestNomination = verificationInfo?.latest_verification_record || null

  return (
    <div className="container" style={{ paddingTop: '2.5rem', paddingBottom: '3rem' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: '1rem',
          marginBottom: '2rem',
        }}
      >
        <div>
          <span
            style={{
              fontSize: '0.8125rem',
              fontWeight: 700,
              color: 'var(--color-primary)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Protected Account Area
          </span>
          <h1 style={{ margin: '0.35rem 0 0.5rem', fontSize: '2rem' }}>
            My Account & Verification Status
          </h1>
          <p style={{ fontSize: '0.9375rem', maxWidth: '640px' }}>
            Manage your contact details, verify your contact method via OTP, and inspect your authoritative Barangay Timugan account role and verification status.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          {isOfficial && (
            <Button variant="secondary" onClick={() => navigateTo('official-portal')}>
              Open Official Portal
            </Button>
          )}
          <Button variant="outline" onClick={handleSignOut}>
            Sign Out
          </Button>
        </div>
      </div>

      {statusNotice && (
        <div style={{ marginBottom: '1.5rem' }}>
          <Alert type={statusNotice.type} title={statusNotice.title}>
            {statusNotice.message}
          </Alert>
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
          gap: '1.75rem',
          alignItems: 'start',
        }}
      >
        {/* Left Column: Security, Verification & Contact OTP */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <Card
            title="Account Role & Authorization Status"
            subtitle="Enforced by Supabase PostgreSQL RLS & Triggers"
            headerRight={<Badge status={roleBadgeStatus}>{roleLabel}</Badge>}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.875rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
                <span style={{ color: 'var(--color-text-muted)' }}>Authenticated Email</span>
                <span style={{ fontWeight: 600 }}>{user?.email || profile?.email}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
                <span style={{ color: 'var(--color-text-muted)' }}>Authoritative Role</span>
                <span style={{ fontWeight: 700, textTransform: 'capitalize' }}>
                  {profile?.role || 'resident'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
                <span style={{ color: 'var(--color-text-muted)' }}>Official Verification Status</span>
                <Badge
                  status={
                    profile?.verification_status === 'verified'
                      ? 'approved'
                      : profile?.verification_status === 'pending'
                        ? 'pending'
                        : profile?.verification_status === 'rejected' || profile?.verification_status === 'revoked'
                          ? 'rejected'
                          : 'cancelled'
                  }
                >
                  {profile?.verification_status || 'unverified'}
                </Badge>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.5rem' }}>
                <span style={{ color: 'var(--color-text-muted)' }}>Contact Ownership (OTP)</span>
                <Badge status={contactVerified ? 'approved' : 'pending'}>
                  {contactVerified ? 'Contact Verified' : 'Unverified'}
                </Badge>
              </div>
            </div>

            <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginTop: '1rem', marginBottom: 0 }}>
              Public registration always creates a <strong>resident</strong> account. Role elevation to <strong>official</strong> requires formal nomination and credential verification by an authorized Barangay Official with <code>canCreateOfficial</code> permission.
            </p>

            {isOfficial && (
              <div style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid var(--color-border)' }}>
                <h4 style={{ fontSize: '0.875rem', marginBottom: '0.65rem' }}>
                  Granted Official Capabilities
                </h4>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                  {DISPLAY_PERMISSION_LIST.map(({ key, label }) => {
                    const enabled = hasPermission(key)
                    return (
                      <span
                        key={label}
                        style={{
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          padding: '0.25rem 0.6rem',
                          borderRadius: 'var(--radius-sm)',
                          backgroundColor: enabled ? 'var(--status-available-bg)' : 'var(--color-surface-muted)',
                          color: enabled ? 'var(--status-available-text)' : 'var(--color-text-muted)',
                          border: `1px solid ${enabled ? 'var(--status-available-border)' : 'var(--color-border)'}`,
                        }}
                      >
                        {label}: {enabled ? 'Granted' : 'Restricted'}
                      </span>
                    )
                  })}
                </div>
              </div>
            )}
          </Card>

          {/* Official Nomination / Verification Record Summary (if nominated) */}
          {latestNomination && (
            <Card
              title="Official Credential Verification Record"
              subtitle="Protected barangay official credential record (ID masked)"
              headerRight={
                <Badge
                  status={
                    latestNomination.verification_status === 'verified'
                      ? 'approved'
                      : latestNomination.verification_status === 'pending'
                        ? 'pending'
                        : 'rejected'
                  }
                >
                  {latestNomination.verification_status}
                </Badge>
              }
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem', fontSize: '0.85rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--color-text-muted)' }}>Designation / Position:</span>
                  <strong>{latestNomination.position}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--color-text-muted)' }}>Credential Type:</span>
                  <span>{latestNomination.id_type}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--color-text-muted)' }}>Masked Reference No.:</span>
                  <code>{latestNomination.id_number_masked}</code>
                </div>
                {latestNomination.verified_at && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--color-text-muted)' }}>Verified Timestamp:</span>
                    <span>{new Date(latestNomination.verified_at).toLocaleString()}</span>
                  </div>
                )}
                {latestNomination.rejection_or_revocation_reason && (
                  <div
                    style={{
                      marginTop: '0.5rem',
                      padding: '0.65rem',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--status-closed-bg)',
                      color: 'var(--status-closed-text)',
                      fontSize: '0.8125rem',
                    }}
                  >
                    <strong>Administrative Decision Note:</strong> {latestNomination.rejection_or_revocation_reason}
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* Contact Method Ownership Verification (OTP) Card */}
          <Card
            title="Contact Ownership Verification (OTP)"
            subtitle="Rate-limited 5-minute OTP challenge to verify phone/email ownership"
          >
            {otpNotice && (
              <div style={{ marginBottom: '1rem' }}>
                <Alert type={otpNotice.type} title={otpNotice.title}>
                  {otpNotice.message}
                </Alert>
              </div>
            )}

            <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginTop: 0, marginBottom: '0.85rem' }}>
              Verifying your mobile number or email confirms contact ownership for reservation notifications.{' '}
              <strong>Completing OTP verification never changes your account role to Official.</strong>
            </p>

            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '0.85rem', flexWrap: 'wrap' }}>
              <select
                className="form-select"
                aria-label="Verification channel"
                value={otpChannel}
                onChange={(e) => setOtpChannel(e.target.value)}
                disabled={otpBusy}
                style={{ maxWidth: '180px' }}
              >
                <option value="mobile">Mobile SMS OTP</option>
                <option value="email">Email OTP</option>
              </select>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleRequestOtp}
                disabled={otpBusy}
              >
                {otpBusy ? 'Sending...' : 'Request 6-Digit OTP'}
              </Button>
            </div>

            {otpChallengeActive && (
              <form onSubmit={handleVerifyOtp} style={{ borderTop: '1px solid var(--color-border)', paddingTop: '0.85rem' }}>
                {otpPreviewCode && (
                  <div
                    style={{
                      marginBottom: '0.75rem',
                      padding: '0.5rem 0.75rem',
                      backgroundColor: 'var(--color-surface-muted)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '0.8125rem',
                    }}
                  >
                    Local Verification Dispatch Preview Code: <strong>{otpPreviewCode}</strong> (Digest-only stored in DB; expires in 5 mins)
                  </div>
                )}
                <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'center' }}>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="Enter 6-digit OTP"
                    className="form-input"
                    value={otpCodeInput}
                    onChange={(e) => setOtpCodeInput(e.target.value)}
                    disabled={otpBusy}
                    required
                  />
                  <Button type="submit" variant="primary" size="sm" disabled={otpBusy}>
                    Verify Code
                  </Button>
                </div>
              </form>
            )}
          </Card>

          <Card title="Quick Resident Actions">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <Button variant="primary" onClick={() => navigateTo('reservation')}>
                Make a Court Reservation
              </Button>
              <Button variant="secondary" onClick={() => navigateTo('my-reservations')}>
                View My Reservations
              </Button>
              <Button variant="outline" onClick={() => navigateTo('calendar')}>
                View Court Availability Calendar
              </Button>
            </div>
          </Card>
        </div>

        {/* Right Column: Editable Profile & Structured Address Form */}
        <Card
          title="Personal & Structured Address Details"
          subtitle="Keep your contact and residence details accurate for faster reservation review"
        >
          <form onSubmit={handleProfileSave} noValidate>
            <div className="form-row form-row-2">
              <div className="form-group">
                <label className="form-label" htmlFor="acct-full-name">
                  Full Name <span className="required" aria-hidden="true">*</span>
                </label>
                <input
                  id="acct-full-name"
                  name="fullName"
                  type="text"
                  autoComplete="name"
                  required
                  className="form-input"
                  value={formData.full_name}
                  onChange={(e) => handleFieldChange('full_name', e.target.value)}
                  disabled={saving}
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="acct-mobile">
                  Mobile Number (PH) <span className="required" aria-hidden="true">*</span>
                </label>
                <input
                  id="acct-mobile"
                  name="mobileNumber"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  required
                  className="form-input"
                  placeholder="09171234567"
                  value={formData.mobile_number}
                  onChange={(e) => handleFieldChange('mobile_number', e.target.value)}
                  disabled={saving}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="acct-residency-type">
                Residency Classification <span className="required" aria-hidden="true">*</span>
              </label>
              <select
                id="acct-residency-type"
                className="form-select"
                value={formData.residency_type}
                onChange={(e) => handleFieldChange('residency_type', e.target.value)}
                disabled={saving}
              >
                <option value="timugan_resident">Barangay Timugan Resident (Priority)</option>
                <option value="los_banos_resident">Other Los Baños Resident</option>
                <option value="non_resident">Outside Los Baños / Visitor</option>
              </select>
            </div>

            <div className="form-row form-row-3">
              <div className="form-group">
                <label className="form-label" htmlFor="acct-province">
                  Province <span className="required" aria-hidden="true">*</span>
                </label>
                <input
                  id="acct-province"
                  type="text"
                  required
                  className="form-input"
                  value={formData.province}
                  onChange={(e) => handleFieldChange('province', e.target.value)}
                  disabled={saving}
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="acct-city">
                  Municipality / City <span className="required" aria-hidden="true">*</span>
                </label>
                <input
                  id="acct-city"
                  type="text"
                  required
                  className="form-input"
                  value={formData.city_municipality}
                  onChange={(e) => handleFieldChange('city_municipality', e.target.value)}
                  disabled={saving}
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="acct-barangay">
                  Barangay <span className="required" aria-hidden="true">*</span>
                </label>
                <input
                  id="acct-barangay"
                  type="text"
                  required
                  className="form-input"
                  value={formData.barangay}
                  onChange={(e) => handleFieldChange('barangay', e.target.value)}
                  disabled={saving}
                />
              </div>
            </div>

            <div className="form-row form-row-2">
              <div className="form-group">
                <label className="form-label" htmlFor="acct-purok">
                  Purok / Zone / Street
                </label>
                <input
                  id="acct-purok"
                  type="text"
                  className="form-input"
                  placeholder="e.g. Purok 2, Rizal St."
                  value={formData.purok_street}
                  onChange={(e) => handleFieldChange('purok_street', e.target.value)}
                  disabled={saving}
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="acct-house">
                  House No. / Lot Details
                </label>
                <input
                  id="acct-house"
                  type="text"
                  className="form-input"
                  placeholder="e.g. Block 4, Lot 12"
                  value={formData.house_lot_details}
                  onChange={(e) => handleFieldChange('house_lot_details', e.target.value)}
                  disabled={saving}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? 'Saving Changes...' : 'Save Profile Changes'}
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  )
}

export default AccountPage
