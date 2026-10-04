const STATUS_LABELS = Object.freeze({
  available: 'Available',
  pending: 'Pending Review',
  approved: 'Approved',
  reserved: 'Reserved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  closed: 'Closed',
  completed: 'Completed',
  no_show: 'No-Show',
  rescheduled: 'Rescheduled',
  pending_payment: 'Pending Payment',
  paid: 'Paid',
})

export function Badge({
  status = 'available',
  children,
  className = '',
}) {
  const normalizedStatus = String(status || 'available').toLowerCase()
  const statusClass = `badge-${normalizedStatus}`
  const label =
    children ||
    STATUS_LABELS[normalizedStatus] ||
    normalizedStatus.charAt(0).toUpperCase() + normalizedStatus.slice(1)
  const classes = ['badge', statusClass, className].filter(Boolean).join(' ')

  return (
    <span className={classes} role="status">
      <span className="badge-dot" aria-hidden="true"></span>
      <span>{label}</span>
    </span>
  )
}

export default Badge
