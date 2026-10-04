import { useState, useEffect, useCallback } from 'react'
import Button from '../../components/common/Button.jsx'
import Card from '../../components/common/Card.jsx'
import Alert from '../../components/common/Alert.jsx'
import Badge from '../../components/common/Badge.jsx'
import ConfirmDialog from '../../components/common/ConfirmDialog.jsx'
import RealtimeStatusPill from '../../components/common/RealtimeStatusPill.jsx'
import useAuth from '../../hooks/useAuth.js'
import { useRealtimeReservations } from '../../hooks/useRealtimeReservations.js'
import { useRealtimeClosures } from '../../hooks/useRealtimeClosures.js'
import { PERMISSIONS } from '../../utils/authorization.js'
import {
  SINGLE_FACILITY_NAME,
  getLocalTodayDateString,
  formatTime12Hour,
} from '../../services/reservationService.js'
import {
  CLOSURE_TYPES,
  OPERATING_HOUR_SLOTS,
  fetchOfficialDashboardData,
  filterOfficialReservations,
  processOfficialReservationAction,
  createOfficialCourtClosure,
  deactivateOfficialCourtClosure,
  confirmOfficialCashPayment,
  fetchMonthlyReservationReport,
} from '../../services/officialDashboardService.js'

function shiftYearMonth(ymStr, offset) {
  if (!ymStr) return ''
  const [y, m] = ymStr.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1 + offset, 1))
  const newY = date.getUTCFullYear()
  const newM = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${newY}-${newM}`
}

function formatYearMonthTitle(ymStr) {
  if (!ymStr) return ''
  const [y, m] = ymStr.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, 1))
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

const ALL_RESERVATION_STATUSES = [
  'all',
  'pending',
  'approved',
  'rejected',
  'cancelled',
  'completed',
  'no_show',
  'rescheduled',
]

export function OfficialDashboardPage({ navigateTo, initialTab = 'overview' }) {
  const { hasPermission } = useAuth()

  const canManageReservations = hasPermission(PERMISSIONS.CAN_MANAGE_RESERVATIONS)
  const canManageClosures =
    hasPermission(PERMISSIONS.CAN_MANAGE_COURT_CLOSURES) ||
    hasPermission(PERMISSIONS.CAN_MANAGE_COURT)
  const canViewReports = hasPermission(PERMISSIONS.CAN_VIEW_REPORTS)

  const todayStr = getLocalTodayDateString()
  const currentYearMonth = todayStr.slice(0, 7)

  const [activeTab, setActiveTab] = useState(initialTab)
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')
  const [feedbackNotice, setFeedbackNotice] = useState(null)

  // Monthly Reports State
  const [reportMonth, setReportMonth] = useState(currentYearMonth)
  const [monthlyReport, setMonthlyReport] = useState(null)
  const [reportLoading, setReportLoading] = useState(false)
  const [reportError, setReportError] = useState('')

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab)
    }
  }, [initialTab])

  const [dashboardData, setDashboardData] = useState({
    reservations: [],
    closures: [],
    auditLogs: [],
    summary: {
      pendingCount: 0,
      approvedCount: 0,
      todayCount: 0,
      upcomingCount: 0,
      activeClosuresCount: 0,
    },
    todayReservations: [],
    upcomingReservations: [],
  })

  // Reservation Management Filters
  const [statusFilter, setStatusFilter] = useState('all')
  const [dateMode, setDateMode] = useState('all')
  const [customDate, setCustomDate] = useState(todayStr)
  const [searchQuery, setSearchQuery] = useState('')

  // Selected Reservation ID for Detail Inspection & Official Processing (derived during render)
  const [selectedReservationId, setSelectedReservationId] = useState(null)
  const selectedReservation =
    dashboardData.reservations.find((r) => r.id === selectedReservationId) || null
  const setSelectedReservation = (resOrNull) => {
    setSelectedReservationId(resOrNull ? resOrNull.id : null)
  }

  // Confirmation Dialog for Official Reservation Actions (Approve, Reject, Cancel, Complete, No-Show, Reschedule)
  const [actionModal, setActionModal] = useState({
    open: false,
    reservation: null,
    action: 'approve',
    statusReason: '',
    adminNotes: '',
    newDate: todayStr,
    newStartTime: '08:00',
    newEndTime: '10:00',
    submitting: false,
  })

  // Cash Payment Confirmation Modal State
  const [paymentModalOpen, setPaymentModalOpen] = useState(false)
  const [paymentNotes, setPaymentNotes] = useState('')
  const [confirmingPayment, setConfirmingPayment] = useState(false)

  // Official Calendar Date State
  const [officialCalendarDate, setOfficialCalendarDate] = useState(todayStr)

  // Court Closure Creation & Deactivation State
  const [closureForm, setClosureForm] = useState({
    closureDate: todayStr,
    startTime: '08:00',
    endTime: '12:00',
    closureType: 'maintenance',
    reason: '',
  })
  const [closureConfirmOpen, setClosureConfirmOpen] = useState(false)
  const [deactivateTargetClosure, setDeactivateTargetClosure] = useState(null)
  const [closureSubmitting, setClosureSubmitting] = useState(false)

  const loadDashboard = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setLoading(true)
    }
    setErrorMsg('')
    try {
      const res = await fetchOfficialDashboardData()
      if (res.error) {
        if (!silent) {
          setErrorMsg(res.error)
        }
      } else {
        setDashboardData({
          reservations: res.reservations,
          closures: res.closures,
          auditLogs: res.auditLogs,
          summary: res.summary,
          todayReservations: res.todayReservations,
          upcomingReservations: res.upcomingReservations,
        })
      }
    } finally {
      if (!silent) {
        setLoading(false)
      }
    }
  }, [])

  const loadMonthlyReport = useCallback(async (yearMonthStr) => {
    if (!canViewReports) return
    setReportLoading(true)
    setReportError('')
    try {
      const [yearStr, monthStr] = (yearMonthStr || currentYearMonth).split('-')
      const year = parseInt(yearStr, 10)
      const month = parseInt(monthStr, 10)
      const res = await fetchMonthlyReservationReport({ year, month })
      if (!res.success) {
        setReportError(res.error || 'Failed to load monthly report.')
        return
      }
      setMonthlyReport(res.report || res.data)
    } catch (err) {
      setReportError(err.message || 'Error loading monthly report.')
    } finally {
      setReportLoading(false)
    }
  }, [canViewReports, currentYearMonth])

  useEffect(() => {
    if (activeTab === 'reports' && canViewReports) {
      loadMonthlyReport(reportMonth)
    }
  }, [activeTab, reportMonth, canViewReports, loadMonthlyReport])

  const { connectionStatus: officialRealtimeStatus, lastRealtimeUpdate } = useRealtimeReservations({
    scope: 'official',
    onScheduleRefreshNeeded: () => {
      loadDashboard({ silent: true })
      if (activeTab === 'reports' && canViewReports) {
        loadMonthlyReport(reportMonth)
      }
    },
  })

  const { lastClosureEvent } = useRealtimeClosures({
    onClosureChange: () => {
      loadDashboard({ silent: true })
    },
  })

  useEffect(() => {
    let active = true
    fetchOfficialDashboardData().then((res) => {
      if (!active) return
      if (res.error) {
        setErrorMsg(res.error)
      } else {
        setErrorMsg('')
        setDashboardData({
          reservations: res.reservations,
          closures: res.closures,
          auditLogs: res.auditLogs,
          summary: res.summary,
          todayReservations: res.todayReservations,
          upcomingReservations: res.upcomingReservations,
        })
      }
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [])

  const openActionDialog = (reservation, actionType) => {
    setActionModal({
      open: true,
      reservation,
      action: actionType,
      statusReason: reservation.status_reason || '',
      adminNotes: reservation.admin_notes || '',
      newDate: reservation.reservation_date || todayStr,
      newStartTime: String(reservation.start_time || '08:00').slice(0, 5),
      newEndTime: String(reservation.end_time || '10:00').slice(0, 5),
      submitting: false,
    })
  }

  const handleConfirmOfficialAction = async () => {
    if (!actionModal.reservation) return
    setActionModal((prev) => ({ ...prev, submitting: true }))
    setFeedbackNotice(null)

    try {
      const res = await processOfficialReservationAction({
        reservationId: actionModal.reservation.id,
        action: actionModal.action,
        statusReason: actionModal.statusReason,
        adminNotes: actionModal.adminNotes,
        newDate: actionModal.action === 'reschedule' ? actionModal.newDate : null,
        newStartTime: actionModal.action === 'reschedule' ? actionModal.newStartTime : null,
        newEndTime: actionModal.action === 'reschedule' ? actionModal.newEndTime : null,
      })

      if (!res.success) {
        setFeedbackNotice({
          type: 'error',
          title: 'Official Action Failed',
          message: res.error,
        })
        setActionModal((prev) => ({ ...prev, submitting: false }))
        return
      }

      setActionModal((prev) => ({
        ...prev,
        open: false,
        reservation: null,
        submitting: false,
      }))

      setFeedbackNotice({
        type: 'success',
        title: `Reservation ${res.reservation?.status?.toUpperCase() || 'Updated'}`,
        message: `Reservation for ${res.reservation?.applicant_name} (${res.reservation?.reservation_date}) has been processed and recorded in the audit log.`,
      })

      await loadDashboard()
    } catch {
      setActionModal((prev) => ({ ...prev, submitting: false }))
    }
  }

  const handleConfirmCashPayment = async () => {
    if (!selectedReservation) return
    setConfirmingPayment(true)
    setFeedbackNotice(null)
    try {
      const res = await confirmOfficialCashPayment({
        reservationId: selectedReservation.id,
        adminNotes: paymentNotes || null,
      })

      if (!res.success) {
        setFeedbackNotice({
          type: 'error',
          title: 'Payment Confirmation Failed',
          message: res.error,
        })
        return
      }

      setDashboardData((prev) => ({
        ...prev,
        reservations: prev.reservations.map((r) =>
          r.id === res.reservation.id ? res.reservation : r
        ),
      }))

      setFeedbackNotice({
        type: 'success',
        title: 'Cash Payment Confirmed',
        message: `Reservation for ${res.reservation?.applicant_name} has been marked as Paid in cash. Official audit log recorded.`,
      })
      setPaymentModalOpen(false)
      setPaymentNotes('')
      await loadDashboard({ silent: true })
    } finally {
      setConfirmingPayment(false)
    }
  }

  const handleRequestCreateClosure = (e) => {
    e.preventDefault()
    setFeedbackNotice(null)

    if (!canManageClosures) {
      setFeedbackNotice({
        type: 'error',
        title: 'Permission Required',
        message: 'You need the canManageCourtClosures permission to create court closures.',
      })
      return
    }

    if (closureForm.endTime <= closureForm.startTime) {
      setFeedbackNotice({
        type: 'error',
        title: 'Invalid Closure Schedule',
        message: 'Closure end time must be later than start time.',
      })
      return
    }

    if (closureForm.reason.trim().length < 3) {
      setFeedbackNotice({
        type: 'error',
        title: 'Reason Required',
        message: 'Please enter a clear official reason (at least 3 characters) for closing the court.',
      })
      return
    }

    setClosureConfirmOpen(true)
  }

  const handleConfirmCreateClosure = async () => {
    setClosureSubmitting(true)
    setFeedbackNotice(null)

    try {
      const res = await createOfficialCourtClosure(closureForm)
      if (!res.success) {
        setFeedbackNotice({
          type: 'error',
          title: 'Unable to Schedule Court Closure',
          message: res.error,
        })
        setClosureConfirmOpen(false)
        return
      }

      setClosureConfirmOpen(false)
      setClosureForm((prev) => ({
        ...prev,
        reason: '',
      }))
      setFeedbackNotice({
        type: 'success',
        title: 'Court Closure Scheduled',
        message: `${SINGLE_FACILITY_NAME} has been marked unavailable on ${res.closure?.closure_date} (${formatTime12Hour(res.closure?.start_time)} – ${formatTime12Hour(res.closure?.end_time)}).`,
      })

      await loadDashboard()
    } finally {
      setClosureSubmitting(false)
    }
  }

  const handleConfirmDeactivateClosure = async () => {
    if (!deactivateTargetClosure) return
    setClosureSubmitting(true)
    setFeedbackNotice(null)

    try {
      const res = await deactivateOfficialCourtClosure(deactivateTargetClosure.id)
      if (!res.success) {
        setFeedbackNotice({
          type: 'error',
          title: 'Unable to Deactivate Court Closure',
          message: res.error,
        })
        setDeactivateTargetClosure(null)
        return
      }

      setDeactivateTargetClosure(null)
      setFeedbackNotice({
        type: 'success',
        title: 'Court Closure Deactivated',
        message: 'The court closure has been lifted and the time slot is open for reservations again.',
      })

      await loadDashboard()
    } finally {
      setClosureSubmitting(false)
    }
  }

  const filteredReservations = filterOfficialReservations(dashboardData.reservations, {
    statusFilter,
    dateMode,
    customDate,
    searchQuery,
  })

  // Official Calendar daily items for officialCalendarDate
  const calendarDayReservations = dashboardData.reservations.filter(
    (r) =>
      r.reservation_date === officialCalendarDate &&
      ['pending', 'approved', 'rescheduled', 'completed'].includes(r.status)
  )
  const calendarDayClosures = dashboardData.closures.filter(
    (c) => c.closure_date === officialCalendarDate && c.is_active === true
  )

  return (
    <div className="container" style={{ paddingTop: '2.25rem', paddingBottom: '3.5rem' }}>
      {/* Page Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: '1rem',
          marginBottom: '1.75rem',
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
              Barangay Timugan Official Workspace • {SINGLE_FACILITY_NAME}
            </span>
            <RealtimeStatusPill
              status={officialRealtimeStatus}
              lastEvent={lastClosureEvent || lastRealtimeUpdate}
            />
          </div>
          <h1 style={{ margin: '0.35rem 0 0.5rem', fontSize: '2rem' }}>
            Official Court Reservation Dashboard
          </h1>
          <p style={{ fontSize: '0.9375rem', maxWidth: '720px', margin: 0 }}>
            Manage court reservation applications, review schedules, enforce facility closures, and inspect audit logs for {SINGLE_FACILITY_NAME}. Live dashboard metrics and activity update automatically.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap' }}>
          <Button variant="outline" onClick={() => loadDashboard({ silent: false })} disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh Dashboard'}
          </Button>
          <Button variant="secondary" onClick={() => navigateTo('official-portal')}>
            Official Access & Verification
          </Button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div
        role="tablist"
        aria-label="Official Dashboard Sections"
        style={{
          display: 'flex',
          gap: '0.5rem',
          flexWrap: 'wrap',
          marginBottom: '1.75rem',
          borderBottom: '2px solid var(--color-border)',
          paddingBottom: '0.75rem',
        }}
      >
        {[
          { id: 'overview', label: '1. Dashboard Overview' },
          {
            id: 'reservations',
            label: `2. Reservation Management (${dashboardData.summary.pendingCount} Pending)`,
          },
          { id: 'calendar', label: '3. Official Calendar' },
          {
            id: 'closures',
            label: `4. Court Closures (${dashboardData.summary.activeClosuresCount} Active)`,
          },
          ...(canViewReports ? [{ id: 'reports', label: '5. Monthly Reports' }] : []),
        ].map((tab) => (
          <Button
            key={tab.id}
            variant={activeTab === tab.id ? 'primary' : 'outline'}
            size="sm"
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </Button>
        ))}
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
          <Alert type="error" title="Error Loading Official Dashboard">
            {errorMsg}
          </Alert>
        </div>
      )}

      {/* KPI Summary Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
          gap: '1.15rem',
          marginBottom: '2rem',
        }}
      >
        <Card
          title="Pending Review"
          subtitle="Awaiting Official Action"
          headerRight={<Badge status="pending">Pending</Badge>}
        >
          <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--color-primary-dark)' }}>
            {loading ? '...' : dashboardData.summary.pendingCount}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setStatusFilter('pending')
              setActiveTab('reservations')
            }}
            style={{ marginTop: '0.35rem', paddingLeft: 0 }}
          >
            Review Pending Queue →
          </Button>
        </Card>

        <Card
          title="Approved Bookings"
          subtitle="Confirmed Court Schedules"
          headerRight={<Badge status="approved">Approved</Badge>}
        >
          <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--color-primary-dark)' }}>
            {loading ? '...' : dashboardData.summary.approvedCount}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setStatusFilter('approved')
              setActiveTab('reservations')
            }}
            style={{ marginTop: '0.35rem', paddingLeft: 0 }}
          >
            View Approved →
          </Button>
        </Card>

        <Card
          title="Today's Schedule"
          subtitle={todayStr}
          headerRight={<Badge status="available">Today</Badge>}
        >
          <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--color-primary-dark)' }}>
            {loading ? '...' : dashboardData.summary.todayCount}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setDateMode('today')
              setActiveTab('reservations')
            }}
            style={{ marginTop: '0.35rem', paddingLeft: 0 }}
          >
            Filter Today →
          </Button>
        </Card>

        <Card
          title="Active Closures"
          subtitle={SINGLE_FACILITY_NAME}
          headerRight={<Badge status="closed">Closures</Badge>}
        >
          <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--color-primary-dark)' }}>
            {loading ? '...' : dashboardData.summary.activeClosuresCount}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setActiveTab('closures')}
            style={{ marginTop: '0.35rem', paddingLeft: 0 }}
          >
            Manage Closures →
          </Button>
        </Card>
      </div>

      {/* TAB 1: DASHBOARD OVERVIEW */}
      {activeTab === 'overview' && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 350px), 1fr))',
            gap: '1.5rem',
            alignItems: 'start',
          }}
        >
          {/* Today's Reservations */}
          <Card
            title={`Today's Reservations (${todayStr})`}
            subtitle={`Scheduled sessions at ${SINGLE_FACILITY_NAME}`}
          >
            {dashboardData.todayReservations.length === 0 ? (
              <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', margin: 0 }}>
                No court reservations scheduled for today ({todayStr}).
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {dashboardData.todayReservations.map((res) => (
                  <div
                    key={res.id}
                    style={{
                      padding: '0.85rem',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-sm)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '0.75rem',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>
                        {formatTime12Hour(res.start_time)} – {formatTime12Hour(res.end_time)} • {res.applicant_name}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                        {res.activity_type} ({res.applicant_mobile})
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Badge status={res.status}>{res.status}</Badge>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setSelectedReservation(res)
                          setActiveTab('reservations')
                        }}
                      >
                        Inspect
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Upcoming Reservations */}
          <Card
            title="Upcoming Reservations"
            subtitle="Next pending & approved reservations requiring attention"
          >
            {dashboardData.upcomingReservations.length === 0 ? (
              <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', margin: 0 }}>
                No upcoming active reservations found.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {dashboardData.upcomingReservations.slice(0, 6).map((res) => (
                  <div
                    key={res.id}
                    style={{
                      padding: '0.85rem',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-sm)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '0.75rem',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>
                        {res.reservation_date} ({formatTime12Hour(res.start_time)} – {formatTime12Hour(res.end_time)})
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                        {res.applicant_name} • {res.purpose}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Badge status={res.status}>{res.status}</Badge>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setSelectedReservation(res)
                          setActiveTab('reservations')
                        }}
                      >
                        Process
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Recent Reservation & Administrative Activity */}
          <Card
            title="Recent Reservation & Administrative Activity"
            subtitle="Immutable audit trail of approvals, rejections, reschedules, and closures"
            style={{ gridColumn: '1 / -1' }}
          >
            {dashboardData.auditLogs.length === 0 ? (
              <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', margin: 0 }}>
                No administrative reservation or court closure activity recorded yet.
              </p>
            ) : (
              <div className="table-responsive" style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--color-border)', textAlign: 'left' }}>
                      <th style={{ padding: '0.6rem' }}>Timestamp</th>
                      <th style={{ padding: '0.6rem' }}>Action</th>
                      <th style={{ padding: '0.6rem' }}>Entity</th>
                      <th style={{ padding: '0.6rem' }}>Schedule & Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboardData.auditLogs.slice(0, 12).map((log) => (
                      <tr key={log.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                        <td style={{ padding: '0.6rem', whiteSpace: 'nowrap' }}>
                          {new Date(log.created_at).toLocaleString()}
                        </td>
                        <td style={{ padding: '0.6rem', fontWeight: 600 }}>
                          <code>{log.action}</code>
                        </td>
                        <td style={{ padding: '0.6rem' }}>{log.entity_type}</td>
                        <td style={{ padding: '0.6rem', fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>
                          {JSON.stringify(log.details || {})}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* TAB 2: RESERVATION MANAGEMENT & DETAIL PROCESSING */}
      {activeTab === 'reservations' && (
        <div className={selectedReservation ? 'official-queue-grid has-selection' : 'official-queue-grid'}>
          {/* Reservations Filterable List */}
          <Card
            title="Reservation Management Queue"
            subtitle={`Filter, search, and process court reservations for ${SINGLE_FACILITY_NAME}`}
          >
            {/* Search & Date Filter Controls */}
            <div className="form-row form-row-2" style={{ marginBottom: '1rem' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" htmlFor="res-search">
                  Search Applicant, Mobile, Purpose, or Address
                </label>
                <input
                  id="res-search"
                  type="search"
                  className="form-input"
                  placeholder="Search name, 0917..., basketball, purok..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" htmlFor="res-date-mode">
                  Date Filter
                </label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <select
                    id="res-date-mode"
                    className="form-select"
                    value={dateMode}
                    onChange={(e) => setDateMode(e.target.value)}
                  >
                    <option value="all">All Dates</option>
                    <option value="today">Today ({todayStr})</option>
                    <option value="upcoming">Upcoming Dates</option>
                    <option value="custom">Specific Date</option>
                  </select>
                  {dateMode === 'custom' && (
                    <input
                      type="date"
                      className="form-input"
                      aria-label="Select specific reservation date"
                      value={customDate}
                      onChange={(e) => setCustomDate(e.target.value)}
                    />
                  )}
                </div>
              </div>
            </div>

            {/* Status Filter Pills */}
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
              {ALL_RESERVATION_STATUSES.map((st) => (
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
                    backgroundColor: statusFilter === st ? 'var(--color-primary)' : '#ffffff',
                    color: statusFilter === st ? '#ffffff' : 'var(--color-text)',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    textTransform: 'capitalize',
                    cursor: 'pointer',
                  }}
                >
                  {st.replace('_', ' ')}
                </button>
              ))}
            </div>

            {filteredReservations.length === 0 ? (
              <div
                style={{
                  padding: '2rem',
                  textAlign: 'center',
                  backgroundColor: 'var(--color-surface-muted)',
                  borderRadius: 'var(--radius-md)',
                }}
              >
                <p style={{ fontWeight: 600, marginBottom: '0.35rem' }}>
                  No Matching Reservations Found
                </p>
                <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', margin: 0 }}>
                  Adjust your status filter, date filter, or search query to view other records.
                </p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                {filteredReservations.map((res) => {
                  const isSelected = selectedReservation?.id === res.id
                  return (
                    <div
                      key={res.id}
                      style={{
                        border: isSelected
                          ? '2px solid var(--color-primary)'
                          : '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-md)',
                        padding: '1rem',
                        backgroundColor: isSelected ? 'var(--color-surface-muted)' : '#ffffff',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'flex-start',
                          gap: '0.75rem',
                          flexWrap: 'wrap',
                          marginBottom: '0.5rem',
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>
                            {res.applicant_name} ({res.applicant_mobile})
                          </div>
                          <div style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>
                            <strong>{res.reservation_date}</strong> • {formatTime12Hour(res.start_time)} –{' '}
                            {formatTime12Hour(res.end_time)}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                          <Badge status={res.status}>{res.status}</Badge>
                          <Badge status={res.payment_status || 'pending_payment'} />
                        </div>
                      </div>

                      <div style={{ fontSize: '0.82rem', marginBottom: '0.65rem' }}>
                        <div>
                          <strong>Fee & Duration:</strong> ₱{Number(res.total_amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })} ({res.rate_category === 'student' ? 'Student ₱150/h' : res.rate_category === 'timugan_resident' ? 'Resident ₱200/h' : 'Outside ₱300/h'} • {res.duration_hours || 0} hrs)
                        </div>
                        <div>
                          <strong>Purpose:</strong> {res.purpose} ({res.activity_type})
                        </div>
                        <div style={{ color: 'var(--color-text-muted)' }}>
                          <strong>Address:</strong> {res.address}
                        </div>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                          Submitted: {new Date(res.created_at).toLocaleDateString()}
                        </span>
                        <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                          <Button
                            size="sm"
                            variant={isSelected ? 'primary' : 'outline'}
                            onClick={() => setSelectedReservation(res)}
                          >
                            {isSelected ? 'Viewing Details' : 'Open Details & Actions'}
                          </Button>
                          {canManageReservations && res.status === 'pending' && (
                            <>
                              <Button
                                size="sm"
                                variant="primary"
                                onClick={() => openActionDialog(res, 'approve')}
                              >
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openActionDialog(res, 'reject')}
                              >
                                Reject
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Card>

          {/* Right Panel: Reservation Details & Official Action Suite */}
          {selectedReservation && (
            <Card
              title="Official Reservation Details & Processing"
              subtitle={`Reference ID: ${selectedReservation.id}`}
              headerRight={
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelectedReservation(null)}
                >
                  Close ✕
                </Button>
              }
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', paddingBottom: '0.75rem', borderBottom: '1px solid var(--color-border)' }}>
                <div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                    Current Status
                  </div>
                  <div style={{ fontWeight: 700, fontSize: '1.05rem', textTransform: 'capitalize' }}>
                    {selectedReservation.status.replace('_', ' ')}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  <Badge status={selectedReservation.status}>{selectedReservation.status}</Badge>
                  <Badge status={selectedReservation.payment_status || 'pending_payment'} />
                </div>
              </div>

              {/* Applicant, Payment & Schedule Information */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--color-text-muted)' }}>Payment Method:</span>
                  <strong>Cash Only (Barangay Office)</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--color-text-muted)' }}>Payment Status:</span>
                  <strong style={{ color: selectedReservation.payment_status === 'paid' ? '#065f46' : '#92400e' }}>
                    {selectedReservation.payment_status === 'paid' ? 'Paid (Cash)' : 'Pending Payment'}
                  </strong>
                </div>
                {selectedReservation.payment_due_at && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--color-text-muted)' }}>Payment Deadline:</span>
                    <strong style={{ color: '#92400e' }}>
                      {new Date(selectedReservation.payment_due_at).toLocaleString('en-PH')}
                    </strong>
                  </div>
                )}
                {selectedReservation.paid_at && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--color-text-muted)' }}>Paid At Timestamp:</span>
                    <span>{new Date(selectedReservation.paid_at).toLocaleString('en-PH')}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--color-text-muted)' }}>Rental Rate Tier:</span>
                  <strong>
                    {selectedReservation.rate_category === 'student'
                      ? 'Student (₱150/hr)'
                      : selectedReservation.rate_category === 'timugan_resident'
                        ? 'Timugan Resident (₱200/hr)'
                        : 'Outside Brgy. Timugan (₱300/hr)'}
                    {selectedReservation.is_student ? ' • Student ID' : ''}
                  </strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--color-text-muted)' }}>Duration & Computed Fee:</span>
                  <strong style={{ color: 'var(--color-primary-dark)' }}>
                    {selectedReservation.duration_hours || 0} hrs @ ₱{Number(selectedReservation.hourly_rate || 0).toFixed(2)} = ₱{Number(selectedReservation.total_amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--color-text-muted)' }}>Applicant Full Name:</span>
                  <strong>{selectedReservation.applicant_name}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--color-text-muted)' }}>Contact Mobile Number:</span>
                  <strong>{selectedReservation.applicant_mobile}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--color-text-muted)' }}>Residency Classification:</span>
                  <span>{selectedReservation.residency_type}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                  <span style={{ color: 'var(--color-text-muted)' }}>Structured Address:</span>
                  <span style={{ textAlign: 'right', fontWeight: 500 }}>{selectedReservation.address}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--color-text-muted)' }}>Reservation Date:</span>
                  <strong>{selectedReservation.reservation_date}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--color-text-muted)' }}>Time Slot:</span>
                  <strong>
                    {formatTime12Hour(selectedReservation.start_time)} –{' '}
                    {formatTime12Hour(selectedReservation.end_time)}
                  </strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--color-text-muted)' }}>Activity / Purpose:</span>
                  <span style={{ textAlign: 'right' }}>
                    {selectedReservation.activity_type} — {selectedReservation.purpose}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--color-text-muted)' }}>Created Timestamp:</span>
                  <span>{new Date(selectedReservation.created_at).toLocaleString()}</span>
                </div>
                {selectedReservation.reviewed_at && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--color-text-muted)' }}>Last Reviewed At:</span>
                    <span>{new Date(selectedReservation.reviewed_at).toLocaleString()}</span>
                  </div>
                )}
                {selectedReservation.status_reason && (
                  <div style={{ padding: '0.6rem', backgroundColor: 'var(--color-surface-muted)', borderRadius: 'var(--radius-sm)' }}>
                    <strong>Status / Decision Reason:</strong> {selectedReservation.status_reason}
                  </div>
                )}
              </div>

              {/* Internal Official Notes Section (Separated from public/resident view) */}
              <div
                style={{
                  padding: '0.85rem',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--status-pending-bg)',
                  border: '1px solid var(--status-pending-border)',
                  marginBottom: '1.25rem',
                  fontSize: '0.8125rem',
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: '0.25rem', color: 'var(--status-pending-text)' }}>
                  Internal Barangay Official Notes (Protected — Never Shown to Public/Residents)
                </div>
                <div style={{ color: 'var(--color-text)' }}>
                  {selectedReservation.admin_notes || 'No internal official notes recorded yet.'}
                </div>
              </div>

              {/* Official Actions Suite */}
              {!canManageReservations ? (
                <Alert type="warning" title="Read-Only Official View">
                  Your official account does not hold the <code>canManageReservations</code> permission required to approve, reject, or modify reservations.
                </Alert>
              ) : (
                <div>
                  <h4 style={{ fontSize: '0.875rem', marginBottom: '0.65rem' }}>
                    Execute Official Reservation Action (Confirmation Required)
                  </h4>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                    {['pending', 'rescheduled'].includes(selectedReservation.status) && (
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => openActionDialog(selectedReservation, 'approve')}
                      >
                        Approve Reservation
                      </Button>
                    )}

                    {selectedReservation.status === 'pending' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openActionDialog(selectedReservation, 'reject')}
                      >
                        Reject Application
                      </Button>
                    )}

                    {['pending', 'approved', 'rescheduled'].includes(selectedReservation.status) && (
                      <>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => openActionDialog(selectedReservation, 'reschedule')}
                        >
                          Reschedule Slot
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openActionDialog(selectedReservation, 'cancel')}
                        >
                          Cancel Reservation
                        </Button>
                      </>
                    )}

                    {['approved', 'rescheduled'].includes(selectedReservation.status) && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openActionDialog(selectedReservation, 'completed')}
                        >
                          Mark Completed
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openActionDialog(selectedReservation, 'no_show')}
                        >
                          Mark No-Show
                        </Button>
                      </>
                    )}

                    {canManageReservations && selectedReservation.payment_status !== 'paid' && !['cancelled', 'rejected'].includes(selectedReservation.status) && (
                      <Button
                        size="sm"
                        variant="primary"
                        style={{ backgroundColor: '#059669', borderColor: '#059669', color: '#fff' }}
                        onClick={() => {
                          setPaymentNotes('')
                          setPaymentModalOpen(true)
                        }}
                      >
                        Confirm Cash Payment
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </Card>
          )}
        </div>
      )}

      {/* TAB 3: OFFICIAL CALENDAR VIEW */}
      {activeTab === 'calendar' && (
        <Card
          title={`Official Facility Schedule Calendar — ${SINGLE_FACILITY_NAME}`}
          subtitle="Displays Pending Reservations, Approved Reservations, and Court Closures with official review context"
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <label htmlFor="off-cal-date" style={{ fontWeight: 700, fontSize: '0.875rem' }}>
                Inspect Date:
              </label>
              <input
                id="off-cal-date"
                type="date"
                className="form-input"
                value={officialCalendarDate}
                onChange={(e) => setOfficialCalendarDate(e.target.value)}
                style={{ width: 'auto' }}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => setOfficialCalendarDate(todayStr)}
              >
                Jump to Today
              </Button>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <Badge status="available">Open Slot</Badge>
              <Badge status="pending">Pending Review</Badge>
              <Badge status="approved">Approved Booking</Badge>
              <Badge status="closed">Court Closure</Badge>
            </div>
          </div>

          {/* Hourly Grid for the Single Court */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '0.85rem' }}>
            {OPERATING_HOUR_SLOTS.map((slot) => {
              const matchingClosure = calendarDayClosures.find(
                (c) =>
                  String(c.start_time).slice(0, 5) < slot.endTime &&
                  String(c.end_time).slice(0, 5) > slot.startTime
              )
              const matchingRes = calendarDayReservations.find(
                (r) =>
                  String(r.start_time).slice(0, 5) < slot.endTime &&
                  String(r.end_time).slice(0, 5) > slot.startTime
              )

              let statusBadge = 'available'
              let statusText = 'Available'
              let detailText = 'Open for reservation'

              if (matchingClosure) {
                statusBadge = 'closed'
                statusText = 'Closed'
                detailText = `Closure (${matchingClosure.closure_type}): ${matchingClosure.reason}`
              } else if (matchingRes) {
                statusBadge = matchingRes.status
                statusText = matchingRes.status
                detailText = `${matchingRes.applicant_name} — ${matchingRes.purpose}`
              }

              return (
                <div
                  key={slot.startTime}
                  style={{
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '0.85rem',
                    backgroundColor: '#ffffff',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: '0.5rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ fontSize: '0.875rem' }}>{slot.label}</strong>
                    <Badge status={statusBadge}>{statusText}</Badge>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                    {detailText}
                  </div>
                  {matchingRes && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setSelectedReservation(matchingRes)
                        setActiveTab('reservations')
                      }}
                    >
                      Inspect Reservation
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {/* TAB 4: COURT CLOSURE MANAGEMENT */}
      {activeTab === 'closures' && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))',
            gap: '1.5rem',
            alignItems: 'start',
          }}
        >
          {/* Left: Schedule Court Closure Form */}
          <Card
            title={`Schedule Court Closure — ${SINGLE_FACILITY_NAME}`}
            subtitle="Block dates/times for maintenance, barangay events, repairs, or emergencies"
          >
            {!canManageClosures ? (
              <Alert type="warning" title="Permission Required">
                Your official account does not hold the <code>canManageCourtClosures</code> capability required to create or modify court closures.
              </Alert>
            ) : (
              <form onSubmit={handleRequestCreateClosure} noValidate>
                <div className="form-group">
                  <label className="form-label" htmlFor="closure-date">
                    Closure Date <span className="required">*</span>
                  </label>
                  <input
                    id="closure-date"
                    type="date"
                    className="form-input"
                    value={closureForm.closureDate}
                    onChange={(e) =>
                      setClosureForm((prev) => ({ ...prev, closureDate: e.target.value }))
                    }
                    required
                  />
                </div>

                <div className="form-row form-row-2">
                  <div className="form-group">
                    <label className="form-label" htmlFor="closure-start">
                      Start Time <span className="required">*</span>
                    </label>
                    <input
                      id="closure-start"
                      type="time"
                      className="form-input"
                      value={closureForm.startTime}
                      onChange={(e) =>
                        setClosureForm((prev) => ({ ...prev, startTime: e.target.value }))
                      }
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label" htmlFor="closure-end">
                      End Time <span className="required">*</span>
                    </label>
                    <input
                      id="closure-end"
                      type="time"
                      className="form-input"
                      value={closureForm.endTime}
                      onChange={(e) =>
                        setClosureForm((prev) => ({ ...prev, endTime: e.target.value }))
                      }
                      required
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="closure-type">
                    Closure Category <span className="required">*</span>
                  </label>
                  <select
                    id="closure-type"
                    className="form-select"
                    value={closureForm.closureType}
                    onChange={(e) =>
                      setClosureForm((prev) => ({ ...prev, closureType: e.target.value }))
                    }
                  >
                    {CLOSURE_TYPES.map((ct) => (
                      <option key={ct.value} value={ct.value}>
                        {ct.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="closure-reason">
                    Official Closure Reason / Public Notice <span className="required">*</span>
                  </label>
                  <input
                    id="closure-reason"
                    type="text"
                    className="form-input"
                    placeholder="e.g. Repainting of court lines and ring maintenance"
                    value={closureForm.reason}
                    onChange={(e) =>
                      setClosureForm((prev) => ({ ...prev, reason: e.target.value }))
                    }
                    required
                  />
                </div>

                <Button type="submit" variant="primary" disabled={closureSubmitting}>
                  Schedule Court Closure
                </Button>
              </form>
            )}
          </Card>

          {/* Right: Active & Historical Closures List */}
          <Card
            title="Court Closure Schedule Registry"
            subtitle="Active closures automatically block new reservations at the PostgreSQL database level"
          >
            {dashboardData.closures.length === 0 ? (
              <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', margin: 0 }}>
                No court closures recorded yet.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                {dashboardData.closures.map((c) => (
                  <div
                    key={c.id}
                    style={{
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '0.9rem',
                      backgroundColor: c.is_active ? '#ffffff' : 'var(--color-surface-muted)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                      <strong>
                        {c.closure_date} • {formatTime12Hour(c.start_time)} – {formatTime12Hour(c.end_time)}
                      </strong>
                      <Badge status={c.is_active ? 'closed' : 'cancelled'}>
                        {c.is_active ? 'Active Closure' : 'Deactivated'}
                      </Badge>
                    </div>
                    <div style={{ fontSize: '0.82rem', marginBottom: '0.5rem' }}>
                      <strong>[{c.closure_type}]</strong> {c.reason}
                    </div>
                    {c.is_active && canManageClosures && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setDeactivateTargetClosure(c)}
                      >
                        Deactivate & Re-open Court
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* TAB 5: MONTHLY REPORTS */}
      {activeTab === 'reports' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {!canViewReports ? (
            <Alert type="error" title="Access Restricted">
              You do not have the required permission (canViewReports) to access official monthly reservation reports.
            </Alert>
          ) : (
            <>
              {/* Report Controls Card */}
              <Card
                title={`Monthly Reservation & Collection Report • ${formatYearMonthTitle(reportMonth)}`}
                subtitle={`Financial & scheduling audit ledger for ${SINGLE_FACILITY_NAME} (Cash Transactions Only)`}
                headerRight={
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => window.print()}
                      aria-label="Print or export monthly report"
                    >
                      Print / Export
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => loadMonthlyReport(reportMonth)}
                      disabled={reportLoading}
                    >
                      {reportLoading ? 'Loading...' : 'Refresh Report'}
                    </Button>
                  </div>
                }
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '1rem',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <label htmlFor="report-month-select" style={{ fontWeight: 600, fontSize: '0.875rem' }}>
                      Select Reporting Month:
                    </label>
                    <input
                      id="report-month-select"
                      type="month"
                      className="form-input"
                      style={{ maxWidth: '190px' }}
                      value={reportMonth}
                      onChange={(e) => setReportMonth(e.target.value)}
                    />
                  </div>

                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setReportMonth((prev) => shiftYearMonth(prev, -1))}
                    >
                      ← Previous Month
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setReportMonth(currentYearMonth)}
                    >
                      Current Month
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setReportMonth((prev) => shiftYearMonth(prev, 1))}
                    >
                      Next Month →
                    </Button>
                  </div>
                </div>
              </Card>

              {reportError && (
                <Alert type="error" title="Report Generation Error">
                  {reportError}
                </Alert>
              )}

              {reportLoading ? (
                <Card title="Generating Monthly Report">
                  <p style={{ margin: 0, fontSize: '0.9375rem', color: 'var(--color-text-muted)' }}>
                    Aggregating reservation ledgers, rate tiers, and confirmed cash receipts for {formatYearMonthTitle(reportMonth)}...
                  </p>
                </Card>
              ) : !monthlyReport ? (
                <Card title="No Report Data">
                  <p style={{ margin: 0, fontSize: '0.9375rem' }}>
                    Please select a reporting period above to load the monthly audit summary.
                  </p>
                </Card>
              ) : (
                <>
                  {/* Financial & Operational KPI Cards */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
                      gap: '1.15rem',
                    }}
                  >
                    <Card
                      title="Total Cash Collected"
                      subtitle="Physical Cash at Barangay Office"
                      headerRight={<Badge status="paid">Paid Only</Badge>}
                    >
                      <div style={{ fontSize: '2rem', fontWeight: 800, color: '#065f46' }}>
                        ₱{Number(monthlyReport.summary.total_cash_collected || 0).toLocaleString('en-PH', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </div>
                      <p style={{ margin: '0.35rem 0 0', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                        Exclusively from {monthlyReport.summary.paid_reservations_count} paid reservation(s)
                      </p>
                    </Card>

                    <Card
                      title="Total Reservations"
                      subtitle="Applications Submitted"
                      headerRight={<Badge status="available">Monthly</Badge>}
                    >
                      <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--color-primary-dark)' }}>
                        {monthlyReport.summary.total_reservations}
                      </div>
                      <p style={{ margin: '0.35rem 0 0', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                        {monthlyReport.summary.paid_reservations_count} Paid • {monthlyReport.summary.pending_payment_count} Unpaid / Pending
                      </p>
                    </Card>

                    <Card
                      title="Total Booked Hours"
                      subtitle="Court Usage Duration"
                      headerRight={<Badge status="reserved">Hours</Badge>}
                    >
                      <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--color-primary-dark)' }}>
                        {monthlyReport.summary.total_booked_hours} <span style={{ fontSize: '1.125rem' }}>hrs</span>
                      </div>
                      <p style={{ margin: '0.35rem 0 0', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                        Across scheduled slots in {formatYearMonthTitle(reportMonth)}
                      </p>
                    </Card>

                    <Card
                      title="Payment Fulfillment"
                      subtitle="Collection Rate"
                      headerRight={
                        <Badge status={monthlyReport.summary.pending_payment_count === 0 ? 'paid' : 'pending'}>
                          Cash
                        </Badge>
                      }
                    >
                      <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--color-primary-dark)' }}>
                        {monthlyReport.summary.total_reservations > 0
                          ? `${Math.round((monthlyReport.summary.paid_reservations_count / monthlyReport.summary.total_reservations) * 100)}%`
                          : '0%'}
                      </div>
                      <p style={{ margin: '0.35rem 0 0', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                        {monthlyReport.summary.paid_reservations_count} Paid of {monthlyReport.summary.total_reservations} total requests
                      </p>
                    </Card>
                  </div>

                  {/* Status Breakdown Grid */}
                  <Card
                    title="Reservation Status Breakdown"
                    subtitle="Distribution across workflow states for the month"
                  >
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                        gap: '0.75rem',
                        textAlign: 'center',
                      }}
                    >
                      {[
                        { label: 'Approved', count: monthlyReport.summary.status_counts.approved || 0, color: '#065f46', bg: '#ecfdf5' },
                        { label: 'Completed', count: monthlyReport.summary.status_counts.completed || 0, color: '#1e3a8a', bg: '#eff6ff' },
                        { label: 'Pending Review', count: monthlyReport.summary.status_counts.pending || 0, color: '#92400e', bg: '#fffbeb' },
                        { label: 'Cancelled', count: monthlyReport.summary.status_counts.cancelled || 0, color: '#991b1b', bg: '#fef2f2' },
                        { label: 'Rejected', count: monthlyReport.summary.status_counts.rejected || 0, color: '#7f1d1d', bg: '#fff1f2' },
                        { label: 'No-Show', count: monthlyReport.summary.status_counts.no_show || 0, color: '#4b5563', bg: '#f3f4f6' },
                        { label: 'Rescheduled', count: monthlyReport.summary.status_counts.rescheduled || 0, color: '#4338ca', bg: '#eef2ff' },
                      ].map((item) => (
                        <div
                          key={item.label}
                          style={{
                            padding: '0.85rem 0.5rem',
                            borderRadius: 'var(--radius-sm)',
                            backgroundColor: item.bg,
                            border: `1px solid ${item.color}25`,
                          }}
                        >
                          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: item.color }}>
                            {item.count}
                          </div>
                          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: item.color, marginTop: '0.2rem' }}>
                            {item.label}
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>

                  {/* Rental Rate Category Breakdown */}
                  <Card
                    title="Rental Rate Category & Collection Breakdown"
                    subtitle="Revenue per standard municipal tier (Student ₱150, Timugan Resident ₱200, Outside ₱300)"
                  >
                    <div style={{ overflowX: 'auto' }}>
                      <table
                        style={{
                          width: '100%',
                          borderCollapse: 'collapse',
                          fontSize: '0.875rem',
                          textAlign: 'left',
                        }}
                      >
                        <thead>
                          <tr style={{ borderBottom: '2px solid var(--color-border)', backgroundColor: 'var(--color-surface-muted)' }}>
                            <th style={{ padding: '0.65rem 0.75rem' }}>Rate Category</th>
                            <th style={{ padding: '0.65rem 0.75rem' }}>Hourly Rate</th>
                            <th style={{ padding: '0.65rem 0.75rem', textAlign: 'right' }}>Total Bookings</th>
                            <th style={{ padding: '0.65rem 0.75rem', textAlign: 'right' }}>Total Hours</th>
                            <th style={{ padding: '0.65rem 0.75rem', textAlign: 'right' }}>Paid Bookings</th>
                            <th style={{ padding: '0.65rem 0.75rem', textAlign: 'right' }}>Cash Collected</th>
                          </tr>
                        </thead>
                        <tbody>
                          {monthlyReport.category_breakdown.map((cat) => (
                            <tr key={cat.rate_category} style={{ borderBottom: '1px solid var(--color-border)' }}>
                              <td style={{ padding: '0.75rem', fontWeight: 600 }}>
                                {cat.rate_category === 'student'
                                  ? 'Student Rate'
                                  : cat.rate_category === 'timugan_resident'
                                    ? 'Timugan Resident'
                                    : 'Outside Brgy. Timugan'}
                              </td>
                              <td style={{ padding: '0.75rem' }}>
                                ₱{Number(cat.hourly_rate).toLocaleString('en-PH', { minimumFractionDigits: 2 })}/hr
                              </td>
                              <td style={{ padding: '0.75rem', textAlign: 'right' }}>{cat.reservation_count}</td>
                              <td style={{ padding: '0.75rem', textAlign: 'right' }}>{cat.total_hours} hrs</td>
                              <td style={{ padding: '0.75rem', textAlign: 'right' }}>{cat.paid_count}</td>
                              <td style={{ padding: '0.75rem', textAlign: 'right', fontWeight: 700, color: '#065f46' }}>
                                ₱{Number(cat.total_cash_collected || 0).toLocaleString('en-PH', {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr style={{ backgroundColor: 'var(--color-surface-muted)', fontWeight: 700 }}>
                            <td style={{ padding: '0.75rem' }} colSpan={2}>
                              Totals for {formatYearMonthTitle(reportMonth)}
                            </td>
                            <td style={{ padding: '0.75rem', textAlign: 'right' }}>
                              {monthlyReport.summary.total_reservations}
                            </td>
                            <td style={{ padding: '0.75rem', textAlign: 'right' }}>
                              {monthlyReport.summary.total_booked_hours} hrs
                            </td>
                            <td style={{ padding: '0.75rem', textAlign: 'right' }}>
                              {monthlyReport.summary.paid_reservations_count}
                            </td>
                            <td style={{ padding: '0.75rem', textAlign: 'right', color: '#065f46', fontSize: '1rem' }}>
                              ₱{Number(monthlyReport.summary.total_cash_collected || 0).toLocaleString('en-PH', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </Card>

                  {/* Monthly Ledger Table */}
                  <Card
                    title={`Monthly Reservations & Cash Ledger (${monthlyReport.reservations.length} Records)`}
                    subtitle="Detailed chronological audit ledger of court bookings for this month"
                  >
                    {monthlyReport.reservations.length === 0 ? (
                      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                        No reservations recorded for {formatYearMonthTitle(reportMonth)}.
                      </div>
                    ) : (
                      <div style={{ overflowX: 'auto' }}>
                        <table
                          style={{
                            width: '100%',
                            borderCollapse: 'collapse',
                            fontSize: '0.8125rem',
                            textAlign: 'left',
                          }}
                        >
                          <thead>
                            <tr style={{ borderBottom: '2px solid var(--color-border)', backgroundColor: 'var(--color-surface-muted)' }}>
                              <th style={{ padding: '0.65rem 0.5rem' }}>Date & Time</th>
                              <th style={{ padding: '0.65rem 0.5rem' }}>Reference ID</th>
                              <th style={{ padding: '0.65rem 0.5rem' }}>Applicant</th>
                              <th style={{ padding: '0.65rem 0.5rem' }}>Tier & Duration</th>
                              <th style={{ padding: '0.65rem 0.5rem', textAlign: 'right' }}>Fee (₱)</th>
                              <th style={{ padding: '0.65rem 0.5rem' }}>Status</th>
                              <th style={{ padding: '0.65rem 0.5rem' }}>Payment</th>
                            </tr>
                          </thead>
                          <tbody>
                            {monthlyReport.reservations.map((res) => (
                              <tr key={res.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                <td style={{ padding: '0.65rem 0.5rem', whiteSpace: 'nowrap' }}>
                                  <strong>{res.reservation_date}</strong>
                                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                                    {formatTime12Hour(res.start_time)} – {formatTime12Hour(res.end_time)}
                                  </div>
                                </td>
                                <td style={{ padding: '0.65rem 0.5rem', fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>
                                  {res.id.slice(0, 8)}...
                                </td>
                                <td style={{ padding: '0.65rem 0.5rem' }}>
                                  <strong>{res.applicant_name}</strong>
                                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                                    {res.activity_type}
                                  </div>
                                </td>
                                <td style={{ padding: '0.65rem 0.5rem' }}>
                                  <div>
                                    {res.rate_category === 'student'
                                      ? 'Student (₱150/h)'
                                      : res.rate_category === 'timugan_resident'
                                        ? 'Resident (₱200/h)'
                                        : 'Outside (₱300/h)'}
                                  </div>
                                  <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                                    {res.duration_hours} hrs
                                  </div>
                                </td>
                                <td style={{ padding: '0.65rem 0.5rem', textAlign: 'right', fontWeight: 700 }}>
                                  ₱{Number(res.total_amount || 0).toLocaleString('en-PH', {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  })}
                                </td>
                                <td style={{ padding: '0.65rem 0.5rem' }}>
                                  <Badge status={res.status}>{res.status}</Badge>
                                </td>
                                <td style={{ padding: '0.65rem 0.5rem' }}>
                                  <Badge status={res.payment_status || 'pending_payment'} />
                                  {res.paid_at && (
                                    <div style={{ fontSize: '0.7rem', color: '#065f46', marginTop: '0.15rem' }}>
                                      {new Date(res.paid_at).toLocaleDateString()}
                                    </div>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </Card>

                  {/* Accounting Disclaimer / Audit Footnote */}
                  <div
                    style={{
                      padding: '1rem',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--color-surface-muted)',
                      border: '1px solid var(--color-border)',
                      fontSize: '0.8125rem',
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    <strong>Municipal Accounting Note:</strong> In strict compliance with Barangay Timugan Covered Court policy, all rental payments are accepted in <strong>Cash Only</strong> at the Barangay Office. Total cash collected calculations reflect exclusively transactions confirmed as <code>paid</code>. Approved but unpaid bookings are subject to automatic deadline cancellation and are never counted towards municipal revenues.
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* Confirmation Dialog for Official Reservation Actions */}
      <ConfirmDialog
        isOpen={actionModal.open}
        title={
          actionModal.action === 'approve'
            ? 'Approve Court Reservation'
            : actionModal.action === 'reject'
              ? 'Reject Court Reservation'
              : actionModal.action === 'cancel'
                ? 'Cancel Court Reservation'
                : actionModal.action === 'completed'
                  ? 'Mark Reservation as Completed'
                  : actionModal.action === 'no_show'
                    ? 'Mark Reservation as No-Show'
                    : 'Reschedule Court Reservation'
        }
        description={
          actionModal.reservation
            ? `Applicant: ${actionModal.reservation.applicant_name} • Current Slot: ${actionModal.reservation.reservation_date} (${formatTime12Hour(actionModal.reservation.start_time)} – ${formatTime12Hour(actionModal.reservation.end_time)}).`
            : ''
        }
        confirmLabel={`Confirm ${actionModal.action.replace('_', ' ')}`}
        variant={['reject', 'cancel', 'no_show'].includes(actionModal.action) ? 'danger' : 'primary'}
        loading={actionModal.submitting}
        onCancel={() =>
          setActionModal((prev) => ({
            ...prev,
            open: false,
            reservation: null,
          }))
        }
        onConfirm={handleConfirmOfficialAction}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.75rem' }}>
          {actionModal.action === 'reschedule' && (
            <div className="form-row form-row-3">
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" htmlFor="resched-date">
                  New Date *
                </label>
                <input
                  id="resched-date"
                  type="date"
                  className="form-input"
                  min={todayStr}
                  value={actionModal.newDate}
                  onChange={(e) =>
                    setActionModal((prev) => ({ ...prev, newDate: e.target.value }))
                  }
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" htmlFor="resched-start">
                  New Start *
                </label>
                <input
                  id="resched-start"
                  type="time"
                  className="form-input"
                  value={actionModal.newStartTime}
                  onChange={(e) =>
                    setActionModal((prev) => ({ ...prev, newStartTime: e.target.value }))
                  }
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" htmlFor="resched-end">
                  New End *
                </label>
                <input
                  id="resched-end"
                  type="time"
                  className="form-input"
                  value={actionModal.newEndTime}
                  onChange={(e) =>
                    setActionModal((prev) => ({ ...prev, newEndTime: e.target.value }))
                  }
                />
              </div>
            </div>
          )}

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" htmlFor="action-reason-input">
              {['reject', 'cancel', 'reschedule'].includes(actionModal.action)
                ? 'Official Decision / Status Reason (Required) *'
                : 'Official Decision Note (Visible to Applicant)'}
            </label>
            <input
              id="action-reason-input"
              type="text"
              className="form-input"
              placeholder="Enter official reason or decision note..."
              value={actionModal.statusReason}
              onChange={(e) =>
                setActionModal((prev) => ({ ...prev, statusReason: e.target.value }))
              }
            />
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" htmlFor="action-admin-notes">
              Internal Official Notes (Private — Never Visible to Residents)
            </label>
            <input
              id="action-admin-notes"
              type="text"
              className="form-input"
              placeholder="Internal barangay log notes..."
              value={actionModal.adminNotes}
              onChange={(e) =>
                setActionModal((prev) => ({ ...prev, adminNotes: e.target.value }))
              }
            />
          </div>
        </div>
      </ConfirmDialog>

      {/* Confirmation Dialog for Creating Court Closure */}
      <ConfirmDialog
        isOpen={closureConfirmOpen}
        title="Confirm Court Facility Closure"
        description={`You are closing ${SINGLE_FACILITY_NAME} on ${closureForm.closureDate} from ${formatTime12Hour(closureForm.startTime)} to ${formatTime12Hour(closureForm.endTime)} for '${closureForm.closureType}' (${closureForm.reason}). Residents will be blocked from reserving overlapping slots.`}
        confirmLabel="Confirm & Publish Closure"
        variant="danger"
        loading={closureSubmitting}
        onCancel={() => setClosureConfirmOpen(false)}
        onConfirm={handleConfirmCreateClosure}
      />

      {/* Confirmation Dialog for Deactivating Court Closure */}
      <ConfirmDialog
        isOpen={Boolean(deactivateTargetClosure)}
        title="Deactivate Court Closure & Re-open Facility"
        description={
          deactivateTargetClosure
            ? `Re-open ${SINGLE_FACILITY_NAME} on ${deactivateTargetClosure.closure_date} (${formatTime12Hour(deactivateTargetClosure.start_time)} – ${formatTime12Hour(deactivateTargetClosure.end_time)})?`
            : ''
        }
        confirmLabel="Deactivate Closure"
        variant="primary"
        loading={closureSubmitting}
        onCancel={() => setDeactivateTargetClosure(null)}
        onConfirm={handleConfirmDeactivateClosure}
      />

      {/* Confirmation Dialog for Confirming Cash Payment */}
      <ConfirmDialog
        open={paymentModalOpen}
        title="Confirm Cash Payment?"
        description={`Confirm that the applicant has physically paid in cash at the Barangay Office for reservation ${selectedReservation?.id} (${selectedReservation?.applicant_name}, ${selectedReservation?.reservation_date}).`}
        confirmLabel="Confirm Payment as Paid"
        cancelLabel="Cancel"
        variant="primary"
        loading={confirmingPayment}
        onCancel={() => setPaymentModalOpen(false)}
        onConfirm={handleConfirmCashPayment}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.875rem' }}>
          <Alert type="info" title="Cash Payment Verification">
            Physical cash payments must be received and verified at the Barangay Hall. Marking as Paid will permanently record your official user ID as the confirming official and update the resident's schedule status.
          </Alert>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" htmlFor="pay-notes">
              Official Notes / Receipt Number (Optional)
            </label>
            <input
              id="pay-notes"
              type="text"
              className="form-input"
              placeholder="e.g. Official Receipt (OR) #12345 received at Barangay Treasury"
              value={paymentNotes}
              onChange={(e) => setPaymentNotes(e.target.value)}
              disabled={confirmingPayment}
            />
          </div>
        </div>
      </ConfirmDialog>
    </div>
  )
}

export default OfficialDashboardPage
