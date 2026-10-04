export function Button({
  children,
  variant = 'primary',
  size = 'md',
  type = 'button',
  onClick,
  disabled = false,
  loading = false,
  className = '',
  ariaLabel,
  icon,
  ...props
}) {
  const variantClass = `btn-${variant}`
  const sizeClass = size === 'md' ? '' : `btn-${size}`
  const loadingClass = loading ? 'btn-loading' : ''
  const classes = ['btn', variantClass, sizeClass, loadingClass, className].filter(Boolean).join(' ')

  return (
    <button
      type={type}
      className={classes}
      onClick={onClick}
      disabled={disabled || loading}
      aria-label={ariaLabel}
      aria-busy={loading ? 'true' : undefined}
      {...props}
    >
      {loading ? (
        <span className="btn-spinner" aria-hidden="true"></span>
      ) : (
        icon && <span className="btn-icon" aria-hidden="true">{icon}</span>
      )}
      {children}
    </button>
  )
}

export default Button
