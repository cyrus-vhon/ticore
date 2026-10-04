import { useEffect, useRef, useState } from 'react'
import {
  REALTIME_CONNECTION_STATES,
  sanitizePublicRealtimeSignal,
  sanitizeResidentRealtimeReservation,
  subscribeSharedPostgresChannel,
  subscribeToSyncSignals,
} from '../services/realtimeManager.js'

/**
 * Reusable hook for subscribing to TICORE reservation & schedule realtime updates.
 *
 * Scopes:
 * - 'resident': Subscribes to `public.reservations` filtered strictly by `user_id=eq.${userId}`
 *   and strips internal admin notes (`admin_notes`, `reviewed_by`) before invoking callbacks.
 * - 'official': Subscribes to `public.reservations` and `public.audit_logs` for active verified officials.
 * - 'public_schedule': Subscribes ONLY to non-PII `public.court_schedule_realtime_events` so public
 *   and resident calendar views update availability without ever receiving private resident PII.
 */
export function useRealtimeReservations({
  scope = 'public_schedule',
  userId = null,
  reservationId = null,
  targetDate = null,
  enabled = true,
  onReservationPayload = null,
  onScheduleRefreshNeeded = null,
} = {}) {
  const [connectionStatus, setConnectionStatus] = useState(
    enabled ? REALTIME_CONNECTION_STATES.CONNECTING : REALTIME_CONNECTION_STATES.IDLE
  )
  const [lastRealtimeUpdate, setLastRealtimeUpdate] = useState(null)

  const payloadCallbackRef = useRef(onReservationPayload)
  const refreshCallbackRef = useRef(onScheduleRefreshNeeded)
  const debounceTimerRef = useRef(null)

  useEffect(() => {
    payloadCallbackRef.current = onReservationPayload
    refreshCallbackRef.current = onScheduleRefreshNeeded
  }, [onReservationPayload, onScheduleRefreshNeeded])

  useEffect(() => {
    if (!enabled) {
      return undefined
    }

    if (scope === 'resident' && !userId) {
      return undefined
    }

    const triggerDebouncedRefresh = (meta) => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
      debounceTimerRef.current = setTimeout(() => {
        if (typeof refreshCallbackRef.current === 'function') {
          refreshCallbackRef.current(meta)
        }
      }, 140)
    }

    let channelKey = 'ticore:public:schedule_events'
    let bindings = []

    if (scope === 'resident') {
      channelKey = `ticore:resident:reservations:${userId}`
      bindings = [
        {
          event: '*',
          schema: 'public',
          table: 'reservations',
          filter: `user_id=eq.${userId}`,
        },
      ]
    } else if (scope === 'official') {
      channelKey = 'ticore:official:reservations_and_audit'
      bindings = [
        {
          event: '*',
          schema: 'public',
          table: 'reservations',
        },
        {
          event: 'INSERT',
          schema: 'public',
          table: 'audit_logs',
        },
      ]
    } else {
      channelKey = 'ticore:public:schedule_events'
      bindings = [
        {
          event: '*',
          schema: 'public',
          table: 'court_schedule_realtime_events',
        },
      ]
    }

    const unsubscribePostgres = subscribeSharedPostgresChannel({
      channelKey,
      bindings,
      onStatusChange: (nextStatus) => {
        setConnectionStatus(nextStatus)
      },
      onEvent: (payload) => {
        const rawRow = payload?.new || payload?.old || null

        if (scope === 'resident') {
          const safeReservation = sanitizeResidentRealtimeReservation(rawRow, userId)
          if (!safeReservation) {
            return
          }
          if (reservationId && safeReservation.id !== reservationId) {
            return
          }

          const updateMeta = {
            source: 'supabase_realtime',
            eventType: payload?.eventType || 'UPDATE',
            reservationId: safeReservation.id,
            status: safeReservation.status,
            reservationDate: safeReservation.reservation_date,
            receivedAt: new Date().toISOString(),
          }

          setLastRealtimeUpdate(updateMeta)

          if (typeof payloadCallbackRef.current === 'function') {
            payloadCallbackRef.current(safeReservation, updateMeta)
          }
          triggerDebouncedRefresh(updateMeta)
          return
        }

        if (scope === 'official') {
          const updateMeta = {
            source: 'supabase_realtime',
            table: payload?.table || 'reservations',
            eventType: payload?.eventType || 'UPDATE',
            reservationId: rawRow?.id || null,
            status: rawRow?.status || null,
            reservationDate: rawRow?.reservation_date || null,
            receivedAt: new Date().toISOString(),
          }

          setLastRealtimeUpdate(updateMeta)
          triggerDebouncedRefresh(updateMeta)
          return
        }

        // Public schedule scope: strictly sanitize to non-PII schedule signal
        const safeSignal = sanitizePublicRealtimeSignal(rawRow)
        if (!safeSignal) return
        if (targetDate && safeSignal.affectedDate && safeSignal.affectedDate !== targetDate) {
          return
        }

        const updateMeta = {
          source: 'supabase_realtime',
          affectedDate: safeSignal.affectedDate,
          changeKind: safeSignal.changeKind,
          receivedAt: new Date().toISOString(),
        }

        setLastRealtimeUpdate(updateMeta)
        triggerDebouncedRefresh(updateMeta)
      },
    })

    const unsubscribeSync = subscribeToSyncSignals((signal) => {
      if (!signal || !['reservation_created', 'reservation_updated', 'closure_updated'].includes(signal.topic)) {
        return
      }

      if (scope === 'resident') {
        if (signal.userId && signal.userId !== userId) {
          return
        }
        if (reservationId && signal.reservationId && signal.reservationId !== reservationId) {
          return
        }
      }

      if (scope === 'public_schedule' && targetDate && signal.affectedDate && signal.affectedDate !== targetDate) {
        return
      }

      const syncMeta = {
        source: 'broadcast_sync',
        affectedDate: signal.affectedDate || null,
        reservationId: signal.reservationId || null,
        status: signal.status || null,
        changeKind: signal.changeKind || signal.topic,
        receivedAt: new Date().toISOString(),
      }

      setLastRealtimeUpdate(syncMeta)
      triggerDebouncedRefresh(syncMeta)
    })

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
      unsubscribePostgres()
      unsubscribeSync()
    }
  }, [enabled, reservationId, scope, targetDate, userId])

  return {
    connectionStatus: enabled ? connectionStatus : REALTIME_CONNECTION_STATES.IDLE,
    isLive: connectionStatus === REALTIME_CONNECTION_STATES.SUBSCRIBED,
    lastRealtimeUpdate,
  }
}

