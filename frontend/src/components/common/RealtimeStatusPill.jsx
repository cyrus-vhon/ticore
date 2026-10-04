import { REALTIME_CONNECTION_STATES } from '../../services/realtimeManager.js'

const STATUS_CONFIG = {
  [REALTIME_CONNECTION_STATES.SUBSCRIBED]: {
    pillClass: 'realtime-pill-subscribed',
    hasPulse: true,
    label: 'Live Sync Active',
  },
  [REALTIME_CONNECTION_STATES.CONNECTING]: {
    pillClass: 'realtime-pill-connecting',
    hasPulse: true,
    label: 'Connecting Live Sync…',
  },
  [REALTIME_CONNECTION_STATES.RECONNECTING]: {
    pillClass: 'realtime-pill-reconnecting',
    hasPulse: true,
    label: 'Reconnecting Live Sync…',
  },
  [REALTIME_CONNECTION_STATES.OFFLINE]: {
    pillClass: 'realtime-pill-offline',
    hasPulse: false,
    label: 'Offline (Auto-Retry Ready)',
  },
  [REALTIME_CONNECTION_STATES.ERROR]: {
    pillClass: 'realtime-pill-error',
    hasPulse: false,
    label: 'Standard Sync Mode',
  },
  [REALTIME_CONNECTION_STATES.IDLE]: {
    pillClass: 'realtime-pill-idle',
    hasPulse: false,
    label: 'Standby',
  },
}

export default function RealtimeStatusPill({
  status = REALTIME_CONNECTION_STATES.SUBSCRIBED,
  lastEvent = null,
  labelPrefix = '',
}) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG[REALTIME_CONNECTION_STATES.SUBSCRIBED]

  return (
    <div
      className={`realtime-pill ${config.pillClass}`}
      title="Supabase Realtime & Multi-Tab Schedule Synchronization Status"
      role="status"
      aria-live="polite"
    >
      <span className={`realtime-pill-dot ${config.hasPulse ? 'pulse' : ''}`} aria-hidden="true" />
      <span>
        {labelPrefix ? `${labelPrefix}: ` : ''}
        {config.label}
      </span>
      {lastEvent?.receivedAt && (
        <span style={{ fontSize: '0.6875rem', opacity: 0.8, fontWeight: 'normal' }}>
          • Updated {new Date(lastEvent.receivedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </span>
      )}
    </div>
  )
}


