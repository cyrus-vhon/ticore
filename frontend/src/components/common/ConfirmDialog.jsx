import { useEffect } from 'react'
import Button from './Button.jsx'

export function ConfirmDialog({
  open = false,
  isOpen = false,
  title = 'Confirm Action',
  description = '',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'primary',
  loading = false,
  onConfirm,
  onCancel,
  children,
}) {
  const isModalOpen = open || isOpen

  useEffect(() => {
    if (!isModalOpen) return undefined

    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && !loading && onCancel) {
        onCancel()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isModalOpen, loading, onCancel])

  if (!isModalOpen) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        backgroundColor: 'rgba(15, 23, 42, 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
      onClick={() => {
        if (!loading && onCancel) onCancel()
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        style={{
          backgroundColor: '#ffffff',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--color-border)',
          boxShadow: 'var(--shadow-lg)',
          width: '100%',
          maxWidth: '480px',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: '1.25rem 1.5rem',
            borderBottom: '1px solid var(--color-border-subtle)',
          }}
        >
          <h3 id="confirm-dialog-title" style={{ margin: 0, fontSize: '1.125rem', color: 'var(--color-primary-dark)' }}>
            {title}
          </h3>
          {description && (
            <p style={{ margin: '0.375rem 0 0', fontSize: '0.875rem', color: 'var(--color-text-secondary)' }}>
              {description}
            </p>
          )}
        </div>

        {children && (
          <div style={{ padding: '1.25rem 1.5rem' }}>
            {children}
          </div>
        )}

        <div
          style={{
            padding: '1rem 1.5rem',
            backgroundColor: 'var(--color-surface-muted)',
            borderTop: '1px solid var(--color-border-subtle)',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '0.75rem',
          }}
        >
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={loading}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={variant}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? 'Processing...' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default ConfirmDialog

