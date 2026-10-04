import Button from '../../components/common/Button.jsx'
import Card from '../../components/common/Card.jsx'
import Alert from '../../components/common/Alert.jsx'
import Badge from '../../components/common/Badge.jsx'

export function ServerErrorPage({
  navigateTo,
  errorMessage = 'Unable to establish a secure connection with the Barangay Timugan database.',
  onRetry,
}) {
  const handleRetry = () => {
    if (typeof onRetry === 'function') {
      onRetry()
    } else if (typeof window !== 'undefined') {
      window.location.reload()
    }
  }

  return (
    <div className="container" style={{ paddingTop: '3rem', maxWidth: '680px' }}>
      <Card
        title="Service Notice: Connection Issue"
        subtitle="Barangay Timugan Court Reservation System"
        headerRight={<Badge status="rejected">System Alert</Badge>}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <Alert type="warning" title="Civic Database Connection Notice">
            {errorMessage}
          </Alert>

          <div
            style={{
              backgroundColor: 'var(--color-surface-muted)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              padding: '1rem',
              fontSize: '0.875rem',
              color: 'var(--color-text-secondary)',
              lineHeight: 1.6,
            }}
          >
            <p style={{ margin: 0 }}>
              The TICORE system relies on live synchronization with Barangay Timugan servers. If you are experiencing a temporary network interruption or server maintenance, please try reconnecting below.
            </p>
          </div>

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0.75rem',
              paddingTop: '0.75rem',
              borderTop: '1px solid var(--color-border-subtle)',
            }}
          >
            <Button variant="primary" onClick={handleRetry}>
              Retry Connection
            </Button>
            <Button variant="outline" onClick={() => navigateTo('home')}>
              Return to Home
            </Button>
            <Button variant="ghost" onClick={() => navigateTo('courts')}>
              View Court Guidelines
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}

export default ServerErrorPage
