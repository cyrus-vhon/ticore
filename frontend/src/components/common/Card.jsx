export function Card({
  children,
  title,
  subtitle,
  headerRight,
  footer,
  hoverable = false,
  className = '',
}) {
  const hasHeader = title || subtitle || headerRight
  const classes = ['card', hoverable ? 'card-hoverable' : '', className]
    .filter(Boolean)
    .join(' ')

  return (
    <article className={classes}>
      {hasHeader && (
        <header className="card-header">
          <div style={{ display: 'flex', alignItems: subtitle ? 'flex-start' : 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 auto', minWidth: 0 }}>
              {title && <h3 style={{ margin: 0, fontSize: '1.25rem', lineHeight: 1.3 }}>{title}</h3>}
              {subtitle && <p style={{ margin: '0.25rem 0 0', fontSize: '0.875rem', lineHeight: 1.5, color: 'var(--color-text-muted)' }}>{subtitle}</p>}
            </div>
            {headerRight && <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>{headerRight}</div>}
          </div>
        </header>
      )}
      <div className="card-body">{children}</div>
      {footer && <footer className="card-footer">{footer}</footer>}
    </article>
  )
}

export default Card

