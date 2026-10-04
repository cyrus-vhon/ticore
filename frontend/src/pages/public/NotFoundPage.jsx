import Button from '../../components/common/Button.jsx'
import Card from '../../components/common/Card.jsx'
import Alert from '../../components/common/Alert.jsx'
import Badge from '../../components/common/Badge.jsx'

export function NotFoundPage({ navigateTo, attemptedPath = '' }) {
  return (
    <div className="container" style={{ paddingTop: '3rem', maxWidth: '680px' }}>
      <Card
        title="Page Not Found (404)"
        subtitle="Barangay Timugan Court Reservation System"
        headerRight={<Badge status="no_show">404 Not Found</Badge>}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <Alert type="warning" title="Requested Page Unavailable">
            The page or resource you requested could not be located on the TICORE portal. The link may be mistyped, outdated, or moved.
          </Alert>

          {attemptedPath && (
            <div
              style={{
                backgroundColor: 'var(--color-surface-muted)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                padding: '0.75rem 1rem',
                fontSize: '0.875rem',
                color: 'var(--color-text-secondary)',
              }}
            >
              Requested route: <code style={{ fontWeight: 600 }}>{attemptedPath}</code>
            </div>
          )}

          <p style={{ fontSize: '0.9375rem', margin: 0, color: 'var(--color-text-secondary)' }}>
            You can return to the home page or choose from common civic portal destinations below:
          </p>

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0.75rem',
              paddingTop: '0.75rem',
              borderTop: '1px solid var(--color-border-subtle)',
            }}
          >
            <Button variant="primary" onClick={() => navigateTo('home')}>
              Return to Home
            </Button>
            <Button variant="outline" onClick={() => navigateTo('calendar')}>
              View Court Calendar
            </Button>
            <Button variant="outline" onClick={() => navigateTo('reservation')}>
              Reserve Court Slot
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}

export default NotFoundPage
