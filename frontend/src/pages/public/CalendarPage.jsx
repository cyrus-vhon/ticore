import { useState, useEffect, useCallback } from 'react'
import Button from '../../components/common/Button.jsx'
import Card from '../../components/common/Card.jsx'
import Badge from '../../components/common/Badge.jsx'
import Alert from '../../components/common/Alert.jsx'
import AvailabilityLegend from '../../components/calendar/AvailabilityLegend.jsx'
import RealtimeStatusPill from '../../components/common/RealtimeStatusPill.jsx'
import { useRealtimeReservations } from '../../hooks/useRealtimeReservations.js'
import { useRealtimeClosures } from '../../hooks/useRealtimeClosures.js'
import {
  SINGLE_FACILITY_NAME,
  getLocalTodayDateString,
  getDailyPublicScheduleSlots,
} from '../../services/reservationService.js'

export function CalendarPage({ navigateTo, onSelectSlotForReservation }) {
  const todayStr = getLocalTodayDateString()
  const [selectedDate, setSelectedDate] = useState(todayStr)
  const [slots, setSlots] = useState([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')
  const [liveScheduleNotice, setLiveScheduleNotice] = useState(null)

  const loadSchedule = useCallback(async (targetDate, { silent = false } = {}) => {
    if (!silent) {
      setLoading(true)
    }
    setErrorMsg('')
    try {
      const { slots: fetchedSlots, error } = await getDailyPublicScheduleSlots(targetDate)
      if (error) {
        if (!silent) {
          setErrorMsg('Unable to load live schedule availability right now. Please try again.')
        }
      }
      setSlots(fetchedSlots || [])
    } finally {
      if (!silent) {
        setLoading(false)
      }
    }
  }, [])

  const { connectionStatus: scheduleConnectionStatus, lastRealtimeUpdate } = useRealtimeReservations({
    scope: 'public_schedule',
    targetDate: selectedDate,
    onScheduleRefreshNeeded: (meta) => {
      loadSchedule(selectedDate, { silent: true })
      setLiveScheduleNotice(
        `Schedule availability for ${selectedDate} updated automatically (${meta?.changeKind || 'live sync'}).`
      )
    },
  })

  const { lastClosureEvent } = useRealtimeClosures({
    targetDate: selectedDate,
    onClosureChange: () => {
      loadSchedule(selectedDate, { silent: true })
      setLiveScheduleNotice(
        `Court closure schedule for ${selectedDate} updated automatically in real time.`
      )
    },
  })

  useEffect(() => {
    let active = true
    getDailyPublicScheduleSlots(selectedDate).then(({ slots: fetchedSlots, error }) => {
      if (!active) return
      if (error) {
        setErrorMsg('Unable to load live schedule availability right now. Please try again.')
      } else {
        setErrorMsg('')
      }
      setSlots(fetchedSlots || [])
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [selectedDate])

  const handleReserveSlot = (slot) => {
    if (onSelectSlotForReservation) {
      onSelectSlotForReservation({
        date: slot.date,
        startTime: slot.startTime,
        endTime: slot.endTime,
      })
    }
    navigateTo('reservation')
  }

  return (
    <div className="container" style={{ paddingTop: '2.5rem' }}>
      {/* Page Header */}
      <div style={{ marginBottom: '2rem' }}>
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
            Civic Schedule
          </span>
          <RealtimeStatusPill
            status={scheduleConnectionStatus}
            lastEvent={lastClosureEvent || lastRealtimeUpdate}
          />
        </div>
        <h1 style={{ margin: '0.5rem 0' }}>Court Availability & Calendar</h1>
        <p style={{ fontSize: '1.0625rem', maxWidth: '720px' }}>
          Check daily court availability for <strong>{SINGLE_FACILITY_NAME}</strong>. Slots marked{' '}
          <strong>Available</strong> can be reserved online by authenticated residents. Schedule slots update automatically in real time.
        </p>
      </div>

      {liveScheduleNotice && (
        <div style={{ marginBottom: '1.25rem' }}>
          <Alert type="info" title="Live Schedule Synchronized">
            {liveScheduleNotice}
          </Alert>
        </div>
      )}

      {/* Privacy Notice */}
      <div style={{ marginBottom: '1.5rem' }}>
        <Alert type="info" title="Public Schedule Privacy">
          To protect resident privacy, the public calendar displays only schedule availability (Available, Pending Review, Reserved, or Closed). Personal applicant information, contact numbers, and private purposes are never shown publicly.
        </Alert>
      </div>

      {/* Status Legend */}
      <div style={{ marginBottom: '1.5rem' }}>
        <AvailabilityLegend />
      </div>

      {/* Filter Toolbar */}
      <Card style={{ marginBottom: '2rem' }}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '1.25rem',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          {/* Facility Display */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>
              Facility:
            </span>
            <span
              style={{
                fontSize: '0.875rem',
                fontWeight: 600,
                color: 'var(--color-primary-dark)',
                backgroundColor: 'var(--color-mint-light)',
                padding: '0.3rem 0.75rem',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              {SINGLE_FACILITY_NAME}
            </span>
          </div>

          {/* Date Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <label
              htmlFor="calendar-date-picker"
              style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text-secondary)' }}
            >
              Schedule Date:
            </label>
            <input
              id="calendar-date-picker"
              type="date"
              min={todayStr}
              className="form-input"
              style={{ width: 'auto', padding: '0.375rem 0.75rem', fontSize: '0.875rem' }}
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value || todayStr)}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSelectedDate(todayStr)}
              disabled={selectedDate === todayStr}
            >
              Today
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => loadSchedule(selectedDate)}
              disabled={loading}
            >
              {loading ? 'Refreshing...' : 'Refresh'}
            </Button>
          </div>
        </div>
      </Card>

      {errorMsg && (
        <div style={{ marginBottom: '1.5rem' }}>
          <Alert type="error" title="Schedule Load Error">
            {errorMsg}
          </Alert>
        </div>
      )}

      {/* Slots Grid */}
      <div style={{ marginBottom: '3.5rem' }}>
        {loading ? (
          <Card title="Loading Daily Schedule">
            <p style={{ fontSize: '0.9375rem', margin: 0 }}>
              Checking reservations and court closures for {selectedDate}...
            </p>
          </Card>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
              gap: '1.25rem',
            }}
          >
            {slots.map((slot) => {
              const isAvailable = slot.status === 'available'
              const isPastDate = selectedDate < todayStr
              const canBook = isAvailable && !isPastDate

              return (
                <div
                  key={slot.id}
                  style={{
                    backgroundColor: '#ffffff',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    padding: '1.25rem',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: '1rem',
                    boxShadow: 'var(--shadow-sm)',
                  }}
                >
                  <div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        gap: '0.5rem',
                        marginBottom: '0.5rem',
                      }}
                    >
                      <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--color-primary-dark)' }}>
                        {slot.timeLabel}
                      </span>
                      <Badge status={slot.status} />
                    </div>
                    <div style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)', fontWeight: 500 }}>
                      {slot.courtName}
                    </div>
                    <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
                      {slot.publicLabel}
                    </div>
                  </div>

                  <div style={{ borderTop: '1px solid var(--color-border-subtle)', paddingTop: '0.75rem' }}>
                    {canBook ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        style={{ width: '100%' }}
                        onClick={() => handleReserveSlot(slot)}
                      >
                        Reserve This Slot
                      </Button>
                    ) : (
                      <button
                        type="button"
                        disabled
                        style={{
                          width: '100%',
                          padding: '0.375rem 0.75rem',
                          fontSize: '0.8125rem',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--color-border)',
                          backgroundColor: 'var(--color-surface-muted)',
                          color: 'var(--color-text-muted)',
                          cursor: 'not-allowed',
                          fontWeight: 500,
                        }}
                      >
                        {slot.status === 'closed'
                          ? 'Facility Closed'
                          : slot.status === 'reserved'
                            ? 'Reserved'
                            : slot.status === 'pending'
                              ? 'Pending Review'
                              : 'Unavailable'}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default CalendarPage
