import { supabase } from '../lib/supabaseClient.js'
import { sanitizeAuthError } from '../utils/authorization.js'
import { getLocalTodayDateString } from './reservationService.js'
import { emitRealtimeSyncSignal } from './realtimeManager.js'

export const CLOSURE_TYPES = [
  { value: 'maintenance', label: 'Facility Maintenance' },
  { value: 'barangay_event', label: 'Official Barangay Event / Assembly' },
  { value: 'repair', label: 'Court Floor / Lighting Repair' },
  { value: 'weather_emergency', label: 'Weather / Evacuation Emergency' },
  { value: 'holiday', label: 'Public / Barangay Holiday Closure' },
  { value: 'other', label: 'Other Official Barangay Purpose' },
]

export const OPERATING_HOUR_SLOTS = [
  { startTime: '06:00', endTime: '08:00', label: '06:00 AM – 08:00 AM' },
  { startTime: '08:00', endTime: '10:00', label: '08:00 AM – 10:00 AM' },
  { startTime: '10:00', endTime: '12:00', label: '10:00 AM – 12:00 PM' },
  { startTime: '12:00', endTime: '14:00', label: '12:00 PM – 02:00 PM' },
  { startTime: '14:00', endTime: '16:00', label: '02:00 PM – 04:00 PM' },
  { startTime: '16:00', endTime: '18:00', label: '04:00 PM – 06:00 PM' },
  { startTime: '18:00', endTime: '20:00', label: '06:00 PM – 08:00 PM' },
  { startTime: '20:00', endTime: '22:00', label: '08:00 PM – 10:00 PM' },
]

export const OFFICIAL_RESERVATION_COLUMNS = [
  'id',
  'user_id',
  'facility_name',
  'applicant_name',
  'applicant_mobile',
  'residency_type',
  'reservation_date',
  'start_time',
  'end_time',
  'activity_type',
  'purpose',
  'expected_attendees',
  'address_province',
  'address_city',
  'address_barangay',
  'address_purok_street',
  'address_house_details',
  'address',
  'status',
  'reviewed_by',
  'reviewed_at',
  'status_reason',
  'admin_notes',
  'rescheduled_from_id',
  'payment_status',
  'payment_method',
  'payment_due_at',
  'paid_at',
  'paid_confirmed_by',
  'is_student',
  'rate_category',
  'hourly_rate',
  'total_amount',
  'created_at',
  'updated_at',
].join(', ')

/**
 * Fetches reservations, court closures, and recent activity logs for the Official Dashboard.
 * Enforced server-side by Supabase RLS (reservations_select_own_or_official, etc.).
 */
export async function fetchOfficialDashboardData() {
  const todayStr = getLocalTodayDateString()

  // Trigger server-side sweep of expired unpaid reservations
  try {
    await supabase.rpc('cancel_expired_unpaid_reservations')
  } catch {
    // Non-blocking cleanup
  }

  const [resQuery, closuresQuery, auditQuery] = await Promise.all([
    supabase
      .from('reservations')
      .select(OFFICIAL_RESERVATION_COLUMNS)
      .order('reservation_date', { ascending: false })
      .order('start_time', { ascending: true }),
    supabase
      .from('court_closures')
      .select('*')
      .order('closure_date', { ascending: false })
      .order('start_time', { ascending: true }),
    supabase
      .from('audit_logs')
      .select('id, actor_id, actor_role, action, entity_type, entity_id, target_user_id, details, created_at')
      .in('entity_type', ['reservation', 'court_closure'])
      .order('created_at', { ascending: false })
      .limit(35),
  ])

  if (resQuery.error) {
    return {
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
      error: sanitizeAuthError(resQuery.error, 'official'),
    }
  }

  const reservations = resQuery.data || []
  const closures = closuresQuery.data || []
  const auditLogs = auditQuery.data || []

  const pendingCount = reservations.filter((r) => r.status === 'pending').length
  const approvedCount = reservations.filter((r) => r.status === 'approved').length

  const todayReservations = reservations
    .filter((r) => r.reservation_date === todayStr)
    .sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)))

  const upcomingReservations = reservations
    .filter(
      (r) =>
        r.reservation_date >= todayStr &&
        ['pending', 'approved', 'rescheduled'].includes(r.status)
    )
    .sort((a, b) => {
      const dateCmp = String(a.reservation_date).localeCompare(String(b.reservation_date))
      if (dateCmp !== 0) return dateCmp
      return String(a.start_time).localeCompare(String(b.start_time))
    })

  const activeClosuresCount = closures.filter(
    (c) => c.is_active === true && c.closure_date >= todayStr
  ).length

  return {
    reservations,
    closures,
    auditLogs,
    summary: {
      pendingCount,
      approvedCount,
      todayCount: todayReservations.length,
      upcomingCount: upcomingReservations.length,
      activeClosuresCount,
    },
    todayReservations,
    upcomingReservations,
    error: null,
  }
}

/**
 * Client-side filtering & search helper for the Official Reservation Management table.
 */
export function filterOfficialReservations(
  reservations = [],
  { statusFilter = 'all', dateMode = 'all', customDate = '', searchQuery = '' } = {}
) {
  const todayStr = getLocalTodayDateString()
  const q = String(searchQuery || '').trim().toLowerCase()

  return reservations.filter((r) => {
    if (statusFilter !== 'all' && r.status !== statusFilter) {
      return false
    }

    if (dateMode === 'today' && r.reservation_date !== todayStr) {
      return false
    }
    if (dateMode === 'upcoming' && r.reservation_date < todayStr) {
      return false
    }
    if (dateMode === 'custom' && customDate && r.reservation_date !== customDate) {
      return false
    }

    if (q) {
      const haystack = [
        r.id,
        r.applicant_name,
        r.applicant_mobile,
        r.purpose,
        r.activity_type,
        r.address,
        r.address_purok_street,
        r.address_barangay,
        r.status,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      if (!haystack.includes(q)) {
        return false
      }
    }

    return true
  })
}

/**
 * Processes an official reservation action (approve, reject, cancel, completed, no_show, reschedule).
 * Enforced by public.official_process_reservation RPC and PostgreSQL RLS.
 */
export async function processOfficialReservationAction({
  reservationId,
  action,
  statusReason = '',
  adminNotes = null,
  newDate = null,
  newStartTime = null,
  newEndTime = null,
}) {
  if (!reservationId) {
    return {
      success: false,
      error: 'Reservation ID is required.',
    }
  }

  const validActions = ['approve', 'reject', 'cancel', 'completed', 'no_show', 'reschedule']
  if (!validActions.includes(action)) {
    return {
      success: false,
      error: 'Invalid official reservation action.',
    }
  }

  if (['reject', 'cancel', 'reschedule'].includes(action) && String(statusReason || '').trim().length < 3) {
    return {
      success: false,
      error: `Please provide a clear reason (at least 3 characters) when choosing to ${action} a reservation.`,
    }
  }

  if (action === 'reschedule') {
    if (!newDate || !newStartTime || !newEndTime) {
      return {
        success: false,
        error: 'Please select a new date, start time, and end time for rescheduling.',
      }
    }
    if (newEndTime <= newStartTime) {
      return {
        success: false,
        error: 'New end time must be later than new start time.',
      }
    }
  }

  const normalizeTimeStr = (t) => {
    if (!t) return null
    const clean = String(t).trim()
    return clean.length === 5 ? `${clean}:00` : clean
  }

  const { data, error } = await supabase.rpc('official_process_reservation', {
    p_reservation_id: reservationId,
    p_action: action,
    p_status_reason: String(statusReason || '').trim() || null,
    p_admin_notes: adminNotes !== null ? String(adminNotes || '').trim() : null,
    p_new_date: newDate || null,
    p_new_start_time: normalizeTimeStr(newStartTime),
    p_new_end_time: normalizeTimeStr(newEndTime),
  })

  if (error) {
    const rawMsg = String(error.message || '')
    if (
      rawMsg.includes('Validation error:') ||
      rawMsg.includes('Reservation conflict:') ||
      rawMsg.includes('Security violation:')
    ) {
      return {
        success: false,
        error: rawMsg
          .replace('Validation error: ', '')
          .replace('Reservation conflict: ', '')
          .replace('Security violation: ', ''),
      }
    }
    return {
      success: false,
      error: sanitizeAuthError(error, 'official'),
    }
  }

  if (data) {
    emitRealtimeSyncSignal({
      topic: 'reservation_updated',
      affectedDate: data.reservation_date,
      reservationId: data.id,
      userId: data.user_id,
      status: data.status,
      changeKind: `official_${action}`,
    })
  }

  return {
    success: true,
    reservation: data,
  }
}

/**
 * Confirms physical cash payment made by resident at Barangay Office.
 * Invokes official_confirm_cash_payment RPC with verified official authorization check.
 */
export async function confirmOfficialCashPayment({ reservationId, adminNotes = null }) {
  if (!reservationId) {
    return { success: false, error: 'Reservation ID is required.' }
  }

  const { data, error } = await supabase.rpc('official_confirm_cash_payment', {
    p_reservation_id: reservationId,
    p_admin_notes: adminNotes !== null ? String(adminNotes || '').trim() : null,
  })

  if (error) {
    const rawMsg = String(error.message || '')
    if (
      rawMsg.includes('Validation error:') ||
      rawMsg.includes('Security violation:') ||
      rawMsg.includes('Not found:')
    ) {
      return {
        success: false,
        error: rawMsg
          .replace('Validation error: ', '')
          .replace('Security violation: ', '')
          .replace('Not found: ', ''),
      }
    }
    return {
      success: false,
      error: sanitizeAuthError(error, 'official'),
    }
  }

  if (data) {
    emitRealtimeSyncSignal({
      topic: 'reservation_updated',
      affectedDate: data.reservation_date,
      reservationId: data.id,
      userId: data.user_id,
      status: data.status,
      changeKind: 'payment_confirmed',
    })
  }

  return {
    success: true,
    reservation: data,
  }
}

/**
 * Creates a court closure for Timugan Main Covered Court via official_create_court_closure RPC.
 * Requires canManageCourtClosures / canManageCourt permission.
 */
export async function createOfficialCourtClosure({
  closureDate,
  startTime,
  endTime,
  closureType = 'maintenance',
  reason = '',
}) {
  if (!closureDate || !startTime || !endTime) {
    return {
      success: false,
      error: 'Closure date, start time, and end time are required.',
    }
  }

  if (endTime <= startTime) {
    return {
      success: false,
      error: 'Closure end time must be later than start time.',
    }
  }

  if (String(reason || '').trim().length < 3) {
    return {
      success: false,
      error: 'Please provide a clear official reason (at least 3 characters) for closing the court.',
    }
  }

  const normalizeTimeStr = (t) => {
    const clean = String(t).trim()
    return clean.length === 5 ? `${clean}:00` : clean
  }

  const { data, error } = await supabase.rpc('official_create_court_closure', {
    p_closure_date: closureDate,
    p_start_time: normalizeTimeStr(startTime),
    p_end_time: normalizeTimeStr(endTime),
    p_closure_type: closureType,
    p_reason: String(reason).trim(),
  })

  if (error) {
    const rawMsg = String(error.message || '')
    if (
      rawMsg.includes('Validation error:') ||
      rawMsg.includes('Schedule conflict:') ||
      rawMsg.includes('Security violation:')
    ) {
      return {
        success: false,
        error: rawMsg
          .replace('Validation error: ', '')
          .replace('Schedule conflict: ', '')
          .replace('Security violation: ', ''),
      }
    }
    if (rawMsg.includes('court_closures_no_overlap_excl') || rawMsg.includes('23P01')) {
      return {
        success: false,
        error: 'An active court closure already overlaps with this date and time range.',
      }
    }
    return {
      success: false,
      error: sanitizeAuthError(error, 'official'),
    }
  }

  if (data) {
    emitRealtimeSyncSignal({
      topic: 'closure_updated',
      affectedDate: data.closure_date,
      closureId: data.id,
      changeKind: 'closure_created',
    })
  }

  return {
    success: true,
    closure: data,
  }
}

/**
 * Deactivates an active court closure so the time slot becomes available again.
 */
export async function deactivateOfficialCourtClosure(closureId) {
  if (!closureId) {
    return {
      success: false,
      error: 'Closure ID is required.',
    }
  }

  const { data, error } = await supabase.rpc('official_deactivate_court_closure', {
    p_closure_id: closureId,
  })

  if (error) {
    return {
      success: false,
      error: sanitizeAuthError(error, 'official'),
    }
  }

  if (data) {
    emitRealtimeSyncSignal({
      topic: 'closure_updated',
      affectedDate: data.closure_date,
      closureId: data.id,
      changeKind: 'closure_deactivated',
    })
  }

  return {
    success: true,
    closure: data,
  }
}

/**
 * Fetches the Official Monthly Reservation & Earnings Report.
 * Restricted to officials with canViewReports permission via database-enforced RPC.
 */
export async function fetchMonthlyReservationReport({ year, month }) {
  const current = new Date()
  const qYear = Number(year) || current.getFullYear()
  const qMonth = Number(month) || current.getMonth() + 1

  const { data, error } = await supabase.rpc('get_monthly_reservation_report', {
    p_year: qYear,
    p_month: qMonth,
  })

  if (error) {
    return {
      success: false,
      report: null,
      error: sanitizeAuthError(error, 'official'),
    }
  }

  return {
    success: true,
    report: data,
    data,
    error: null,
  }
}
