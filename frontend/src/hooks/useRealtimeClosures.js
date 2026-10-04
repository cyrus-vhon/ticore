import { useEffect, useRef, useState } from 'react'
import {
  REALTIME_CONNECTION_STATES,
  sanitizePublicRealtimeSignal,
  subscribeSharedPostgresChannel,
  subscribeToSyncSignals,
} from '../services/realtimeManager.js'

/**
 * Subscribes to the privacy-safe schedule ticker. Closure details are never
 * sent over public realtime; consumers refresh through their authorized query.
 */
export function useRealtimeClosures({
  targetDate = null,
  enabled = true,
  onClosureChange = null,
} = {}) {
  const [connectionStatus, setConnectionStatus] = useState(
    enabled ? REALTIME_CONNECTION_STATES.CONNECTING : REALTIME_CONNECTION_STATES.IDLE
  )
  const [lastClosureEvent, setLastClosureEvent] = useState(null)
  const callbackRef = useRef(onClosureChange)
  const debounceTimerRef = useRef(null)

  useEffect(() => {
    callbackRef.current = onClosureChange
  }, [onClosureChange])

  useEffect(() => {
    if (!enabled) {
      return undefined
    }

    const triggerDebouncedClosureRefresh = (meta) => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
      debounceTimerRef.current = setTimeout(() => {
        if (typeof callbackRef.current === 'function') {
          callbackRef.current(meta)
        }
      }, 140)
    }

    const unsubscribePostgres = subscribeSharedPostgresChannel({
      channelKey: 'ticore:shared:court_schedule_events:closures',
      bindings: [
        {
          event: '*',
          schema: 'public',
          table: 'court_schedule_realtime_events',
        },
      ],
      onStatusChange: (nextStatus) => {
        setConnectionStatus(nextStatus)
      },
      onEvent: (payload) => {
        const rawRow = payload?.new || payload?.old || null
        const closureDate = rawRow?.affected_date || null

        if (targetDate && closureDate && closureDate !== targetDate) {
          return
        }

        const safeMeta = {
          source: 'supabase_realtime',
          eventType: payload?.eventType || 'UPDATE',
          affectedDate: closureDate,
          changeKind: rawRow?.change_kind || 'schedule_changed',
          receivedAt: new Date().toISOString(),
        }

        setLastClosureEvent(safeMeta)
        triggerDebouncedClosureRefresh(safeMeta)
      },
    })

    const unsubscribeSync = subscribeToSyncSignals((signal) => {
      if (!signal || signal.topic !== 'closure_updated') {
        return
      }
      const safeSignal = sanitizePublicRealtimeSignal(signal)
      if (targetDate && safeSignal?.affectedDate && safeSignal.affectedDate !== targetDate) {
        return
      }

      const syncMeta = {
        source: 'broadcast_sync',
        affectedDate: safeSignal?.affectedDate || null,
        changeKind: safeSignal?.changeKind || 'closure_updated',
        receivedAt: new Date().toISOString(),
      }

      setLastClosureEvent(syncMeta)
      triggerDebouncedClosureRefresh(syncMeta)
    })

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
      unsubscribePostgres()
      unsubscribeSync()
    }
  }, [enabled, targetDate])

  return {
    connectionStatus: enabled ? connectionStatus : REALTIME_CONNECTION_STATES.IDLE,
    isLive: connectionStatus === REALTIME_CONNECTION_STATES.SUBSCRIBED,
    lastClosureEvent,
  }
}
