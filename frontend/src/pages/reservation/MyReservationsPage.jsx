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
  fetchMyReservations,
  cancelOwnReservation,
  canResidentCancelReservation,
  formatTime12Hour,
} from '../../services/reservationService.js'

export function MyReservationsPage({ navigateTo, onSelectReservationId }) {
  const { user } = useAuth()

  const [reservations, setReservations] = useState([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [feedbackNotice, setFeedbackNotice] = useState(null)

  const [cancelTarget, setCancelTarget] = useState(null)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelling, setCancelling] = useState(false)

  const loadMyReservations = useCallback(async ({ silent = false } = {}) => {
    if (!user?.id) return
    if (!silent) {
      setLoading(true)
    }
    setErrorMsg('')
    try {
      const { reservations: data, error } = await fetchMyReservations(user.id)
      if (error) {
        if (!silent) {
          setErrorMsg('Unable to load your reservation history right now. Please try again.')
        }
      } else {
        setReservations(data)
      }
    } finally {
      if (!silent) {
        setLoading(false)
      }
    }
  }, [user])

  const { connectionStatus, lastRealtimeUpdate } = useRealtimeReservations({
    scope: 'resident',
    userId: user?.id,
    enabled: Boolean(user?.id),
    onReservationPayload: (safeReservation) => {
      setReservations((prev) => {
        const exists = prev.some((item) => item.id === safeReservation.id)
        if (!exists) {
          return [safeReservation, ...prev]
        }
        return prev.map((item) => (item.id === safeReservation.id ? { ...item, ...safeReservation } : item))
      })
      setFeedbackNotice({
        type: 'info',
        title: 'Live Reservation Update',
        message: `Reservation for ${safeReservation.reservation_date} (${formatTime12Hour(safeReservation.start_time)} – ${formatTime12Hour(safeReservation.end_time)}) is now "${String(safeReservation.status || '').replace('_', '-').toUpperCase()}".`,
      })
    },
    onScheduleRefreshNeeded: () => {
      loadMyReservations({ silent: true })
    },
  })

  useEffect(() => {
    if (!user?.id) return
    let active = true
    fetchMyReservations(user.id).then(({ reservations: data, error }) => {
      if (!active) return
      if (error) {
        setErrorMsg('Unable to load your reservation history right now. Please try again.')
      } else {
        setErrorMsg('')
        setReservations(data)
      }
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [user])

  const handleOpenDetails = (reservationId) => {
    if (onSelectReservationId) {
      onSelectReservationId(reservationId)
    }
    navigateTo('reservation-details', `id=${reservationId}`)
  }

  const handleConfirmCancel = async () => {
    if (!cancelTarget || !user?.id) return
    setCancelling(true)
    setFeedbackNotice(null)

    try {
      const result = await cancelOwnReservation({
        reservationId: cancelTarget.id,
        userId: user.id,
        reason: cancelReason,
      })

      if (!result.success) {
        setFeedbackNotice({
          type: 'error',
          title: 'Cancellation Failed',
          message: result.error,
        })
        setCancelTarget(null)
        return
      }

      setReservations((prev) =>
        prev.map((item) => (item.id === cancelTarget.id ? result.reservation : item))
      )
      setFeedbackNotice({
        type: 'success',
        title: 'Reservation Cancelled',
        message: `Your reservation for ${cancelTarget.reservation_date} (${formatTime12Hour(cancelTarget.start_time)} – ${formatTime12Hour(cancelTarget.end_time)}) has been cancelled.`,
      })
      setCancelTarget(null)
      setCancelReason('')
    } finally {
      setCancelling(false)
    }
  }

  const filteredReservations = reservations.filter((item) => {
    if (statusFilter === 'all') return true
    if (statusFilter === 'active') return ['pending', 'approved'].includes(item.status)
    return item.status === statusFilter
  })

  return (
    <div className="container" style={{ paddingTop: '2.5rem' }}>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <span
              style={{
                fontSize: '0.8125rem',
                fontWeight: 700,
                color: 'var(--color-primary)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              Resident Portal
            </span>
            <RealtimeStatusPill status={connectionStatus} lastEvent={lastRealtimeUpdate} />
          </div>
          <h1 style={{ margin: '0.35rem 0 0.5rem', fontSize: '2rem' }}>My Court Reservations</h1>
          <p style={{ fontSize: '0.9375rem', maxWidth: '640px' }}>
            View the status, schedule, and history of your submitted reservation requests for Timugan Main Covered Court. Status changes from Barangay Officials appear automatically in real time.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <Button variant="outline" onClick={() => loadMyReservations({ silent: false })} disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh List'}
          </Button>
          <Button variant="primary" onClick={() => navigateTo('reservation')}>
            + Make a Reservation
          </Button>
        </div>
      </div>

      {feedbackNotice && (
        <div style={{ marginBottom: '1.5rem' }}>
          <Alert type={feedbackNotice.type} title={feedbackNotice.title}>
            {feedbackNotice.message}
          </Alert>
        </div>
      )}

      {errorMsg && (
        <div style={{ marginBottom: '1.5rem' }}>
          <Alert type="error" title="Unable to Load Reservations">
            {errorMsg}
          </Alert>
        </div>
      )}

      {/* Filter Toolbar */}
      <Card style={{ marginBottom: '1.75rem' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '1rem',
          }}
        >
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {[
              { id: 'all', label: 'All Reservations' },
              { id: 'pending', label: 'Pending Review' },
              { id: 'approved', label: 'Approved' },
              { id: 'cancelled', label: 'Cancelled' },
            ].map((tab) => (
              <Button
                key={tab.id}
                size="sm"
                variant={statusFilter === tab.id ? 'secondary' : 'ghost'}
                onClick={() => setStatusFilter(tab.id)}
              >
                {tab.label}
              </Button>
            ))}
          </div>

          <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
            Showing <strong>{filteredReservations.length}</strong> of {reservations.length} record(s)
          </span>
        </div>
      </Card>

      {/* Content States */}
      {loading ? (
        <Card title="Loading Your Reservations">
          <p style={{ fontSize: '0.9375rem', margin: 0 }}>
            Retrieving your personal reservation history...
          </p>
        </Card>
      ) : filteredReservations.length === 0 ? (
        <Card title="No Reservations Yet">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'flex-start' }}>
            <p style={{ fontSize: '0.9375rem', margin: 0 }}>
              {statusFilter === 'all'
                ? 'Your submitted reservations for Timugan Main Covered Court will appear here.'
                : `You have no reservations with status "${statusFilter}".`}
            </p>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <Button variant="primary" onClick={() => navigateTo('reservation')}>
                Make a Reservation
              </Button>
              {statusFilter !== 'all' && (
                <Button variant="outline" onClick={() => setStatusFilter('all')}>
                  Show All Reservations
                </Button>
              )}
            </div>
          </div>
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', marginBottom: '3.5rem' }}>
          {filteredReservations.map((res) => {
            const cancellable = canResidentCancelReservation(res)
            const createdDateFormatted = res.created_at
              ? new Date(res.created_at).toLocaleString('en-PH', {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : '—'

            return (
              <Card
                key={res.id}
                title={`${res.reservation_date} • ${formatTime12Hour(res.start_time)} – ${formatTime12Hour(res.end_time)}`}
                subtitle={res.facility_name}
                headerRight={
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <Badge status={res.status} />
                    <Badge status={res.payment_status || 'pending_payment'} />
                  </div>
                }
              >
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                    gap: '1rem',
                    fontSize: '0.875rem',
                    marginBottom: '1.25rem',
                  }}
                >
                  <div>
                    <strong style={{ color: 'var(--color-text-muted)', display: 'block', fontSize: '0.75rem', textTransform: 'uppercase' }}>
                      Activity & Purpose
                    </strong>
                    <span style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>
                      {res.activity_type}
                    </span>
                    <p style={{ margin: '0.25rem 0 0', fontSize: '0.8125rem' }}>{res.purpose}</p>
                  </div>

                  <div>
                    <strong style={{ color: 'var(--color-text-muted)', display: 'block', fontSize: '0.75rem', textTransform: 'uppercase' }}>
                      Fee & Payment (Cash Only)
                    </strong>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem', margin: '0.15rem 0' }}>
                      <span style={{ fontWeight: 700, fontSize: '1.0625rem', color: 'var(--color-primary-dark)' }}>
                        ₱{Number(res.total_amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                        ({res.rate_category === 'student' ? 'Student' : res.rate_category === 'timugan_resident' ? 'Resident' : 'Outside'})
                      </span>
                    </div>
                    <span style={{ fontWeight: 600, color: res.payment_status === 'paid' ? '#065f46' : '#92400e', fontSize: '0.8125rem' }}>
                      {res.payment_status === 'paid' ? 'Paid' : 'Pending Payment'}
                    </span>
                    {res.payment_due_at && res.payment_status !== 'paid' && res.status !== 'cancelled' && (
                      <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: '#b45309' }}>
                        Due: {new Date(res.payment_due_at).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    )}
                  </div>

                  <div>
                    <strong style={{ color: 'var(--color-text-muted)', display: 'block', fontSize: '0.75rem', textTransform: 'uppercase' }}>
                      Submitted On
                    </strong>
                    <span style={{ color: 'var(--color-text-primary)' }}>{createdDateFormatted}</span>
                    {res.status_reason && (
                      <p style={{ margin: '0.25rem 0 0', fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>
                        Note: {res.status_reason}
                      </p>
                    )}
                  </div>
                </div>

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'flex-end',
                    gap: '0.75rem',
                    flexWrap: 'wrap',
                    paddingTop: '0.875rem',
                    borderTop: '1px solid var(--color-border-subtle)',
                  }}
                >
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleOpenDetails(res.id)}
                  >
                    View Details
                  </Button>
                  {cancellable && (
                    <Button
                      size="sm"
                      variant="ghost"
                      style={{ color: '#991b1b' }}
                      onClick={() => {
                        setCancelTarget(res)
                        setCancelReason('')
                      }}
                    >
                      Cancel Reservation
                    </Button>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* Cancellation Confirmation Modal */}
      <ConfirmDialog
        open={Boolean(cancelTarget)}
        title="Cancel Reservation?"
        description={
          cancelTarget
            ? `Are you sure you want to cancel your reservation on ${cancelTarget.reservation_date} (${formatTime12Hour(cancelTarget.start_time)} – ${formatTime12Hour(cancelTarget.end_time)})? Once cancelled, this time slot will be released.`
            : ''
        }
        confirmLabel="Confirm Cancellation"
        cancelLabel="Keep Reservation"
        variant="primary"
        loading={cancelling}
        onCancel={() => {
          setCancelTarget(null)
          setCancelReason('')
        }}
        onConfirm={handleConfirmCancel}
      >
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label" htmlFor="cancel-reason-input">
            Reason for Cancellation (Optional)
          </label>
          <input
            id="cancel-reason-input"
            type="text"
            className="form-input"
            placeholder="e.g. Schedule change or team unavailable"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            disabled={cancelling}
          />
        </div>
      </ConfirmDialog>
    </div>
  )
}

export default MyReservationsPage
