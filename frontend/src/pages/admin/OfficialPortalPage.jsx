import { useState, useEffect, useCallback } from 'react'
import Button from '../../components/common/Button.jsx'
import Card from '../../components/common/Card.jsx'
import Alert from '../../components/common/Alert.jsx'
import Badge from '../../components/common/Badge.jsx'
import ConfirmDialog from '../../components/common/ConfirmDialog.jsx'
import useAuth from '../../hooks/useAuth.js'
import { verifyDatabaseRlsAccess } from '../../services/authService.js'
import {
  PERMISSIONS,
  DEFAULT_OFFICIAL_NOMINEE_PERMISSIONS,
} from '../../utils/authorization.js'
import {
  OFFICIAL_POSITIONS,
  OFFICIAL_ID_TYPES,
  fetchNominatableUserProfiles,
  fetchOfficialVerifications,
  initiateOfficialAccountCreation,
  reviewOfficialVerification,
  fetchOfficialVerificationAuditLogs,
} from '../../services/officialVerificationService.js'

export function OfficialPortalPage({ navigateTo }) {
  const { user, profile, hasPermission, canPerformAction } = useAuth()

  const canCreateOfficial = hasPermission(PERMISSIONS.CAN_CREATE_OFFICIAL)
  const canViewReports =
    hasPermission(PERMISSIONS.CAN_VIEW_REPORTS) || canCreateOfficial

  const [rlsCheck, setRlsCheck] = useState({
    loading: true,
    reservationsCount: 0,
    verificationsCount: 0,
    auditLogsCount: 0,
  })

  const [profilesList, setProfilesList] = useState([])
  const [verifications, setVerifications] = useState([])
  const [auditLogs, setAuditLogs] = useState([])
  const [loadingWorkspace, setLoadingWorkspace] = useState(false)
  const [statusFilter, setStatusFilter] = useState('all')
  const [portalNotice, setPortalNotice] = useState(null)

  // Official Creation / Nomination Form State
  const [nominationForm, setNominationForm] = useState({
    targetUserId: '',
    fullName: '',
    mobileNumber: '',
    position: OFFICIAL_POSITIONS[3],
    idType: OFFICIAL_ID_TYPES[0],
    idNumber: '',
    grantedPermissions: { ...DEFAULT_OFFICIAL_NOMINEE_PERMISSIONS },
    approveImmediately: false,
    verificationNotes: '',
  })
  const [nominationErrors, setNominationErrors] = useState({})
  const [submittingNomination, setSubmittingNomination] = useState(false)

  // Review Modal State (Approve / Reject / Revoke)
  const [reviewModal, setReviewModal] = useState({
    open: false,
    record: null,
    decision: 'verified',
    reasonOrNotes: '',
    grantedPermissions: { ...DEFAULT_OFFICIAL_NOMINEE_PERMISSIONS },
    submitting: false,
  })

  const loadVerificationWorkspace = useCallback(async () => {
    setLoadingWorkspace(true)
    try {
      const stats = await verifyDatabaseRlsAccess()
      setRlsCheck({
        loading: false,
        ...stats,
      })

      if (canCreateOfficial) {
        const [{ profiles }, { verifications: verifData }] = await Promise.all([
          fetchNominatableUserProfiles(),
          fetchOfficialVerifications(),
        ])
        setProfilesList(profiles || [])
        setVerifications(verifData || [])
      }

      if (canViewReports) {
        const { logs } = await fetchOfficialVerificationAuditLogs()
        setAuditLogs(logs || [])
      }
    } finally {
      setLoadingWorkspace(false)
    }
  }, [canCreateOfficial, canViewReports])

  useEffect(() => {
    let active = true
    Promise.resolve().then(async () => {
      if (!active) return
      await loadVerificationWorkspace()
    })
    return () => {
      active = false
    }
  }, [loadVerificationWorkspace])

  const handleSelectCandidateUser = (selectedUserId) => {
    const candidate = profilesList.find((p) => p.id === selectedUserId)
    setNominationForm((prev) => ({
      ...prev,
      targetUserId: selectedUserId,
      fullName: candidate?.full_name || prev.fullName,
      mobileNumber: candidate?.mobile_number || prev.mobileNumber,
    }))
    setNominationErrors((prev) => ({ ...prev, targetUserId: undefined }))
  }

  const handleToggleNominationPermission = (permKey) => {
    setNominationForm((prev) => {
      const nextVal = !prev.grantedPermissions[permKey]
      const updated = {
        ...prev.grantedPermissions,
        [permKey]: nextVal,
      }
      if (
        permKey === PERMISSIONS.CAN_MANAGE_COURT_CLOSURES ||
        permKey === PERMISSIONS.CAN_MANAGE_COURT
      ) {
        updated.canManageCourtClosures = nextVal
        updated.canManageCourt = nextVal
      }
      return {
        ...prev,
        grantedPermissions: updated,
      }
    })
  }

  const handleCreateOfficialSubmit = async (e) => {
    e.preventDefault()
    setPortalNotice(null)
    setNominationErrors({})

    if (!canCreateOfficial) {
      setPortalNotice({
        type: 'error',
        title: 'Insufficient Official Permission',
        message:
          'Your account does not hold the canCreateOfficial permission required to initiate official account creation.',
      })
      return
    }

    setSubmittingNomination(true)
    try {
      const res = await initiateOfficialAccountCreation(nominationForm, user?.id)
      if (!res.success) {
        if (res.fieldErrors) {
          setNominationErrors(res.fieldErrors)
        }
        setPortalNotice({
          type: 'error',
          title: 'Official Creation Blocked',
          message: res.error,
        })
        return
      }

      setPortalNotice({
        type: 'success',
        title: res.verification?.verification_status === 'verified'
          ? 'Official Account Verified & Activated'
          : 'Official Verification Record Created (Pending Review)',
        message: `Official credential record for ${res.verification?.full_name} (${res.verification?.position}) has been recorded with masked ID ${res.verification?.id_number_masked}.`,
      })

      setNominationForm({
        targetUserId: '',
        fullName: '',
        mobileNumber: '',
        position: OFFICIAL_POSITIONS[3],
        idType: OFFICIAL_ID_TYPES[0],
        idNumber: '',
        grantedPermissions: { ...DEFAULT_OFFICIAL_NOMINEE_PERMISSIONS },
        approveImmediately: false,
        verificationNotes: '',
      })

      await loadVerificationWorkspace()
    } finally {
      setSubmittingNomination(false)
    }
  }

  const openReviewDialog = (record, decision) => {
    setReviewModal({
      open: true,
      record,
      decision,
      reasonOrNotes: '',
      grantedPermissions: {
        canManageReservations: Boolean(record.granted_permissions?.canManageReservations),
        canManageCourtClosures: Boolean(
          record.granted_permissions?.canManageCourtClosures ||
            record.granted_permissions?.canManageCourt
        ),
        canManageCourt: Boolean(
          record.granted_permissions?.canManageCourtClosures ||
            record.granted_permissions?.canManageCourt
        ),
        canCreateOfficial: Boolean(record.granted_permissions?.canCreateOfficial),
        canViewReports: Boolean(record.granted_permissions?.canViewReports),
      },
      submitting: false,
    })
  }

  const handleConfirmReviewDecision = async () => {
    if (!reviewModal.record) return
    setReviewModal((prev) => ({ ...prev, submitting: true }))
    setPortalNotice(null)

    try {
      const res = await reviewOfficialVerification({
        verificationId: reviewModal.record.id,
        decision: reviewModal.decision,
        grantedPermissions:
          reviewModal.decision === 'verified' ? reviewModal.grantedPermissions : null,
        reasonOrNotes: reviewModal.reasonOrNotes,
      })

      if (!res.success) {
        setPortalNotice({
          type: 'error',
          title: 'Unable to Update Official Verification',
          message: res.error,
        })
        setReviewModal((prev) => ({ ...prev, submitting: false }))
        return
      }

      setReviewModal({
        open: false,
        record: null,
        decision: 'verified',
        reasonOrNotes: '',
        grantedPermissions: { ...DEFAULT_OFFICIAL_NOMINEE_PERMISSIONS },
        submitting: false,
      })

      setPortalNotice({
        type: 'success',
        title: `Verification Status Updated to '${res.verification?.verification_status}'`,
        message: `Official record for ${res.verification?.full_name} has been updated and logged in the immutable audit trail.`,
      })

      await loadVerificationWorkspace()
    } catch {
      setReviewModal((prev) => ({ ...prev, submitting: false }))
    }
  }

  const capabilityMatrix = [
    {
      action: 'approve_reservation',
      permission: PERMISSIONS.CAN_MANAGE_RESERVATIONS,
      title: 'Court Reservation Review & Approval',
      description:
        'Review pending applications, approve or reject schedules, and manage cancellations for Timugan Main Covered Court.',
    },
    {
      action: 'manage_closures',
      permission: PERMISSIONS.CAN_MANAGE_COURT_CLOSURES,
      title: 'Court Closure & Maintenance Scheduling',
      description:
        'Publish facility closure windows for maintenance, barangay assemblies, or weather emergencies.',
    },
    {
      action: 'verify_official',
      permission: PERMISSIONS.CAN_CREATE_OFFICIAL,
      title: 'Official Account Creation & Verification',
      description:
        'Nominate barangay officials, verify official IDs, and assign granular permissions without public self-registration.',
    },
    {
      action: 'view_audit_logs',
      permission: PERMISSIONS.CAN_VIEW_REPORTS,
      title: 'Security Audit Trail & Reports',
      description:
        'Inspect immutable audit logs of official verifications, role updates, reservation approvals, and closures.',
    },
  ]

  const eligibleCandidates = profilesList.filter(
    (p) => p.id !== user?.id
  )

  const filteredVerifications = verifications.filter((item) => {
    if (statusFilter === 'all') return true
    return item.verification_status === statusFilter
  })

  return (
    <div className="container" style={{ paddingTop: '2.5rem', paddingBottom: '3.5rem' }}>
      {/* Header */}
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
            Barangay Timugan Administration
          </span>
          <h1 style={{ margin: '0.35rem 0 0.5rem', fontSize: '2rem' }}>
            Official Verification & Authorization Portal
          </h1>
          <p style={{ fontSize: '0.9375rem', maxWidth: '720px' }}>
            Protected administrative foundation for verified Barangay Timugan officials. Enforces strict separation between authentication, contact ownership OTP, official credential verification, and granular permissions.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <Button variant="primary" onClick={() => navigateTo('official-dashboard')}>
            Open Official Dashboard
          </Button>
          <Button variant="outline" onClick={loadVerificationWorkspace} disabled={loadingWorkspace}>
            {loadingWorkspace ? 'Refreshing...' : 'Refresh Data'}
          </Button>
          <Button variant="outline" onClick={() => navigateTo('account')}>
            My Profile
          </Button>
        </div>
      </div>

      {portalNotice && (
        <div style={{ marginBottom: '1.5rem' }}>
          <Alert type={portalNotice.type} title={portalNotice.title}>
            {portalNotice.message}
          </Alert>
        </div>
      )}

      <div style={{ marginBottom: '1.75rem' }}>
        <Alert type="info" title="Official Identity & Authorization Active">
          Signed in as <strong>{profile?.full_name}</strong> with verified database role{' '}
          <strong>{profile?.role}</strong> and verification status{' '}
          <strong>{profile?.verification_status}</strong>.
        </Alert>
      </div>

      {/* RLS Scope Summary Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: '1.25rem',
          marginBottom: '2rem',
        }}
      >
        <Card
          title="Reservations Scope"
          subtitle="Supabase RLS Query"
          headerRight={<Badge status="available">Authorized</Badge>}
        >
          <p style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-primary-dark)', margin: '0 0 0.25rem' }}>
            {rlsCheck.loading ? '...' : rlsCheck.reservationsCount}
          </p>
          <p style={{ fontSize: '0.8125rem', margin: 0 }}>
            Total reservations visible under <code>reservations_select_own_or_official</code>.
          </p>
        </Card>

        <Card
          title="Official Verifications"
          subtitle="Protected Table Access"
          headerRight={
            <Badge status={canCreateOfficial ? 'available' : 'closed'}>
              {canCreateOfficial ? 'canCreateOfficial Granted' : 'Restricted'}
            </Badge>
          }
        >
          <p style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-primary-dark)', margin: '0 0 0.25rem' }}>
            {rlsCheck.loading ? '...' : rlsCheck.verificationsCount}
          </p>
          <p style={{ fontSize: '0.8125rem', margin: 0 }}>
            Records accessible under <code>official_verifications_select_authorized_official</code>.
          </p>
        </Card>

        <Card
          title="Immutable Audit Trail"
          subtitle="Security Event Logs"
          headerRight={
            <Badge status={canViewReports ? 'available' : 'closed'}>
              {canViewReports ? 'Permitted' : 'Restricted'}
            </Badge>
          }
        >
          <p style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--color-primary-dark)', margin: '0 0 0.25rem' }}>
            {rlsCheck.loading ? '...' : rlsCheck.auditLogsCount}
          </p>
          <p style={{ fontSize: '0.8125rem', margin: 0 }}>
            Audit entries visible under <code>audit_logs_select_authorized_official</code>.
          </p>
        </Card>
      </div>

      {/* Capability Matrix */}
      <div style={{ marginBottom: '2rem' }}>
        <Card
          title="Administrative Capability Matrix"
          subtitle="Granular permissions enforced by reusable authorization checks and Supabase PostgreSQL RLS"
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: '1.25rem',
            }}
          >
            {capabilityMatrix.map((item) => {
              const allowed = canPerformAction(item.action)
              return (
                <div
                  key={item.action}
                  style={{
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    padding: '1.15rem',
                    backgroundColor: allowed ? '#ffffff' : 'var(--color-surface-muted)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: '0.75rem',
                  }}
                >
                  <div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '0.5rem',
                        marginBottom: '0.5rem',
                      }}
                    >
                      <h4 style={{ fontSize: '0.9375rem', margin: 0 }}>{item.title}</h4>
                      <Badge status={allowed ? 'available' : 'closed'}>
                        {allowed ? 'Enabled' : 'Restricted'}
                      </Badge>
                    </div>
                    <p style={{ fontSize: '0.8125rem', margin: 0 }}>{item.description}</p>
                  </div>
                  <div
                    style={{
                      fontSize: '0.75rem',
                      color: 'var(--color-text-muted)',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    Permission: {item.permission}
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      </div>

      {/* Official Account Creation & Verification Section */}
      {!canCreateOfficial ? (
        <div style={{ marginBottom: '2rem' }}>
          <Alert type="warning" title="Official Creation & Credential Verification Restricted">
            You are signed in as a verified official, but your profile does not include the{' '}
            <code>canCreateOfficial</code> permission. In accordance with Barangay Timugan least-privilege security rules, only officials explicitly granted <code>canCreateOfficial</code> may nominate new officials or approve/revoke official verifications.
          </Alert>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))',
            gap: '1.75rem',
            alignItems: 'start',
            marginBottom: '2.25rem',
          }}
        >
          {/* Left: Initiate Official Account Creation / Nomination */}
          <Card
            title="Create / Nominate Official Account"
            subtitle="Protected workflow for elevating an existing resident account with verified barangay credentials"
          >
            <form onSubmit={handleCreateOfficialSubmit} noValidate>
              <div className="form-group">
                <label className="form-label" htmlFor="nom-user">
                  Select Registered User Account <span className="required">*</span>
                </label>
                <select
                  id="nom-user"
                  className="form-select"
                  value={nominationForm.targetUserId}
                  onChange={(e) => handleSelectCandidateUser(e.target.value)}
                  disabled={submittingNomination}
                  required
                >
                  <option value="">-- Choose a registered user to nominate --</option>
                  {eligibleCandidates.map((cand) => (
                    <option key={cand.id} value={cand.id}>
                      {cand.full_name} ({cand.email}) — [{cand.role} / {cand.verification_status}]
                    </option>
                  ))}
                </select>
                {nominationErrors.targetUserId && (
                  <p className="form-error" role="alert">{nominationErrors.targetUserId}</p>
                )}
              </div>

              <div className="form-row form-row-2">
                <div className="form-group">
                  <label className="form-label" htmlFor="nom-fullname">
                    Official Full Name <span className="required">*</span>
                  </label>
                  <input
                    id="nom-fullname"
                    type="text"
                    className="form-input"
                    value={nominationForm.fullName}
                    onChange={(e) =>
                      setNominationForm((prev) => ({ ...prev, fullName: e.target.value }))
                    }
                    disabled={submittingNomination}
                    required
                  />
                  {nominationErrors.fullName && (
                    <p className="form-error" role="alert">{nominationErrors.fullName}</p>
                  )}
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="nom-mobile">
                    Mobile Number (PH) <span className="required">*</span>
                  </label>
                  <input
                    id="nom-mobile"
                    type="tel"
                    className="form-input"
                    placeholder="09171234567"
                    value={nominationForm.mobileNumber}
                    onChange={(e) =>
                      setNominationForm((prev) => ({ ...prev, mobileNumber: e.target.value }))
                    }
                    disabled={submittingNomination}
                    required
                  />
                  {nominationErrors.mobileNumber && (
                    <p className="form-error" role="alert">{nominationErrors.mobileNumber}</p>
                  )}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="nom-position">
                  Official Position / Designation <span className="required">*</span>
                </label>
                <select
                  id="nom-position"
                  className="form-select"
                  value={nominationForm.position}
                  onChange={(e) =>
                    setNominationForm((prev) => ({ ...prev, position: e.target.value }))
                  }
                  disabled={submittingNomination}
                >
                  {OFFICIAL_POSITIONS.map((pos) => (
                    <option key={pos} value={pos}>
                      {pos}
                    </option>
                  ))}
                </select>
                {nominationErrors.position && (
                  <p className="form-error" role="alert">{nominationErrors.position}</p>
                )}
              </div>

              <div className="form-row form-row-2">
                <div className="form-group">
                  <label className="form-label" htmlFor="nom-id-type">
                    Official ID / Credential Type <span className="required">*</span>
                  </label>
                  <select
                    id="nom-id-type"
                    className="form-select"
                    value={nominationForm.idType}
                    onChange={(e) =>
                      setNominationForm((prev) => ({ ...prev, idType: e.target.value }))
                    }
                    disabled={submittingNomination}
                  >
                    {OFFICIAL_ID_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="nom-id-number">
                    ID / Reference Number <span className="required">*</span>
                  </label>
                  <input
                    id="nom-id-number"
                    type="text"
                    className="form-input"
                    placeholder="e.g. DILG-LB-2026-0841"
                    value={nominationForm.idNumber}
                    onChange={(e) =>
                      setNominationForm((prev) => ({ ...prev, idNumber: e.target.value }))
                    }
                    disabled={submittingNomination}
                    required
                  />
                  {nominationErrors.idNumber && (
                    <p className="form-error" role="alert">{nominationErrors.idNumber}</p>
                  )}
                </div>
              </div>

              {/* Least-Privilege Granular Permissions Selection */}
              <div
                style={{
                  marginBottom: '1.15rem',
                  padding: '0.95rem',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--color-surface-muted)',
                  border: '1px solid var(--color-border)',
                }}
              >
                <div style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '0.5rem' }}>
                  Assign Explicit Official Permissions (Least-Privilege)
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', fontSize: '0.8125rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={Boolean(nominationForm.grantedPermissions.canManageReservations)}
                      onChange={() =>
                        handleToggleNominationPermission(PERMISSIONS.CAN_MANAGE_RESERVATIONS)
                      }
                      disabled={submittingNomination}
                    />
                    <span>canManageReservations</span>
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={Boolean(nominationForm.grantedPermissions.canManageCourtClosures)}
                      onChange={() =>
                        handleToggleNominationPermission(PERMISSIONS.CAN_MANAGE_COURT_CLOSURES)
                      }
                      disabled={submittingNomination}
                    />
                    <span>canManageCourtClosures</span>
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={Boolean(nominationForm.grantedPermissions.canViewReports)}
                      onChange={() =>
                        handleToggleNominationPermission(PERMISSIONS.CAN_VIEW_REPORTS)
                      }
                      disabled={submittingNomination}
                    />
                    <span>canViewReports</span>
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={Boolean(nominationForm.grantedPermissions.canCreateOfficial)}
                      onChange={() =>
                        handleToggleNominationPermission(PERMISSIONS.CAN_CREATE_OFFICIAL)
                      }
                      disabled={submittingNomination}
                    />
                    <span>canCreateOfficial (Admin)</span>
                  </label>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="nom-notes">
                  Verification Notes / Appointment Reference
                </label>
                <input
                  id="nom-notes"
                  type="text"
                  className="form-input"
                  placeholder="Optional verification notes (protected from residents)"
                  value={nominationForm.verificationNotes}
                  onChange={(e) =>
                    setNominationForm((prev) => ({ ...prev, verificationNotes: e.target.value }))
                  }
                  disabled={submittingNomination}
                />
              </div>

              <div style={{ marginBottom: '1.15rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={nominationForm.approveImmediately}
                    onChange={(e) =>
                      setNominationForm((prev) => ({
                        ...prev,
                        approveImmediately: e.target.checked,
                      }))
                    }
                    disabled={submittingNomination}
                  />
                  <span>
                    <strong>Verify & activate official role immediately</strong> (uncheck to place in{' '}
                    <code>pending</code> verification status first)
                  </span>
                </label>
              </div>

              <Button type="submit" variant="primary" disabled={submittingNomination}>
                {submittingNomination
                  ? 'Recording Official Verification...'
                  : nominationForm.approveImmediately
                    ? 'Create & Verify Official Account'
                    : 'Submit Official Verification Record (Pending)'}
              </Button>
            </form>
          </Card>

          {/* Right: Official Verification Queue & Review */}
          <Card
            title="Official Verification Review Queue"
            subtitle="Approve pending official nominations, reject invalid records, or revoke credentials"
          >
            <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
              {['all', 'pending', 'verified', 'rejected', 'revoked'].map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  style={{
                    padding: '0.35rem 0.75rem',
                    borderRadius: 'var(--radius-sm)',
                    border:
                      statusFilter === st
                        ? '1px solid var(--color-primary)'
                        : '1px solid var(--color-border)',
                    backgroundColor:
                      statusFilter === st ? 'var(--color-primary)' : '#ffffff',
                    color: statusFilter === st ? '#ffffff' : 'var(--color-text)',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    textTransform: 'capitalize',
                    cursor: 'pointer',
                  }}
                >
                  {st}
                </button>
              ))}
            </div>

            {filteredVerifications.length === 0 ? (
              <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', margin: '1rem 0' }}>
                No official verification records match the selected filter.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
                {filteredVerifications.map((item) => {
                  const isOwnRecord = item.user_id === user?.id
                  const badgeStatus =
                    item.verification_status === 'verified'
                      ? 'approved'
                      : item.verification_status === 'pending'
                        ? 'pending'
                        : 'rejected'

                  return (
                    <div
                      key={item.id}
                      style={{
                        border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-md)',
                        padding: '1rem',
                        backgroundColor: '#ffffff',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'flex-start',
                          gap: '0.5rem',
                          marginBottom: '0.5rem',
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>
                            {item.full_name}
                          </div>
                          <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
                            {item.position} • {item.mobile_number}
                          </div>
                        </div>
                        <Badge status={badgeStatus}>{item.verification_status}</Badge>
                      </div>

                      <div
                        style={{
                          fontSize: '0.8rem',
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                          gap: '0.35rem',
                          marginBottom: '0.65rem',
                          color: 'var(--color-text-muted)',
                        }}
                      >
                        <div>
                          <strong>ID Type:</strong> {item.id_type}
                        </div>
                        <div>
                          <strong>Masked ID:</strong> <code>{item.id_number_masked}</code>
                        </div>
                        {item.verified_at && (
                          <div>
                            <strong>Verified At:</strong>{' '}
                            {new Date(item.verified_at).toLocaleDateString()}
                          </div>
                        )}
                      </div>

                      {item.rejection_or_revocation_reason && (
                        <div
                          style={{
                            fontSize: '0.78rem',
                            padding: '0.45rem 0.65rem',
                            borderRadius: 'var(--radius-sm)',
                            backgroundColor: 'var(--status-closed-bg)',
                            color: 'var(--status-closed-text)',
                            marginBottom: '0.65rem',
                          }}
                        >
                          <strong>Reason:</strong> {item.rejection_or_revocation_reason}
                        </div>
                      )}

                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                        {isOwnRecord ? (
                          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                            Self-review disabled (anti-self-escalation policy)
                          </span>
                        ) : (
                          <>
                            {item.verification_status !== 'verified' && (
                              <Button
                                size="sm"
                                variant="primary"
                                onClick={() => openReviewDialog(item, 'verified')}
                              >
                                Approve & Verify
                              </Button>
                            )}
                            {item.verification_status === 'pending' && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openReviewDialog(item, 'rejected')}
                              >
                                Reject
                              </Button>
                            )}
                            {item.verification_status === 'verified' && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openReviewDialog(item, 'revoked')}
                              >
                                Revoke Official Status
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Immutable Audit Trail Section */}
      {canViewReports && (
        <Card
          title="Official Verification & Role Audit History"
          subtitle="Immutable database audit trail (never logs passwords, OTP codes, or tokens)"
        >
          {auditLogs.length === 0 ? (
            <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', margin: 0 }}>
              No verification or role audit events recorded yet.
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--color-border)', textAlign: 'left' }}>
                    <th style={{ padding: '0.65rem' }}>Timestamp</th>
                    <th style={{ padding: '0.65rem' }}>Action</th>
                    <th style={{ padding: '0.65rem' }}>Entity Type</th>
                    <th style={{ padding: '0.65rem' }}>Actor Role</th>
                    <th style={{ padding: '0.65rem' }}>Sanitized Details</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.slice(0, 15).map((log) => (
                    <tr key={log.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <td style={{ padding: '0.65rem', whiteSpace: 'nowrap' }}>
                        {new Date(log.created_at).toLocaleString()}
                      </td>
                      <td style={{ padding: '0.65rem', fontWeight: 600 }}>
                        <code>{log.action}</code>
                      </td>
                      <td style={{ padding: '0.65rem' }}>{log.entity_type}</td>
                      <td style={{ padding: '0.65rem', textTransform: 'capitalize' }}>
                        {log.actor_role || 'system'}
                      </td>
                      <td style={{ padding: '0.65rem', fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>
                        {JSON.stringify(log.details || {})}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* Review Decision Confirmation Dialog */}
      <ConfirmDialog
        isOpen={reviewModal.open}
        title={
          reviewModal.decision === 'verified'
            ? 'Approve & Verify Barangay Official'
            : reviewModal.decision === 'rejected'
              ? 'Reject Official Verification Request'
              : 'Revoke Barangay Official Credentials'
        }
        description={
          reviewModal.record
            ? `You are updating ${reviewModal.record.full_name} (${reviewModal.record.position}, ID ${reviewModal.record.id_number_masked}) to '${reviewModal.decision}'. This action immediately updates their profile authorization and records an immutable audit event.`
            : ''
        }
        confirmLabel={
          reviewModal.decision === 'verified'
            ? 'Confirm Official Verification'
            : reviewModal.decision === 'rejected'
              ? 'Confirm Rejection'
              : 'Confirm Revocation'
        }
        variant={reviewModal.decision === 'verified' ? 'primary' : 'danger'}
        loading={reviewModal.submitting}
        onCancel={() =>
          setReviewModal((prev) => ({
            ...prev,
            open: false,
            record: null,
          }))
        }
        onConfirm={handleConfirmReviewDecision}
      >
        <div className="form-group" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
          <label className="form-label" htmlFor="review-reason-input">
            {reviewModal.decision === 'verified'
              ? 'Verification Approval Note (Optional)'
              : 'Mandatory Reason for Rejection / Revocation *'}
          </label>
          <input
            id="review-reason-input"
            type="text"
            className="form-input"
            placeholder={
              reviewModal.decision === 'verified'
                ? 'e.g. Verified against DILG Barangay Timugan appointment roster'
                : 'e.g. End of term / Credential reference mismatch'
            }
            value={reviewModal.reasonOrNotes}
            onChange={(e) =>
              setReviewModal((prev) => ({ ...prev, reasonOrNotes: e.target.value }))
            }
            disabled={reviewModal.submitting}
          />
        </div>
      </ConfirmDialog>
    </div>
  )
}

export default OfficialPortalPage
