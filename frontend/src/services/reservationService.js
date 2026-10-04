import { supabase } from '../lib/supabaseClient.js'
import { isValidPhMobileNumber, normalizeMobileNumber } from '../utils/authorization.js'
import { emitRealtimeSyncSignal } from './realtimeManager.js'

export const SINGLE_FACILITY_NAME = 'Timugan Main Covered Court'

export const RESERVATION_STATUSES = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
  COMPLETED: 'completed',
  NO_SHOW: 'no_show',
  RESCHEDULED: 'rescheduled',
})

export const PAYMENT_STATUSES = Object.freeze({
  PENDING_PAYMENT: 'pending_payment',
  PAID: 'paid',
})

export const STANDARD_DAILY_SLOTS = Object.freeze([
  { id: 'slot-06-08', startTime: '06:00', endTime: '08:00', label: '06:00 AM – 08:00 AM' },
  { id: 'slot-08-10', startTime: '08:00', endTime: '10:00', label: '08:00 AM – 10:00 AM' },
  { id: 'slot-10-12', startTime: '10:00', endTime: '12:00', label: '10:00 AM – 12:00 PM' },
  { id: 'slot-12-14', startTime: '12:00', endTime: '14:00', label: '12:00 PM – 02:00 PM' },
  { id: 'slot-14-16', startTime: '14:00', endTime: '16:00', label: '02:00 PM – 04:00 PM' },
  { id: 'slot-16-18', startTime: '16:00', endTime: '18:00', label: '04:00 PM – 06:00 PM' },
  { id: 'slot-18-20', startTime: '18:00', endTime: '20:00', label: '06:00 PM – 08:00 PM' },
  { id: 'slot-20-22', startTime: '20:00', endTime: '22:00', label: '08:00 PM – 10:00 PM' },
])

// Safe columns returned to residents for their own reservations (excludes internal admin_notes)
const RESIDENT_RESERVATION_COLUMNS = [
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
  'status_reason',
  'reviewed_at',
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
 * Calculates court reservation fee on the client side for UI estimation/preview.
 * The final authoritative fee is always calculated and locked server-side/database-side.
 */
export function calculateClientReservationFee({
  isStudent = false,
  residencyType = 'timugan_resident',
  startTime = '08:00',
  endTime = '10:00',
} = {}) {
  const sMinutes = timeStringToMinutes(startTime)
  const eMinutes = timeStringToMinutes(endTime)
  const durationHours = !Number.isNaN(sMinutes) && !Number.isNaN(eMinutes) && eMinutes > sMinutes
    ? Math.round(((eMinutes - sMinutes) / 60) * 100) / 100
    : 1.0

  let rateCategory = 'timugan_resident'
  let hourlyRate = 200.0

  if (Boolean(isStudent) === true) {
    rateCategory = 'student'
    hourlyRate = 150.0
  } else if (residencyType === 'timugan_resident') {
    rateCategory = 'timugan_resident'
    hourlyRate = 200.0
  } else {
    rateCategory = 'outside_timugan'
    hourlyRate = 300.0
  }

  const totalAmount = Math.round(durationHours * hourlyRate * 100) / 100

  return {
    rateCategory,
    hourlyRate,
    durationHours,
    totalAmount,
  }
}

// Tracks in-flight reservation submissions to prevent duplicate double-click submissions
const inFlightSubmissionKeys = new Set()

/**
 * Returns today's date in YYYY-MM-DD local format.
 */
export function getLocalTodayDateString(referenceDate = new Date()) {
  const year = referenceDate.getFullYear()
  const month = String(referenceDate.getMonth() + 1).padStart(2, '0')
  const day = String(referenceDate.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Normalizes HH:MM or HH:MM:SS into minutes since midnight for reliable time comparisons.
 */
export function timeStringToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return NaN
  const parts = timeStr.trim().split(':')
  if (parts.length < 2) return NaN
  const hours = Number(parts[0])
  const minutes = Number(parts[1])
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return NaN
  return hours * 60 + minutes
}

/**
 * Formats HH:MM or HH:MM:SS into readable 12-hour format (e.g. "08:00 AM").
 */
export function formatTime12Hour(timeStr) {
  if (!timeStr) return '—'
  const [hStr, mStr] = String(timeStr).split(':')
  const hour24 = Number(hStr)
  const minute = mStr || '00'
  if (Number.isNaN(hour24)) return timeStr
  const period = hour24 >= 12 ? 'PM' : 'AM'
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12
  return `${String(hour12).padStart(2, '0')}:${minute} ${period}`
}

/**
 * Checks whether two [start, end) time intervals overlap.
 */
export function doTimeIntervalsOverlap(startA, endA, startB, endB) {
  const sA = timeStringToMinutes(startA)
  const eA = timeStringToMinutes(endA)
  const sB = timeStringToMinutes(startB)
  const eB = timeStringToMinutes(endB)
  if ([sA, eA, sB, eB].some((v) => Number.isNaN(v))) return false
  return sA < eB && sB < eA
}

/**
 * Validates UUID v4/standard format to guard against malformed IDOR parameters.
 */
export function isValidUuid(value) {
  if (!value || typeof value !== 'string') return false
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim())
}

/**
 * Builds the formatted full address from structured Barangay address fields.
 */
export function formatStructuredAddress({
  houseDetails = '',
  purok = '',
  barangay = 'Timugan',
  city = 'Los Baños',
  province = 'Laguna',
}) {
  return [
    String(houseDetails || '').trim(),
    String(purok || '').trim(),
    barangay ? `Brgy. ${String(barangay).trim()}` : '',
    String(city || '').trim(),
    String(province || '').trim(),
  ]
    .filter(Boolean)
    .join(', ')
}

/**
 * Validates all reservation form fields on the client before availability check or submission.
 * Supports residents from Timugan, other Los Baños barangays, and outside Los Baños.
 */
export function validateReservationInput(formData, todayStr = getLocalTodayDateString()) {
  const errors = {}

  if (!formData) {
    return { valid: false, errors: { form: 'Reservation form data is required.' }, firstError: 'Reservation form data is required.' }
  }

  const dateStr = String(formData.date || '').trim()
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    errors.date = 'Please select a valid reservation date.'
  } else if (dateStr < todayStr) {
    errors.date = 'Reservation date cannot be in the past. Please choose today or a future date.'
  }

  const startMins = timeStringToMinutes(formData.startTime)
  const endMins = timeStringToMinutes(formData.endTime)

  if (Number.isNaN(startMins)) {
    errors.startTime = 'Please select a valid start time.'
  }
  if (Number.isNaN(endMins)) {
    errors.endTime = 'Please select a valid end time.'
  }

  if (!Number.isNaN(startMins) && !Number.isNaN(endMins)) {
    if (endMins <= startMins) {
      errors.endTime = 'End time must be later than start time.'
    } else if (startMins < 6 * 60 || endMins > 22 * 60) {
      errors.timeRange = 'Reservations must fall within court operating hours (06:00 AM to 10:00 PM).'
    } else if (endMins - startMins < 60) {
      errors.timeRange = 'Minimum reservation duration is 1 hour.'
    } else if (endMins - startMins > 8 * 60) {
      errors.timeRange = 'Maximum reservation duration per booking is 8 hours.'
    }
  }

  const fullName = String(formData.fullName || '').trim()
  if (fullName.length < 2 || fullName.length > 120) {
    errors.fullName = 'Please enter the applicant full name (2 to 120 characters).'
  }

  if (!isValidPhMobileNumber(formData.mobileNumber)) {
    errors.mobileNumber = 'Please enter a valid 11-digit Philippine mobile number (e.g., 09171234567).'
  }

  const allowedResidency = ['timugan_resident', 'los_banos_resident', 'non_resident']
  if (!allowedResidency.includes(formData.residencyType)) {
    errors.residencyType = 'Please select a valid residency classification.'
  }

  if (String(formData.province || '').trim().length < 2) {
    errors.province = 'Province is required.'
  }
  if (String(formData.city || '').trim().length < 2) {
    errors.city = 'Municipality / City is required.'
  }
  if (String(formData.barangay || '').trim().length < 2) {
    errors.barangay = 'Barangay is required.'
  }
  if (!String(formData.purok || '').trim()) {
    errors.purok = 'Street, Purok, or Zone is required.'
  }

  const activityType = String(formData.activityType || '').trim()
  if (activityType.length < 2) {
    errors.activityType = 'Please select an activity type.'
  }

  const purpose = String(formData.purposeDescription || '').trim()
  if (purpose.length < 5 || purpose.length > 1000) {
    errors.purposeDescription = 'Please describe the purpose of your reservation (at least 5 characters).'
  }

  if (formData.expectedAttendees !== '' && formData.expectedAttendees !== null && formData.expectedAttendees !== undefined) {
    const attendees = Number(formData.expectedAttendees)
    if (!Number.isInteger(attendees) || attendees < 1 || attendees > 500) {
      errors.expectedAttendees = 'Expected attendees must be a whole number between 1 and 500.'
    }
  }

  const firstError = Object.values(errors)[0] || null
  return {
    valid: Object.keys(errors).length === 0,
    errors,
    firstError,
  }
}

/**
 * Translates technical database/Supabase errors into clear, safe user feedback.
 */
export function sanitizeReservationError(error) {
  if (!error) return 'Unable to process reservation request. Please try again.'
  const msg = String(error.message || error.details || error.hint || '').toLowerCase()
  const code = String(error.code || '')

  if (
    code === '23P01' ||
    msg.includes('reservations_no_double_booking_excl') ||
    msg.includes('overlaps with an existing') ||
    msg.includes('overlaps with an already approved')
  ) {
    return 'This time slot is no longer available because an overlapping reservation was already submitted or approved. Please choose another schedule.'
  }

  if (msg.includes('closed during the') || msg.includes('court_closed')) {
    return 'Timugan Main Covered Court is closed during the selected date and time slot. Please choose another schedule.'
  }

  if (msg.includes('past')) {
    return 'Reservations cannot be created or modified for past dates.'
  }

  if (msg.includes('end time must be later')) {
    return 'End time must be later than start time.'
  }

  if (msg.includes('operating hours')) {
    return 'Reservations must be scheduled within operating hours (06:00 AM to 10:00 PM).'
  }

  if (msg.includes('security violation') || msg.includes('row-level security') || code === '42501') {
    return 'You are not authorized to perform this reservation action.'
  }

  return 'Unable to complete the reservation request right now. Please check your schedule details and try again.'
}

/**
 * Fetches safe public schedule entries (pending, reserved, closed) for a date range.
 * Never exposes applicant name, phone, address, private purpose, or internal notes.
 */
export async function fetchPublicScheduleRange(startDateStr, endDateStr) {
  const { data: rpcData, error: rpcError } = await supabase.rpc('get_public_court_schedule', {
    p_start_date: startDateStr,
    p_end_date: endDateStr,
  })

  if (!rpcError && Array.isArray(rpcData)) {
    return {
      slots: rpcData.map((row) => ({
        slotDate: row.slot_date,
        startTime: String(row.start_time || '').slice(0, 5),
        endTime: String(row.end_time || '').slice(0, 5),
        facilityName: row.facility_name || SINGLE_FACILITY_NAME,
        status: row.slot_status,
        publicLabel:
          row.slot_status === 'closed'
            ? row.public_label || 'Facility Closed / Maintenance'
            : row.slot_status === 'reserved'
              ? 'Reserved'
              : 'Application Under Review',
      })),
      error: null,
    }
  }

  // Do not fall back to the private closures table. A missing safe RPC is an
  // unavailable schedule, not a reason to expose internal closure notes.
  return { slots: [], error: rpcError }
}

/**
 * Checks whether a specific date and [startTime, endTime) slot is available on the single court.
 * Checks both existing reservations and court closures without exposing private data.
 */
export async function checkSlotAvailability({ date, startTime, endTime }) {
  const todayStr = getLocalTodayDateString()
  if (!date || date < todayStr) {
    return {
      available: false,
      conflictType: 'past_date',
      message: 'Reservations cannot be scheduled for past dates.',
    }
  }

  if (timeStringToMinutes(endTime) <= timeStringToMinutes(startTime)) {
    return {
      available: false,
      conflictType: 'invalid_time_range',
      message: 'End time must be later than start time.',
    }
  }

  // 1. Try atomic database availability RPC if available
  const { data: rpcResult, error: rpcError } = await supabase.rpc('check_court_slot_availability', {
    p_date: date,
    p_start_time: `${startTime.slice(0, 5)}:00`,
    p_end_time: `${endTime.slice(0, 5)}:00`,
  })

  if (!rpcError && rpcResult && typeof rpcResult === 'object') {
    return {
      available: Boolean(rpcResult.available),
      conflictType: rpcResult.conflict_type || null,
      message:
        rpcResult.message ||
        (rpcResult.available
          ? 'This schedule at Timugan Main Covered Court is available.'
          : 'The selected schedule is unavailable.'),
    }
  }

  // 2. Also evaluate against public schedule RPC / court_closures
  const { slots: busySlots, error: scheduleError } = await fetchPublicScheduleRange(date, date)
  if (scheduleError) {
    return {
      available: false,
      conflictType: 'server_error',
      message: 'Unable to verify court availability right now. Please try again.',
    }
  }

  const overlappingSlot = busySlots.find((slot) =>
    doTimeIntervalsOverlap(startTime, endTime, slot.startTime, slot.endTime)
  )

  if (overlappingSlot) {
    if (overlappingSlot.status === 'closed') {
      return {
        available: false,
        conflictType: 'court_closed',
        message: `Timugan Main Covered Court is closed during ${formatTime12Hour(overlappingSlot.startTime)} – ${formatTime12Hour(overlappingSlot.endTime)} (${overlappingSlot.publicLabel}).`,
      }
    }
    if (overlappingSlot.status === 'reserved') {
      return {
        available: false,
        conflictType: 'slot_reserved',
        message: `The selected time overlaps with an approved reservation (${formatTime12Hour(overlappingSlot.startTime)} – ${formatTime12Hour(overlappingSlot.endTime)}). Please choose another time slot.`,
      }
    }
    return {
      available: false,
      conflictType: 'slot_pending',
      message: `Another reservation request is already pending review for ${formatTime12Hour(overlappingSlot.startTime)} – ${formatTime12Hour(overlappingSlot.endTime)}. Please select an open slot.`,
    }
  }

  return {
    available: true,
    conflictType: null,
    message: 'Selected schedule is available for reservation.',
  }
}

/**
 * Builds a complete daily public schedule grid for CalendarPage.jsx, merging standard
 * 2-hour civic blocks with live database reservations and court closures.
 */
export async function getDailyPublicScheduleSlots(dateStr) {
  const { slots: busyIntervals, error } = await fetchPublicScheduleRange(dateStr, dateStr)

  const dailySlots = STANDARD_DAILY_SLOTS.map((block) => {
    const overlapping = busyIntervals.find((busy) =>
      doTimeIntervalsOverlap(block.startTime, block.endTime, busy.startTime, busy.endTime)
    )

    if (!overlapping) {
      return {
        id: `${dateStr}-${block.id}`,
        date: dateStr,
        startTime: block.startTime,
        endTime: block.endTime,
        timeLabel: block.label,
        courtName: SINGLE_FACILITY_NAME,
        status: 'available',
        publicLabel: 'Open for Reservation',
      }
    }

    return {
      id: `${dateStr}-${block.id}`,
      date: dateStr,
      startTime: block.startTime,
      endTime: block.endTime,
      timeLabel: block.label,
      courtName: SINGLE_FACILITY_NAME,
      status: overlapping.status,
      publicLabel:
        overlapping.status === 'closed'
          ? overlapping.publicLabel
          : overlapping.status === 'reserved'
            ? 'Reserved (Schedule Unavailable)'
            : 'Application Under Review',
    }
  })

  return {
    slots: dailySlots,
    busyIntervals,
    error,
  }
}

/**
 * Submits a new court reservation for the authenticated resident.
 * Enforces:
 * - User authentication check
 * - Duplicate submission lock
 * - Pre-submission validation & availability check
 * - Initial status strictly set to 'pending'
 * - Database-enforced RLS and GiST double-booking protection
 */
export async function submitCourtReservation({ userId, formData }) {
  if (!userId) {
    return {
      success: false,
      error: 'You must be signed in to submit a court reservation.',
      errorType: 'unauthorized',
    }
  }

  const validation = validateReservationInput(formData)
  if (!validation.valid) {
    return {
      success: false,
      error: validation.firstError,
      validationErrors: validation.errors,
      errorType: 'validation',
    }
  }

  const cleanDate = String(formData.date).trim()
  const cleanStart = `${String(formData.startTime).trim().slice(0, 5)}:00`
  const cleanEnd = `${String(formData.endTime).trim().slice(0, 5)}:00`
  const dedupeKey = `${userId}:${cleanDate}:${cleanStart}:${cleanEnd}`

  if (inFlightSubmissionKeys.has(dedupeKey)) {
    return {
      success: false,
      error: 'Your reservation request for this schedule is already being submitted. Please wait.',
      errorType: 'duplicate_submission',
    }
  }

  inFlightSubmissionKeys.add(dedupeKey)

  try {
    // Verify live availability before insert
    const availability = await checkSlotAvailability({
      date: cleanDate,
      startTime: cleanStart,
      endTime: cleanEnd,
    })

    if (!availability.available) {
      return {
        success: false,
        error: availability.message,
        conflictType: availability.conflictType,
        errorType: 'unavailable',
      }
    }

    const formattedAddress = formatStructuredAddress({
      houseDetails: formData.houseDetails,
      purok: formData.purok,
      barangay: formData.barangay,
      city: formData.city,
      province: formData.province,
    })

    const insertPayload = {
      user_id: userId,
      facility_name: SINGLE_FACILITY_NAME,
      applicant_name: String(formData.fullName).trim(),
      applicant_mobile: normalizeMobileNumber(formData.mobileNumber),
      residency_type: formData.residencyType || 'timugan_resident',
      is_student: Boolean(formData.isStudent),
      reservation_date: cleanDate,
      start_time: cleanStart,
      end_time: cleanEnd,
      activity_type: String(formData.activityType).trim(),
      purpose: String(formData.purposeDescription).trim(),
      expected_attendees: formData.expectedAttendees ? Number(formData.expectedAttendees) : null,
      address_province: String(formData.province).trim(),
      address_city: String(formData.city).trim(),
      address_barangay: String(formData.barangay).trim(),
      address_purok_street: String(formData.purok).trim(),
      address_house_details: String(formData.houseDetails || '').trim() || null,
      address: formattedAddress,
      status: RESERVATION_STATUSES.PENDING,
    }

    const { data, error } = await supabase
      .from('reservations')
      .insert(insertPayload)
      .select(RESIDENT_RESERVATION_COLUMNS)
      .single()

    if (error) {
      return {
        success: false,
        error: sanitizeReservationError(error),
        errorType: 'database',
      }
    }

    emitRealtimeSyncSignal({
      topic: 'reservation_created',
      affectedDate: data.reservation_date,
      reservationId: data.id,
      userId: data.user_id,
      status: data.status,
      changeKind: 'reservation_insert',
    })

    return {
      success: true,
      reservation: data,
    }
  } finally {
    inFlightSubmissionKeys.delete(dedupeKey)
  }
}

/**
 * Fetches all reservations belonging to the currently authenticated resident.
 * Enforces user_id = userId filter in addition to Supabase RLS.
 */
export async function fetchMyReservations(userId) {
  if (!userId || !isValidUuid(userId)) {
    return { reservations: [], error: new Error('Authentication required.') }
  }

  // Trigger server-side sweep of any expired unpaid reservations
  try {
    await supabase.rpc('cancel_expired_unpaid_reservations')
  } catch {
    // Non-blocking cleanup
  }

  const { data, error } = await supabase
    .from('reservations')
    .select(RESIDENT_RESERVATION_COLUMNS)
    .eq('user_id', userId)
    .order('reservation_date', { ascending: false })
    .order('start_time', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) {
    return { reservations: [], error }
  }

  return { reservations: data || [], error: null }
}

/**
 * Fetches a single reservation by ID strictly for the authenticated owner (IDOR protection).
 * Changing the ID in the URL or request to another user's reservation returns notFoundOrUnauthorized = true.
 */
export async function fetchOwnReservationDetails(reservationId, userId) {
  if (!userId || !isValidUuid(userId)) {
    return {
      reservation: null,
      notFoundOrUnauthorized: true,
      error: 'Authentication required.',
    }
  }

  if (!isValidUuid(reservationId)) {
    return {
      reservation: null,
      notFoundOrUnauthorized: true,
      error: 'Invalid reservation reference ID.',
    }
  }

  // Trigger server-side sweep of any expired unpaid reservations
  try {
    await supabase.rpc('cancel_expired_unpaid_reservations')
  } catch {
    // Non-blocking cleanup
  }

  const { data, error } = await supabase
    .from('reservations')
    .select(RESIDENT_RESERVATION_COLUMNS)
    .eq('id', reservationId.trim())
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    return {
      reservation: null,
      notFoundOrUnauthorized: false,
      error: sanitizeReservationError(error),
    }
  }

  if (!data) {
    return {
      reservation: null,
      notFoundOrUnauthorized: true,
      error: 'Reservation not found or you do not have permission to view it.',
    }
  }

  return {
    reservation: data,
    notFoundOrUnauthorized: false,
    error: null,
  }
}

/**
 * Determines whether a reservation can be cancelled by its resident owner under business rules.
 */
export function canResidentCancelReservation(reservation, todayStr = getLocalTodayDateString()) {
  if (!reservation) return false
  if (!['pending', 'approved'].includes(reservation.status)) return false
  if (reservation.reservation_date < todayStr) return false
  return true
}

/**
 * Cancels a resident's own reservation when permitted by status ('pending' or 'approved') and date.
 * Never allows setting status to 'approved' or 'rejected'.
 */
export async function cancelOwnReservation({ reservationId, userId, reason = '' }) {
  if (!userId || !isValidUuid(userId)) {
    return {
      success: false,
      error: 'You must be signed in to cancel a reservation.',
    }
  }

  if (!isValidUuid(reservationId)) {
    return {
      success: false,
      error: 'Invalid reservation reference ID.',
    }
  }

  const cleanReason = String(reason || '').trim() || 'Cancelled by applicant'

  const { data: result, error } = await supabase.rpc('cancel_own_reservation', {
    p_reservation_id: reservationId.trim(),
    p_reason: cleanReason,
  })
  const data = result && typeof result === 'object' ? result : null

  if (error) {
    return {
      success: false,
      error: sanitizeReservationError(error),
    }
  }

  if (!data) {
    return {
      success: false,
      error: 'This reservation cannot be cancelled or you are not authorized to modify it.',
    }
  }

  emitRealtimeSyncSignal({
    topic: 'reservation_updated',
    affectedDate: data.reservation_date,
    reservationId: data.id,
    userId: data.user_id,
    status: data.status,
    changeKind: 'reservation_cancelled',
  })

  return {
    success: true,
    reservation: data,
  }
}
