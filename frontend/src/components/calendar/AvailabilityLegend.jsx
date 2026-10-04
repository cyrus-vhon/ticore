import Badge from '../common/Badge.jsx'

export function AvailabilityLegend({ className = '' }) {
  const items = [
    { status: 'available', label: 'Available', desc: 'Open for reservation' },
    { status: 'pending', label: 'Pending', desc: 'Under barangay official review' },
    { status: 'reserved', label: 'Reserved', desc: 'Confirmed approved schedule' },
    { status: 'closed', label: 'Closed', desc: 'Barangay event / Maintenance' },
  ]

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '1rem',
        alignItems: 'center',
        padding: '0.75rem 1rem',
        backgroundColor: '#ffffff',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
      }}
      aria-label="Schedule availability legend"
    >
      <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Legend:
      </span>
      {items.map((item) => (
        <div key={item.status} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Badge status={item.status}>{item.label}</Badge>
          <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>{item.desc}</span>
        </div>
      ))}
    </div>
  )
}

export default AvailabilityLegend

