export function Alert({
  type = 'info',
  title,
  children,
  className = '',
}) {
  const alertClass = `alert-${type}`
  const classes = ['alert', alertClass, className].filter(Boolean).join(' ')
  const ariaRole = type === 'error' || type === 'warning' ? 'alert' : 'region'

  return (
    <aside className={classes} role={ariaRole} aria-label={title || 'Notice'}>
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', marginTop: title ? '2px' : '1px' }} aria-hidden="true">
        {type === 'error' ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="15" y1="9" x2="9" y2="15"></line>
            <line x1="9" y1="9" x2="15" y2="15"></line>
          </svg>
        ) : type === 'warning' ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
        ) : type === 'success' ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
            <polyline points="22 4 12 14.01 9 11.01"></polyline>
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="16" x2="12" y2="12"></line>
            <line x1="12" y1="8" x2="12.01" y2="8"></line>
          </svg>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {title && <h4 style={{ margin: '0 0 0.25rem', fontSize: '0.9375rem', fontWeight: 600, color: 'inherit', lineHeight: 1.3 }}>{title}</h4>}
        <div style={{ fontSize: '0.875rem', lineHeight: 1.5 }}>{children}</div>
      </div>
    </aside>
  )
}

export default Alert

