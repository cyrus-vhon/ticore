import { useState, useCallback } from 'react'
import Button from '../../components/common/Button.jsx'
import Card from '../../components/common/Card.jsx'
import Alert from '../../components/common/Alert.jsx'
import Badge from '../../components/common/Badge.jsx'
import ConfirmDialog from '../../components/common/ConfirmDialog.jsx'
import StepIndicator from '../../components/reservation/StepIndicator.jsx'
import RealtimeStatusPill from '../../components/common/RealtimeStatusPill.jsx'
import useAuth from '../../hooks/useAuth.js'
import { useRealtimeReservations } from '../../hooks/useRealtimeReservations.js'
import { useRealtimeClosures } from '../../hooks/useRealtimeClosures.js'
import {
  SINGLE_FACILITY_NAME,
  getLocalTodayDateString,
  formatTime12Hour,
  formatStructuredAddress,
  validateReservationInput,
  checkSlotAvailability,
  submitCourtReservation,
  calculateClientReservationFee,
} from '../../services/reservationService.js'

const START_TIME_OPTIONS = [
  '06:00', '07:00', '08:00', '09:00', '10:00', '11:00',
  '12:00', '13:00', '14:00', '15:00', '16:00', '17:00',
  '18:00', '19:00', '20:00', '21:00',
]

const END_TIME_OPTIONS = [
  '07:00', '08:00', '09:00', '10:00', '11:00', '12:00',
  '13:00', '14:00', '15:00', '16:00', '17:00', '18:00',
  '19:00', '20:00', '21:00', '22:00',
]

export function ReservationPage({
  navigateTo,
  preselectedSlot = null,
  onSelectReservationId,
}) {
  const todayStr = getLocalTodayDateString()
  const { user, profile, isAuthenticated, setIntendedRoute } = useAuth()

  const [currentStep, setCurrentStep] = useState(1)
  const [draftData, setDraftData] = useState({
    court: SINGLE_FACILITY_NAME,
    date: preselectedSlot?.date || todayStr,
    startTime: preselectedSlot?.startTime || '08:00',
    endTime: preselectedSlot?.endTime || '10:00',
    activityType: 'Basketball Practice / Friendly Match',
    purposeDescription: '',
    expectedAttendees: '15',
  })

  const [fieldErrors, setFieldErrors] = useState({})
  const [availabilityStatus, setAvailabilityStatus] = useState(null)
  const [checkingAvailability, setCheckingAvailability] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [submittedReservation, setSubmittedReservation] = useState(null)

  const formData = {
    ...draftData,
    fullName: draftData.fullName ?? profile?.full_name ?? '',
    mobileNumber: draftData.mobileNumber ?? profile?.mobile_number ?? '',
    residencyType: draftData.residencyType ?? profile?.residency_type ?? 'timugan_resident',
    isStudent: Boolean(draftData.isStudent ?? false),
    province: draftData.province ?? profile?.province ?? 'Laguna',
    city: draftData.city ?? profile?.city_municipality ?? 'Los Baños',
    barangay: draftData.barangay ?? profile?.barangay ?? 'Timugan',
    purok: draftData.purok ?? profile?.purok_street ?? '',
    houseDetails: draftData.houseDetails ?? profile?.house_lot_details ?? '',
  }

  const refreshSelectedSlotAvailability = useCallback(async () => {
    if (!draftData.date || !draftData.startTime || !draftData.endTime) return
    if (draftData.endTime <= draftData.startTime) return
    const result = await checkSlotAvailability({
      date: draftData.date,
      startTime: draftData.startTime,
      endTime: draftData.endTime,
    })
    setAvailabilityStatus(result)
  }, [draftData.date, draftData.endTime, draftData.startTime])

  const { connectionStatus: realtimeScheduleStatus, lastRealtimeUpdate } = useRealtimeReservations({
    scope: 'public_schedule',
    targetDate: formData.date,
    onScheduleRefreshNeeded: () => {
      refreshSelectedSlotAvailability()
    },
  })

  useRealtimeClosures({
    targetDate: formData.date,
    onClosureChange: () => {
      refreshSelectedSlotAvailability()
    },
  })

  const handleInputChange = (field, value) => {
    setDraftData((prev) => {
      const next = { ...prev, [field]: value }
      if (field === 'residencyType') {
        if (value === 'timugan_resident') {
          next.province = 'Laguna'
          next.city = 'Los Baños'
          next.barangay = 'Timugan'
        } else if (value === 'los_banos_resident') {
          next.province = 'Laguna'
          next.city = 'Los Baños'
        }
      }
      return next
    })

    if (field === 'date' || field === 'startTime' || field === 'endTime') {
      setAvailabilityStatus(null)
    }

    setFieldErrors((prev) => {
      if (!prev[field] && !prev.timeRange) return prev
      const copy = { ...prev }
      delete copy[field]
      delete copy.timeRange
      return copy
    })
  }

  const runAvailabilityCheck = async () => {
    setSubmitError('')
    const validation = validateReservationInput(formData, todayStr)
    const step1Errors = {}
    if (validation.errors.date) step1Errors.date = validation.errors.date
    if (validation.errors.startTime) step1Errors.startTime = validation.errors.startTime
    if (validation.errors.endTime) step1Errors.endTime = validation.errors.endTime
    if (validation.errors.timeRange) step1Errors.timeRange = validation.errors.timeRange

    if (Object.keys(step1Errors).length > 0) {
      setFieldErrors(step1Errors)
      setAvailabilityStatus({
        available: false,
        conflictType: 'validation',
        message: Object.values(step1Errors)[0],
      })
      return false
    }

    setCheckingAvailability(true)
    try {
      const result = await checkSlotAvailability({
        date: formData.date,
        startTime: formData.startTime,
        endTime: formData.endTime,
      })
      setAvailabilityStatus(result)
      return result.available
    } finally {
      setCheckingAvailability(false)
    }
  }

  const handleNextStep = async () => {
    setSubmitError('')
    const validation = validateReservationInput(formData, todayStr)

    if (currentStep === 1) {
      const available = await runAvailabilityCheck()
      if (!available) return
      setCurrentStep(2)
      window.scrollTo({ top: 120, behavior: 'smooth' })
      return
    }

    if (currentStep === 2) {
      const step2Keys = ['fullName', 'mobileNumber', 'residencyType', 'province', 'city', 'barangay', 'purok']
      const step2Errors = {}
      step2Keys.forEach((k) => {
        if (validation.errors[k]) step2Errors[k] = validation.errors[k]
      })
      if (Object.keys(step2Errors).length > 0) {
        setFieldErrors(step2Errors)
        return
      }
      setFieldErrors({})
      setCurrentStep(3)
      window.scrollTo({ top: 120, behavior: 'smooth' })
      return
    }

    if (currentStep === 3) {
      const step3Keys = ['activityType', 'purposeDescription', 'expectedAttendees']
      const step3Errors = {}
      step3Keys.forEach((k) => {
        if (validation.errors[k]) step3Errors[k] = validation.errors[k]
      })
      if (Object.keys(step3Errors).length > 0) {
        setFieldErrors(step3Errors)
        return
      }
      setFieldErrors({})
      setCurrentStep(4)
      window.scrollTo({ top: 120, behavior: 'smooth' })
    }
  }

  const handleBackStep = () => {
    setSubmitError('')
    if (currentStep > 1) {
      setCurrentStep((prev) => prev - 1)
      window.scrollTo({ top: 120, behavior: 'smooth' })
    }
  }

  const handleConfirmSubmission = async () => {
    if (!isAuthenticated || !user?.id) {
      setConfirmOpen(false)
      setIntendedRoute('reservation')
      navigateTo('login')
      return
    }

    setSubmitting(true)
    setSubmitError('')
    try {
      const result = await submitCourtReservation({
        userId: user.id,
        formData,
      })

      setConfirmOpen(false)

      if (!result.success) {
        setSubmitError(result.error)
        if (result.validationErrors) {
          setFieldErrors(result.validationErrors)
        }
        if (result.errorType === 'unavailable') {
          setAvailabilityStatus({
            available: false,
            conflictType: result.conflictType || 'conflict',
            message: result.error,
          })
          setCurrentStep(1)
        }
        window.scrollTo({ top: 100, behavior: 'smooth' })
        return
      }

      setSubmittedReservation(result.reservation)
      window.scrollTo({ top: 80, behavior: 'smooth' })
    } finally {
      setSubmitting(false)
    }
  }

  if (submittedReservation) {
    return (
      <div className="container" style={{ paddingTop: '2.5rem', maxWidth: '740px' }}>
        <Card
          title="Reservation Request Submitted"
          subtitle={`Facility: ${submittedReservation.facility_name}`}
          headerRight={<Badge status={submittedReservation.status} />}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <Alert type="success" title="Application Pending Barangay Official Review">
              Your court reservation for <strong>{submittedReservation.reservation_date}</strong> (
              {formatTime12Hour(submittedReservation.start_time)} – {formatTime12Hour(submittedReservation.end_time)}) has been recorded with initial status <strong>Pending Review</strong>.
            </Alert>

            <div
              style={{
                backgroundColor: 'var(--color-surface-muted)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                padding: '1.25rem',
                fontSize: '0.875rem',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                gap: '1rem',
              }}
            >
              <div>
                <strong style={{ color: 'var(--color-primary-dark)' }}>Reservation Reference:</strong>
                <p style={{ margin: '0.25rem 0 0', fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}>
                  {submittedReservation.id}
                </p>
              </div>
              <div>
                <strong style={{ color: 'var(--color-primary-dark)' }}>Schedule:</strong>
                <p style={{ margin: '0.25rem 0 0' }}>
                  {submittedReservation.reservation_date} • {formatTime12Hour(submittedReservation.start_time)} to {formatTime12Hour(submittedReservation.end_time)}
                </p>
              </div>
              <div>
                <strong style={{ color: 'var(--color-primary-dark)' }}>Applicant:</strong>
                <p style={{ margin: '0.25rem 0 0' }}>
                  {submittedReservation.applicant_name} ({submittedReservation.applicant_mobile})
                </p>
              </div>
              <div>
                <strong style={{ color: 'var(--color-primary-dark)' }}>Purpose:</strong>
                <p style={{ margin: '0.25rem 0 0' }}>
                  {submittedReservation.activity_type} — {submittedReservation.purpose}
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <Button
                variant="primary"
                onClick={() => {
                  if (onSelectReservationId) {
                    onSelectReservationId(submittedReservation.id)
                  }
                  window.location.hash = `#reservation-details?id=${submittedReservation.id}`
                  navigateTo('reservation-details')
                }}
              >
                View Reservation Details
              </Button>
              <Button variant="secondary" onClick={() => navigateTo('my-reservations')}>
                Go to My Reservations
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setSubmittedReservation(null)
                  setCurrentStep(1)
                  setAvailabilityStatus(null)
                }}
              >
                Submit Another Request
              </Button>
            </div>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="container" style={{ paddingTop: '2.5rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '2rem' }}>
        <div style={{ maxWidth: '720px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Civic Service • Single Barangay Facility
            </span>
            <RealtimeStatusPill status={realtimeScheduleStatus} lastEvent={lastRealtimeUpdate} />
          </div>
          <h1 style={{ margin: '0.5rem 0' }}>Court Reservation</h1>
          <p style={{ fontSize: '1.0625rem' }}>
            Reserve a schedule at <strong>{SINGLE_FACILITY_NAME}</strong>. Every submission is verified for live availability and court closures in real time.
          </p>
        </div>

        {isAuthenticated && (
          <Button variant="outline" onClick={() => navigateTo('my-reservations')}>
            View My Reservations
          </Button>
        )}
      </div>

      {/* Authentication Status Banner */}
      <div style={{ marginBottom: '2rem' }}>
        {isAuthenticated && profile ? (
          <Alert type="success" title="Authenticated Resident Session">
            Signed in as <strong>{profile.full_name}</strong> ({profile.role}). Your registered contact and structured residence details are pre-filled below.
          </Alert>
        ) : (
          <Alert type="warning" title="Authentication Required to Submit Reservation">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
              <span>
                You must be signed in to your Barangay Timugan account before submitting a reservation. Please sign in or create a resident account to proceed.
              </span>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    setIntendedRoute('reservation')
                    navigateTo('login')
                  }}
                >
                  Sign In
                </Button>
                <Button size="sm" variant="outline" onClick={() => navigateTo('register')}>
                  Register
                </Button>
              </div>
            </div>
          </Alert>
        )}
      </div>

      {submitError && (
        <div style={{ marginBottom: '1.5rem' }}>
          <Alert type="error" title="Reservation Submission Error">
            {submitError}
          </Alert>
        </div>
      )}

      {/* Step Indicator */}
      <StepIndicator currentStep={currentStep} />

      {/* Multi-step Form Content */}
      <div style={{ maxWidth: '800px', margin: '0 auto 4rem' }}>
        <Card>
          {/* STEP 1: Court & Schedule */}
          {currentStep === 1 && (
            <div>
              <h2 style={{ fontSize: '1.375rem', marginBottom: '0.5rem' }}>
                Step 1: Select Facility & Schedule
              </h2>
              <p style={{ fontSize: '0.875rem', marginBottom: '1.75rem' }}>
                Choose the reservation date and desired time block for <strong>{SINGLE_FACILITY_NAME}</strong>.
              </p>

              <div className="form-group">
                <label className="form-label" htmlFor="court-select">
                  Barangay Court Facility <span className="required" aria-hidden="true">*</span>
                </label>
                <input
                  id="court-select"
                  type="text"
                  readOnly
                  className="form-input"
                  style={{ backgroundColor: 'var(--color-surface-muted)', fontWeight: 600 }}
                  value={SINGLE_FACILITY_NAME}
                />
                <span className="form-hint">Situated adjacent to Barangay Hall, Timugan, Los Baños (Operating Hours: 06:00 AM – 10:00 PM).</span>
              </div>

              <div className="form-row form-row-3">
                <div className="form-group">
                  <label className="form-label" htmlFor="res-date">
                    Reservation Date <span className="required" aria-hidden="true">*</span>
                  </label>
                  <input
                    id="res-date"
                    type="date"
                    min={todayStr}
                    required
                    aria-invalid={Boolean(fieldErrors.date)}
                    className="form-input"
                    value={formData.date}
                    onChange={(e) => handleInputChange('date', e.target.value)}
                  />
                  {fieldErrors.date && <span className="form-error">{fieldErrors.date}</span>}
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="start-time">
                    Start Time <span className="required" aria-hidden="true">*</span>
                  </label>
                  <select
                    id="start-time"
                    className="form-select"
                    value={formData.startTime}
                    onChange={(e) => handleInputChange('startTime', e.target.value)}
                  >
                    {START_TIME_OPTIONS.map((t) => (
                      <option key={t} value={t}>
                        {formatTime12Hour(t)}
                      </option>
                    ))}
                  </select>
                  {fieldErrors.startTime && <span className="form-error">{fieldErrors.startTime}</span>}
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="end-time">
                    End Time <span className="required" aria-hidden="true">*</span>
                  </label>
                  <select
                    id="end-time"
                    className="form-select"
                    value={formData.endTime}
                    onChange={(e) => handleInputChange('endTime', e.target.value)}
                  >
                    {END_TIME_OPTIONS.map((t) => (
                      <option key={t} value={t}>
                        {formatTime12Hour(t)}
                      </option>
                    ))}
                  </select>
                  {fieldErrors.endTime && <span className="form-error">{fieldErrors.endTime}</span>}
                </div>
              </div>

              {fieldErrors.timeRange && (
                <div style={{ marginBottom: '1rem' }}>
                  <span className="form-error">{fieldErrors.timeRange}</span>
                </div>
              )}

              {/* Availability Check Feedback */}
              {availabilityStatus && (
                <div style={{ marginTop: '1rem', marginBottom: '1.25rem' }}>
                  <Alert
                    type={availabilityStatus.available ? 'success' : 'error'}
                    title={
                      availabilityStatus.available
                        ? 'Schedule Available'
                        : 'Selected Schedule Unavailable'
                    }
                  >
                    {availabilityStatus.message}
                  </Alert>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginTop: '2rem' }}>
                <Button
                  type="button"
                  variant="outline"
                  onClick={runAvailabilityCheck}
                  disabled={checkingAvailability}
                >
                  {checkingAvailability ? 'Checking Schedule...' : 'Check Schedule Availability'}
                </Button>

                <Button
                  type="button"
                  variant="primary"
                  onClick={handleNextStep}
                  disabled={checkingAvailability}
                >
                  {checkingAvailability ? 'Verifying...' : 'Continue to Applicant Details →'}
                </Button>
              </div>
            </div>
          )}

          {/* STEP 2: Applicant Information & Structured Address */}
          {currentStep === 2 && (
            <div>
              <h2 style={{ fontSize: '1.375rem', marginBottom: '0.5rem' }}>
                Step 2: Applicant Details & Structured Residence
              </h2>
              <p style={{ fontSize: '0.875rem', marginBottom: '1.75rem' }}>
                Verify your contact details and structured residence address. Applicants from Barangay Timugan, other Los Baños barangays, and outside Los Baños are all supported.
              </p>

              <div className="form-row form-row-2">
                <div className="form-group">
                  <label className="form-label" htmlFor="applicant-name">
                    Full Name <span className="required" aria-hidden="true">*</span>
                  </label>
                  <input
                    id="applicant-name"
                    type="text"
                    required
                    aria-invalid={Boolean(fieldErrors.fullName)}
                    className="form-input"
                    placeholder="e.g. Juan C. Dela Cruz"
                    value={formData.fullName}
                    onChange={(e) => handleInputChange('fullName', e.target.value)}
                  />
                  {fieldErrors.fullName && <span className="form-error">{fieldErrors.fullName}</span>}
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="mobile-number">
                    Mobile Number (PH) <span className="required" aria-hidden="true">*</span>
                  </label>
                  <input
                    id="mobile-number"
                    type="tel"
                    inputMode="tel"
                    required
                    aria-invalid={Boolean(fieldErrors.mobileNumber)}
                    className="form-input"
                    placeholder="e.g. 0917 123 4567"
                    value={formData.mobileNumber}
                    onChange={(e) => handleInputChange('mobileNumber', e.target.value)}
                  />
                  {fieldErrors.mobileNumber ? (
                    <span className="form-error">{fieldErrors.mobileNumber}</span>
                  ) : (
                    <span className="form-hint">11-digit PH mobile number (09XXXXXXXXX).</span>
                  )}
                </div>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="residency-type">
                  Residency Classification <span className="required" aria-hidden="true">*</span>
                </label>
                <select
                  id="residency-type"
                  className="form-select"
                  value={formData.residencyType}
                  onChange={(e) => handleInputChange('residencyType', e.target.value)}
                >
                  <option value="timugan_resident">Timugan Resident (₱200/hr)</option>
                  <option value="los_banos_resident">Other Los Baños Resident (₱300/hr)</option>
                  <option value="non_resident">Outside Los Baños / Visitor (₱300/hr)</option>
                </select>
              </div>

              <div className="form-group" style={{ marginTop: '0.75rem' }}>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '0.65rem',
                    cursor: 'pointer',
                    fontSize: '0.875rem',
                    fontWeight: 500,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={Boolean(formData.isStudent)}
                    onChange={(e) => handleInputChange('isStudent', e.target.checked)}
                    style={{ marginTop: '0.2rem' }}
                  />
                  <span>
                    <strong>Applicant is a student</strong> (Student Rate: ₱150/hour).
                    <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.15rem' }}>
                      Valid Student ID must be presented upon cash payment at the Barangay Office.
                    </span>
                  </span>
                </label>
              </div>

              {/* Structured Address */}
              <div
                style={{
                  backgroundColor: 'var(--color-surface-muted)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '1.25rem',
                  marginTop: '1.25rem',
                }}
              >
                <h4 style={{ fontSize: '0.9375rem', marginBottom: '1rem', color: 'var(--color-primary-dark)' }}>
                  Structured Residence Address
                </h4>

                <div className="form-row form-row-3">
                  <div className="form-group">
                    <label className="form-label" htmlFor="address-province">
                      Province <span className="required" aria-hidden="true">*</span>
                    </label>
                    <input
                      id="address-province"
                      type="text"
                      required
                      aria-invalid={Boolean(fieldErrors.province)}
                      className="form-input"
                      value={formData.province}
                      onChange={(e) => handleInputChange('province', e.target.value)}
                    />
                    {fieldErrors.province && <span className="form-error">{fieldErrors.province}</span>}
                  </div>

                  <div className="form-group">
                    <label className="form-label" htmlFor="address-city">
                      Municipality / City <span className="required" aria-hidden="true">*</span>
                    </label>
                    <input
                      id="address-city"
                      type="text"
                      required
                      aria-invalid={Boolean(fieldErrors.city)}
                      className="form-input"
                      value={formData.city}
                      onChange={(e) => handleInputChange('city', e.target.value)}
                    />
                    {fieldErrors.city && <span className="form-error">{fieldErrors.city}</span>}
                  </div>

                  <div className="form-group">
                    <label className="form-label" htmlFor="address-barangay">
                      Barangay <span className="required" aria-hidden="true">*</span>
                    </label>
                    <input
                      id="address-barangay"
                      type="text"
                      required
                      aria-invalid={Boolean(fieldErrors.barangay)}
                      className="form-input"
                      value={formData.barangay}
                      onChange={(e) => handleInputChange('barangay', e.target.value)}
                    />
                    {fieldErrors.barangay && <span className="form-error">{fieldErrors.barangay}</span>}
                  </div>
                </div>

                <div className="form-row form-row-2">
                  <div className="form-group">
                    <label className="form-label" htmlFor="address-purok">
                      Street / Purok / Zone <span className="required" aria-hidden="true">*</span>
                    </label>
                    <input
                      id="address-purok"
                      type="text"
                      required
                      aria-invalid={Boolean(fieldErrors.purok)}
                      className="form-input"
                      placeholder="e.g. Purok 2, Rizal St."
                      value={formData.purok}
                      onChange={(e) => handleInputChange('purok', e.target.value)}
                    />
                    {fieldErrors.purok && <span className="form-error">{fieldErrors.purok}</span>}
                  </div>

                  <div className="form-group">
                    <label className="form-label" htmlFor="address-house">
                      House / Lot Information
                    </label>
                    <input
                      id="address-house"
                      type="text"
                      className="form-input"
                      placeholder="e.g. Block 4, Lot 12"
                      value={formData.houseDetails}
                      onChange={(e) => handleInputChange('houseDetails', e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '2rem' }}>
                <Button variant="outline" onClick={handleBackStep}>
                  ← Back
                </Button>
                <Button variant="primary" onClick={handleNextStep}>
                  Continue to Purpose & Info →
                </Button>
              </div>
            </div>
          )}

          {/* STEP 3: Purpose & Requirements */}
          {currentStep === 3 && (
            <div>
              <h2 style={{ fontSize: '1.375rem', marginBottom: '0.5rem' }}>
                Step 3: Purpose & Event Details
              </h2>
              <p style={{ fontSize: '0.875rem', marginBottom: '1.75rem' }}>
                Describe your activity at <strong>{SINGLE_FACILITY_NAME}</strong>.
              </p>

              <div className="form-group">
                <label className="form-label" htmlFor="activity-type">
                  Activity Type <span className="required" aria-hidden="true">*</span>
                </label>
                <select
                  id="activity-type"
                  className="form-select"
                  value={formData.activityType}
                  onChange={(e) => handleInputChange('activityType', e.target.value)}
                >
                  <option value="Basketball Practice / Friendly Match">Basketball Practice / Friendly Match</option>
                  <option value="Volleyball Practice / Match">Volleyball Practice / Match</option>
                  <option value="Badminton Session">Badminton Session</option>
                  <option value="Youth Sports Clinic / Training">Youth Sports Clinic / Training</option>
                  <option value="Community Assembly / Purok Meeting">Community Assembly / Purok Meeting</option>
                  <option value="School / Organization Tournament">School / Organization Tournament</option>
                  <option value="Other Recreational Activity">Other Recreational Activity</option>
                </select>
                {fieldErrors.activityType && <span className="form-error">{fieldErrors.activityType}</span>}
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="expected-attendees">
                  Estimated Number of Players & Attendees <span className="required" aria-hidden="true">*</span>
                </label>
                <input
                  id="expected-attendees"
                  type="number"
                  min="1"
                  max="500"
                  required
                  aria-invalid={Boolean(fieldErrors.expectedAttendees)}
                  className="form-input"
                  placeholder="e.g. 15"
                  value={formData.expectedAttendees}
                  onChange={(e) => handleInputChange('expectedAttendees', e.target.value)}
                />
                {fieldErrors.expectedAttendees && (
                  <span className="form-error">{fieldErrors.expectedAttendees}</span>
                )}
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="purpose-desc">
                  Purpose Details & Activity Description <span className="required" aria-hidden="true">*</span>
                </label>
                <textarea
                  id="purpose-desc"
                  required
                  aria-invalid={Boolean(fieldErrors.purposeDescription)}
                  className="form-textarea"
                  placeholder="Provide specific details about your team or event (e.g. Purok 3 Youth Basketball Practice)"
                  value={formData.purposeDescription}
                  onChange={(e) => handleInputChange('purposeDescription', e.target.value)}
                ></textarea>
                {fieldErrors.purposeDescription && (
                  <span className="form-error">{fieldErrors.purposeDescription}</span>
                )}
              </div>

              {/* Privacy Transparency Notice */}
              <div
                style={{
                  padding: '1rem',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: '#f8fafc',
                  border: '1px solid var(--color-border)',
                  fontSize: '0.8125rem',
                  color: 'var(--color-text-secondary)',
                  marginTop: '1.5rem',
                }}
              >
                <strong>Privacy Notice:</strong> Your name, mobile number, structured address, and reservation purpose are protected by Row Level Security (RLS) and are visible only to you and authorized Barangay Timugan officials. They are never displayed on the public calendar.
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '2rem' }}>
                <Button variant="outline" onClick={handleBackStep}>
                  ← Back
                </Button>
                <Button variant="primary" onClick={handleNextStep}>
                  Review Summary →
                </Button>
              </div>
            </div>
          )}

          {/* STEP 4: Review & Confirmation */}
          {currentStep === 4 && (
            <div>
              <h2 style={{ fontSize: '1.375rem', marginBottom: '0.5rem' }}>
                Step 4: Review & Submit Reservation
              </h2>
              <p style={{ fontSize: '0.875rem', marginBottom: '1.75rem' }}>
                Please review your reservation summary carefully before submitting to Barangay Timugan.
              </p>

              <div
                style={{
                  backgroundColor: 'var(--color-surface-muted)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-border)',
                  padding: '1.25rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '1rem',
                  fontSize: '0.875rem',
                  marginBottom: '1.5rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div>
                    <strong style={{ color: 'var(--color-primary-dark)' }}>Facility & Schedule:</strong>
                    <p style={{ margin: '0.25rem 0 0' }}>{SINGLE_FACILITY_NAME}</p>
                    <p style={{ margin: '0.25rem 0 0', fontWeight: 600 }}>
                      {formData.date} ({formatTime12Hour(formData.startTime)} to {formatTime12Hour(formData.endTime)})
                    </p>
                  </div>
                  <Badge status="pending">Initial Status: Pending Review</Badge>
                </div>

                <div>
                  <strong style={{ color: 'var(--color-primary-dark)' }}>Applicant:</strong>
                  <p style={{ margin: '0.25rem 0 0' }}>
                    {formData.fullName} ({formData.mobileNumber})
                  </p>
                  <p style={{ margin: '0.25rem 0 0', color: 'var(--color-text-muted)' }}>
                    Classification:{' '}
                    {formData.residencyType === 'timugan_resident'
                      ? 'Timugan Resident'
                      : formData.residencyType === 'los_banos_resident'
                        ? 'Other Los Baños Resident'
                        : 'Outside Los Baños / Visitor'}
                  </p>
                </div>

                <div>
                  <strong style={{ color: 'var(--color-primary-dark)' }}>Structured Address:</strong>
                  <p style={{ margin: '0.25rem 0 0' }}>
                    {formatStructuredAddress({
                      houseDetails: formData.houseDetails,
                      purok: formData.purok,
                      barangay: formData.barangay,
                      city: formData.city,
                      province: formData.province,
                    })}
                  </p>
                </div>

                <div>
                  <strong style={{ color: 'var(--color-primary-dark)' }}>Activity & Purpose:</strong>
                  <p style={{ margin: '0.25rem 0 0' }}>{formData.activityType}</p>
                  {formData.expectedAttendees && (
                    <p style={{ margin: '0.25rem 0 0' }}>Expected attendees: {formData.expectedAttendees}</p>
                  )}
                  <p style={{ margin: '0.25rem 0 0', fontStyle: 'italic' }}>
                    &quot;{formData.purposeDescription}&quot;
                  </p>
                </div>

                {(() => {
                  const fee = calculateClientReservationFee({
                    isStudent: formData.isStudent,
                    residencyType: formData.residencyType,
                    startTime: formData.startTime,
                    endTime: formData.endTime,
                  })
                  return (
                    <div
                      style={{
                        backgroundColor: 'var(--color-surface)',
                        padding: '1rem',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--color-border)',
                      }}
                    >
                      <strong style={{ color: 'var(--color-primary-dark)' }}>Court Rental Fee:</strong>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginTop: '0.35rem',
                          flexWrap: 'wrap',
                          gap: '0.5rem',
                        }}
                      >
                        <span style={{ fontSize: '0.875rem' }}>
                          {fee.rateCategory === 'student'
                            ? 'Student Rate (₱150/hr)'
                            : fee.rateCategory === 'timugan_resident'
                              ? 'Timugan Resident (₱200/hr)'
                              : 'Outside Brgy. Timugan (₱300/hr)'}
                          {' • '}{fee.durationHours} hr(s)
                        </span>
                        <span style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--color-primary-dark)' }}>
                          ₱{fee.totalAmount.toFixed(2)}
                        </span>
                      </div>
                      <p style={{ margin: '0.35rem 0 0', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                        Payment method is CASH ONLY at the Barangay Office upon official approval. Final amount is calculated and verified server-side.
                      </p>
                    </div>
                  )
                })()}
              </div>

              <div style={{ marginBottom: '1.5rem' }}>
                <Alert type="info" title="Official Review Required">
                  Submitting a reservation does not automatically mean it is approved. Authorized Barangay Timugan officials review each request before confirming your schedule.
                </Alert>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem', marginTop: '2rem' }}>
                <Button variant="outline" onClick={handleBackStep} disabled={submitting}>
                  ← Back to Purpose
                </Button>

                {isAuthenticated ? (
                  <Button
                    variant="primary"
                    loading={submitting}
                    onClick={() => setConfirmOpen(true)}
                  >
                    Submit Reservation Request
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    onClick={() => {
                      setIntendedRoute('reservation')
                      navigateTo('login')
                    }}
                  >
                    Sign In to Submit Reservation
                  </Button>
                )}
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Confirmation Dialog */}
      <ConfirmDialog
        open={confirmOpen}
        title="Submit Court Reservation?"
        description={`Confirm your reservation request for ${SINGLE_FACILITY_NAME} on ${formData.date} from ${formatTime12Hour(formData.startTime)} to ${formatTime12Hour(formData.endTime)}.`}
        confirmLabel="Confirm & Submit"
        cancelLabel="Review Again"
        variant="primary"
        loading={submitting}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={handleConfirmSubmission}
      >
        <p style={{ fontSize: '0.875rem', margin: 0 }}>
          Your application will be submitted with status <strong>Pending Review</strong>. The time slot will be held while Barangay Timugan officials review your request.
        </p>
      </ConfirmDialog>
    </div>
  )
}

export default ReservationPage
