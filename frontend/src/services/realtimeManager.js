import { supabase } from '../lib/supabaseClient.js'

export const REALTIME_CONNECTION_STATES = Object.freeze({
  IDLE: 'IDLE',
  CONNECTING: 'CONNECTING',
  SUBSCRIBED: 'SUBSCRIBED',
  RECONNECTING: 'RECONNECTING',
  OFFLINE: 'OFFLINE',
  ERROR: 'ERROR',
})

const BROADCAST_CHANNEL_NAME = 'ticore_realtime_sync_v1'

/**
 * Active reference-counted Supabase Realtime channel registry.
 * Key: channelKey -> { channel, subscribers: Set<Function>, status: string, lastError: string|null }
 */
const activeChannels = new Map()

/**
 * Local & cross-tab BroadcastChannel listeners so multiple browser tabs
 * synchronize immediately alongside Supabase WebSocket postgres_changes.
 */
const broadcastSubscribers = new Set()
let broadcastChannelInstance = null

function getBroadcastChannel() {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
    return null
  }
  if (!broadcastChannelInstance) {
    try {
      broadcastChannelInstance = new BroadcastChannel(BROADCAST_CHANNEL_NAME)
      broadcastChannelInstance.onmessage = (event) => {
        const payload = event?.data
        if (!payload || typeof payload !== 'object') return
        broadcastSubscribers.forEach((listener) => {
          try {
            listener(payload)
          } catch {
            // ignore individual listener errors
          }
        })
      }
    } catch {
      broadcastChannelInstance = null
    }
  }
  return broadcastChannelInstance
}

/**
 * Emits a privacy-safe synchronization signal across open browser tabs and active in-page listeners.
 * Never includes applicant names, mobile numbers, addresses, purposes, or internal notes.
 */
export function emitRealtimeSyncSignal({
  type = 'schedule_updated',
  affectedDate = null,
  reservationId = null,
  userId = null,
  status = null,
} = {}) {
  const safeSignal = {
    type,
    facilityName: 'Timugan Main Covered Court',
    affectedDate: affectedDate || null,
    reservationId: reservationId || null,
    userId: userId || null,
    status: status || null,
    timestamp: new Date().toISOString(),
  }

  const bc = getBroadcastChannel()
  if (bc) {
    try {
      bc.postMessage(safeSignal)
    } catch {
      // ignore broadcast channel errors
    }
  }

  broadcastSubscribers.forEach((listener) => {
    try {
      listener(safeSignal)
    } catch {
      // ignore listener error
    }
  })
}

/**
 * Subscribes a listener to cross-tab and local realtime sync signals.
 */
export function subscribeToSyncSignals(listener) {
  getBroadcastChannel()
  broadcastSubscribers.add(listener)
  return () => {
    broadcastSubscribers.delete(listener)
  }
}

/**
 * Strips any internal official notes or unauthorized fields from a resident reservation payload.
 * Guarantees IDOR and privacy protection even if raw postgres_changes payloads arrive.
 */
export function sanitizeResidentRealtimeReservation(rawRow, currentUserId) {
  if (!rawRow || typeof rawRow !== 'object') return null
  if (!currentUserId || rawRow.user_id !== currentUserId) {
    return null
  }

  return {
    id: rawRow.id,
    user_id: rawRow.user_id,
    facility_name: rawRow.facility_name || 'Timugan Main Covered Court',
    applicant_name: rawRow.applicant_name,
    applicant_mobile: rawRow.applicant_mobile,
    residency_type: rawRow.residency_type,
    reservation_date: rawRow.reservation_date,
    start_time: rawRow.start_time,
    end_time: rawRow.end_time,
    activity_type: rawRow.activity_type,
    purpose: rawRow.purpose,
    expected_attendees: rawRow.expected_attendees,
    address_province: rawRow.address_province,
    address_city: rawRow.address_city,
    address_barangay: rawRow.address_barangay,
    address_purok_street: rawRow.address_purok_street,
    address_house_details: rawRow.address_house_details,
    address: rawRow.address,
    status: rawRow.status,
    status_reason: rawRow.status_reason || null,
    reviewed_at: rawRow.reviewed_at || null,
    rescheduled_from_id: rawRow.rescheduled_from_id || null,
    payment_status: rawRow.payment_status || 'pending_payment',
    payment_method: rawRow.payment_method || 'cash',
    payment_due_at: rawRow.payment_due_at || null,
    paid_at: rawRow.paid_at || null,
    paid_confirmed_by: rawRow.paid_confirmed_by || null,
    is_student: Boolean(rawRow.is_student),
    rate_category: rawRow.rate_category || 'timugan_resident',
    hourly_rate: Number(rawRow.hourly_rate || 200.0),
    total_amount: Number(rawRow.total_amount || 200.0),
    created_at: rawRow.created_at,
    updated_at: rawRow.updated_at,
  }
}

/**
 * Strips any PII from public schedule/closure realtime payloads so public listeners
 * only ever see non-PII availability signals.
 */
export function sanitizePublicRealtimeSignal(rawPayload) {
  const row = rawPayload?.new || rawPayload?.old || rawPayload || {}
  return {
    facilityName: 'Timugan Main Covered Court',
    affectedDate: row.affected_date || row.closure_date || row.reservation_date || null,
    changeKind: row.change_kind || 'schedule_changed',
    updatedAt: row.updated_at || new Date().toISOString(),
  }
}

/**
 * Creates or reuses a reference-counted Supabase Realtime channel subscription.
 * Automatically unsubscribes and removes the channel when the last component unmounts.
 */
export function subscribeSharedPostgresChannel({
  channelKey,
  bindings = [],
  onEvent,
  onStatusChange,
}) {
  if (!channelKey || typeof onEvent !== 'function') {
    return () => {}
  }

  let entry = activeChannels.get(channelKey)

  if (!entry) {
    const subscribers = new Set()
    const statusListeners = new Set()
    const channel = supabase.channel(channelKey)

    bindings.forEach((binding) => {
      channel.on(
        'postgres_changes',
        {
          event: binding.event || '*',
          schema: binding.schema || 'public',
          table: binding.table,
          ...(binding.filter ? { filter: binding.filter } : {}),
        },
        (payload) => {
          subscribers.forEach((cb) => {
            try {
              cb(payload, binding.table)
            } catch {
              // prevent one subscriber from breaking others
            }
          })
        }
      )
    })

    entry = {
      channelKey,
      channel,
      subscribers,
      statusListeners,
      status: REALTIME_CONNECTION_STATES.CONNECTING,
      lastError: null,
    }

    activeChannels.set(channelKey, entry)

    channel.subscribe((status, err) => {
      let mappedStatus = REALTIME_CONNECTION_STATES.CONNECTING
      if (status === 'SUBSCRIBED') {
        mappedStatus = REALTIME_CONNECTION_STATES.SUBSCRIBED
      } else if (status === 'TIMED_OUT' || status === 'CLOSED') {
        mappedStatus = REALTIME_CONNECTION_STATES.RECONNECTING
      } else if (status === 'CHANNEL_ERROR') {
        mappedStatus = REALTIME_CONNECTION_STATES.ERROR
      }

      entry.status = mappedStatus
      entry.lastError = err ? String(err.message || err) : null

      entry.statusListeners.forEach((statusCb) => {
        try {
          statusCb(mappedStatus, entry.lastError)
        } catch {
          // ignore status callback error
        }
      })
    })
  }

  entry.subscribers.add(onEvent)
  if (typeof onStatusChange === 'function') {
    entry.statusListeners.add(onStatusChange)
    onStatusChange(entry.status, entry.lastError)
  }

  return () => {
    const currentEntry = activeChannels.get(channelKey)
    if (!currentEntry) return

    currentEntry.subscribers.delete(onEvent)
    if (typeof onStatusChange === 'function') {
      currentEntry.statusListeners.delete(onStatusChange)
    }

    if (currentEntry.subscribers.size === 0) {
      activeChannels.delete(channelKey)
      try {
        supabase.removeChannel(currentEntry.channel)
      } catch {
        // ignore channel cleanup error
      }
    }
  }
}
