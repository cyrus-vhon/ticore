import { useState, useEffect, useCallback } from 'react'
import Button from '../../components/common/Button.jsx'
import Card from '../../components/common/Card.jsx'
import Badge from '../../components/common/Badge.jsx'
import Alert from '../../components/common/Alert.jsx'
import ConfirmDialog from '../../components/common/ConfirmDialog.jsx'
import RealtimeStatusPill from '../../components/common/RealtimeStatusPill.jsx'
import useAuth from '../../hooks/useAuth.js'
import { useRealtimeReservations } from '../../hooks/useRealtimeReservations.js'
import {
  fetchOwnReservationDetails,
  cancelOwnReservation,
  canResidentCancelReservation,
  formatTime12Hour,
} from '../../services/reservationService.js'

function getReservationIdFromUrlOrProp(propId) {
  if (propId) return propId
  if (typeof window !== 'undefined') {
    const searchParams = new URLSearchParams(window.location.search || '')
    const idFromSearch = searchParams.get('id')
    if (idFromSearch) return idFromSearch

    const hash = window.location.hash || ''
    const queryIndex = hash.indexOf('?')
    if (queryIndex !== -1) {
      const hashParams = new URLSearchParams(hash.slice(queryIndex + 1))
      const idFromHash = hashParams.get('id')
      if (idFromHash) return idFromHash
    }
  }
  return ''
}

export function ReservationDetailsPage({ navigateTo, selectedReservationId }) {
  const { user } = useAuth()

  const [reservationId, setReservationId] = useState(() =>
    getReservationIdFromUrlOrProp(selectedReservationId)
  )
  const [reservation, setReservation] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notFoundOrUnauthorized, setNotFoundOrUnauthorized] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [statusNotice, setStatusNotice] = useState(null)

  const [cancelModalOpen, setCancelModalOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelling, setCancelling] = useState(false)

  useEffect(() => {
    const syncId = () => {
      const nextId = getReservationIdFromUrlOrProp(selectedReservationId)
      setReservationId(nextId)
    }
    syncId()
    window.addEventListener('hashchange', syncId)
    window.addEventListener('popstate', syncId)
    return () => {
      window.removeEventListener('hashchange', syncId)
      window.removeEventListener('popstate', syncId)
    }
  }, [selectedReservationId])

  const reloadReservationQuietly = useCallback(async () => {
    if (!user?.id || !reservationId) return
    const result = await fetchOwnReservationDetails(reservationId, user.id)
    if (!result.notFoundOrUnauthorized && !result.error && result.reservation) {
      setReservation(result.reservation)
    }
  }, [reservationId, user])

  const { connectionStatus, lastRealtimeUpdate } = useRealtimeReservations({
    scope: 'resident',
    userId: user?.id,
    reservationId,
    enabled: Boolean(user?.id && reservationId),
    onReservationPayload: (safeReservation) => {
      setReservation((prev) => (prev ? { ...prev, ...safeReservation } : safeReservation))
      setStatusNotice({
        type: 'info',
        title: 'Realtime Status Update',
        message: `This reservation status was updated to "${String(safeReservation.status || '').replace('_', '-').toUpperCase()}".`,
      })
    },
    onScheduleRefreshNeeded: () => {
      reloadReservationQuietly()
    },
  })

  useEffect(() => {
    if (!user?.id) return
    let active = true
    Promise.resolve().then(async () => {
      if (!active) return
      if (!reservationId) {
        setNotFoundOrUnauthorized(true)
        setLoading(false)
        return
      }
      const result = await fetchOwnReservationDetails(reservationId, user.id)
      if (!active) return
      if (result.notFoundOrUnauthorized) {
        setReservation(null)
        setNotFoundOrUnauthorized(true)
      } else if (result.error) {
        setErrorMsg(result.error)
      } else {
        setErrorMsg('')
        setNotFoundOrUnauthorized(false)
        setReservation(result.reservation)
      }
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [reservationId, user])

  const handleConfirmCancel = async () => {
    if (!reservation || !user?.id) return
    setCancelling(true)
    setStatusNotice(null)

    try {
      const result = await cancelOwnReservation({
        reservationId: reservation.id,
        userId: user.id,
        reason: cancelReason,
      })

      setCancelModalOpen(false)

      if (!result.success) {
        setStatusNotice({
          type: 'error',
          title: 'Unable to Cancel Reservation',
          message: result.error,
        })
        return
      }

      setReservation(result.reservation)
      setStatusNotice({
        type: 'success',
        title: 'Reservation Cancelled',
        message: 'Your reservation has been cancelled and the time slot has been released.',
      })
    } finally {
      setCancelling(false)
    }
  }

  if (loading) {
    return (
      <div className="container" style={{ paddingTop: '2.5rem', maxWidth: '720px' }}>
        <Card title="Loading Reservation Details">
          <p style={{ fontSize: '0.9375rem', margin: 0 }}>
            Verifying ownership and loading reservation details...
          </p>
        </Card>
      </div>
    )
  }

  if (notFoundOrUnauthorized) {
    return (
      <div className="container" style={{ paddingTop: '2.5rem', maxWidth: '680px' }}>
        <Card
          title="Reservation Unavailable or Access Restricted"
          subtitle="IDOR & Ownership Security Protection"
          headerRight={<Badge status="reserved">Protected</Badge>}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <Alert type="error" title="Cannot Access Requested Reservation">
              The requested reservation record could not be found under your account, or you do not have permission to view it. Residents may only access their own reservation records.
            </Alert>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <Button variant="primary" onClick={() => navigateTo('my-reservations')}>
                Back to My Reservations
              </Button>
              <Button variant="outline" onClick={() => navigateTo('calendar')}>
                View Public Calendar
              </Button>
            </div>
          </div>
        </Card>
      </div>
    )
  }

  const cancellable = canResidentCancelReservation(reservation)

  return (
    <div className="container" style={{ paddingTop: '2.5rem', maxWidth: '780px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
          marginBottom: '1.75rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <Button variant="outline" size="sm" onClick={() => navigateTo('my-reservations')}>
            ← Back to My Reservations
          </Button>
          <RealtimeStatusPill status={connectionStatus} lastEvent={lastRealtimeUpdate} />
        </div>

        {cancellable && (
          <Button
            variant="outline"
            size="sm"
            style={{ color: '#991b1b', borderColor: '#fca5a5' }}
            onClick={() => {
              setCancelReason('')
              setCancelModalOpen(true)
            }}
          >
            Cancel This Reservation
          </Button>
        )}
      </div>

      {statusNotice && (
        <div style={{ marginBottom: '1.5rem' }}>
          <Alert type={statusNotice.type} title={statusNotice.title}>
            {statusNotice.message}
          </Alert>
        </div>
      )}

      {errorMsg && (
        <div style={{ marginBottom: '1.5rem' }}>
          <Alert type="error" title="Error Loading Reservation">
            {errorMsg}
          </Alert>
        </div>
      )}

      {reservation && (
        <Card
          title={`Reservation Details • ${reservation.reservation_date}`}
          subtitle={`${reservation.facility_name} (${formatTime12Hour(reservation.start_time)} – ${formatTime12Hour(reservation.end_time)})`}
          headerRight={
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <Badge status={reservation.status} />
              <Badge status={reservation.payment_status || 'pending_payment'} />
            </div>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                gap: '1.25rem',
                backgroundColor: 'var(--color-surface-muted)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                padding: '1.25rem',
                fontSize: '0.875rem',
              }}
            >
              <div>
                <strong style={{ color: 'var(--color-primary-dark)' }}>Reference ID:</strong>
                <p style={{ margin: '0.25rem 0 0', fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', wordBreak: 'break-all' }}>
                  {reservation.id}
                </p>
              </div>

              <div>
                <strong style={{ color: 'var(--color-primary-dark)' }}>Current Status:</strong>
                <p style={{ margin: '0.25rem 0 0', textTransform: 'capitalize', fontWeight: 600 }}>
                  {reservation.status.replace('_', '-')}
                </p>
                {reservation.status_reason && (
                  <p style={{ margin: '0.25rem 0 0', fontSize: '0.8125rem' }}>
                    Reason / Note: {reservation.status_reason}
                  </p>
                )}
              </div>

              <div>
                <strong style={{ color: 'var(--color-primary-dark)' }}>Date & Time Slot:</strong>
                <p style={{ margin: '0.25rem 0 0' }}>
                  {reservation.reservation_date}
                </p>
                <p style={{ margin: '0.15rem 0 0', fontWeight: 600 }}>
                  {formatTime12Hour(reservation.start_time)} to {formatTime12Hour(reservation.end_time)}
                </p>
              </div>

              <div>
                <strong style={{ color: 'var(--color-primary-dark)' }}>Submitted Timestamp:</strong>
                <p style={{ margin: '0.25rem 0 0' }}>
                  {new Date(reservation.created_at).toLocaleString('en-PH')}
                </p>
              </div>
            </div>

            {/* Court Rental Fee Breakdown */}
            <div
              style={{
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border)',
                backgroundColor: 'var(--color-surface-muted)',
                padding: '1.25rem',
                fontSize: '0.875rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                <strong style={{ fontSize: '0.9375rem', color: 'var(--color-primary-dark)' }}>
                  Court Rental Fee Breakdown
                </strong>
                <span
                  style={{
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    padding: '0.2rem 0.55rem',
                    borderRadius: 'var(--radius-full)',
                    backgroundColor: 'rgba(30, 58, 138, 0.08)',
                    color: 'var(--color-primary)',
                  }}
                >
                  {reservation.rate_category === 'student'
                    ? 'Student Rate (₱150/hr)'
                    : reservation.rate_category === 'timugan_resident'
                      ? 'Timugan Resident (₱200/hr)'
                      : 'Outside Brgy. Timugan (₱300/hr)'}
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
                <div>
                  <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8125rem' }}>Rate Category</span>
                  <p style={{ margin: '0.2rem 0 0', fontWeight: 600 }}>
                    {reservation.rate_category === 'student'
                      ? 'Student'
                      : reservation.rate_category === 'timugan_resident'
                        ? 'Timugan Resident'
                        : 'Outside Brgy. Timugan'}
                    {reservation.is_student ? ' (Verified Student)' : ''}
                  </p>
                </div>
                <div>
                  <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8125rem' }}>Hourly Rate</span>
                  <p style={{ margin: '0.2rem 0 0', fontWeight: 600 }}>
                    ₱{Number(reservation.hourly_rate || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })} / hour
                  </p>
                </div>
                <div>
                  <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8125rem' }}>Total Computed Fee</span>
                  <p style={{ margin: '0.2rem 0 0', fontWeight: 700, fontSize: '1.125rem', color: 'var(--color-primary-dark)' }}>
                    ₱{Number(reservation.total_amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </div>
              </div>
            </div>

            {/* Payment Status & Instructions */}
            <div
              style={{
                borderRadius: 'var(--radius-md)',
                border: reservation.payment_status === 'paid' ? '1px solid #a7f3d0' : '1px solid #fde68a',
                backgroundColor: reservation.payment_status === 'paid' ? '#ecfdf5' : '#fffbeb',
                padding: '1.25rem',
                fontSize: '0.875rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <strong style={{ color: reservation.payment_status === 'paid' ? '#065f46' : '#92400e', fontSize: '0.9375rem' }}>
                    Payment Information
                  </strong>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                    (Method: Cash Only)
                  </span>
                </div>
                <Badge status={reservation.payment_status || 'pending_payment'} />
              </div>

              {reservation.payment_status === 'paid' ? (
                <div>
                  <p style={{ margin: '0 0 0.25rem', color: '#065f46', fontWeight: 600 }}>
                    Payment Confirmed (CASH)
                  </p>
                  <p style={{ margin: 0, fontSize: '0.8125rem', color: '#047857' }}>
                    Your cash payment has been verified and confirmed at the Barangay Office on{' '}
                    {reservation.paid_at ? new Date(reservation.paid_at).toLocaleString('en-PH') : 'file'}.
                  </p>
                </div>
              ) : (
                <div>
                  {reservation.status === 'cancelled' ? (
                    <p style={{ margin: 0, color: '#991b1b' }}>
                      This reservation is cancelled. Any unpaid payment requirement has expired.
                    </p>
                  ) : reservation.status === 'pending' ? (
                    <div>
                      <p style={{ margin: 0, fontWeight: 500, color: '#92400e' }}>
                        Reservation is currently pending official review.
                      </p>
                      <p style={{ margin: '0.35rem 0 0', fontSize: '0.8125rem', color: '#78350f' }}>
                        When an official approves your reservation, your cash payment deadline will start (up to 48 hours or before reservation start time, whichever comes first). Payment must be made in cash at the Barangay Office.
                      </p>
                    </div>
                  ) : (
                    <div>
                      {reservation.payment_due_at && (
                        <div style={{ marginBottom: '0.5rem', color: '#92400e' }}>
                          <strong>Payment Deadline: </strong>
                          <span style={{ fontWeight: 600 }}>
                            {new Date(reservation.payment_due_at).toLocaleString('en-PH', {
                              dateStyle: 'medium',
                              timeStyle: 'short',
                            })}
                          </span>
                        </div>
                      )}
                      <p style={{ margin: 0, fontWeight: 500, color: '#92400e' }}>
                        Please pay in cash at the Barangay Office before the payment deadline.
                      </p>
                      <p style={{ margin: '0.35rem 0 0', fontSize: '0.8125rem', color: '#78350f' }}>
                        Unpaid reservations are automatically cancelled when the deadline expires so that court slots can be released for other residents.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                gap: '1.5rem',
                fontSize: '0.875rem',
              }}
            >
              <div>
                <h4 style={{ fontSize: '0.9375rem', marginBottom: '0.5rem', color: 'var(--color-primary-dark)' }}>
                  Applicant & Residence Details
                </h4>
                <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.4rem 0.75rem' }}>
                  <dt style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>Full Name:</dt>
                  <dd style={{ margin: 0 }}>{reservation.applicant_name}</dd>

                  <dt style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>Mobile:</dt>
                  <dd style={{ margin: 0 }}>{reservation.applicant_mobile}</dd>

                  <dt style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>Classification:</dt>
                  <dd style={{ margin: 0 }}>{reservation.residency_type.replace(/_/g, ' ')}</dd>

                  <dt style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>Address:</dt>
                  <dd style={{ margin: 0 }}>{reservation.address}</dd>
                </dl>
              </div>

              <div>
                <h4 style={{ fontSize: '0.9375rem', marginBottom: '0.5rem', color: 'var(--color-primary-dark)' }}>
                  Activity & Purpose
                </h4>
                <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.4rem 0.75rem' }}>
                  <dt style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>Activity:</dt>
                  <dd style={{ margin: 0 }}>{reservation.activity_type}</dd>

                  <dt style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>Attendees:</dt>
                  <dd style={{ margin: 0 }}>{reservation.expected_attendees || '—'}</dd>

                  <dt style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>Purpose:</dt>
                  <dd style={{ margin: 0 }}>{reservation.purpose}</dd>
                </dl>
              </div>
            </div>
          </div>
        </Card>
      )}

      <ConfirmDialog
        open={cancelModalOpen}
        title="Cancel This Reservation?"
        description="Once cancelled, your reservation status will change to Cancelled and the time slot at Timugan Main Covered Court will become available to other residents."
        confirmLabel="Confirm Cancellation"
        cancelLabel="Keep Reservation"
        variant="primary"
        loading={cancelling}
        onCancel={() => setCancelModalOpen(false)}
        onConfirm={handleConfirmCancel}
      >
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label" htmlFor="detail-cancel-reason">
            Cancellation Reason (Optional)
          </label>
          <input
            id="detail-cancel-reason"
            type="text"
            className="form-input"
            placeholder="e.g. Change of team schedule"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            disabled={cancelling}
          />
        </div>
      </ConfirmDialog>
    </div>
  )
}

export default ReservationDetailsPage
