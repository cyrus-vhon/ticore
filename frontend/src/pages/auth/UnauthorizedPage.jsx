import Button from '../../components/common/Button.jsx'
import Card from '../../components/common/Card.jsx'
import Alert from '../../components/common/Alert.jsx'
import Badge from '../../components/common/Badge.jsx'
import useAuth from '../../hooks/useAuth.js'

export function UnauthorizedPage({
  navigateTo,
  reason = 'Access to this section is restricted to authorized Barangay Timugan officials with verified credentials.',
  attemptedResource = 'Protected Administrative Area',
}) {
  const { isAuthenticated, profile } = useAuth()

  const currentRoleLabel = profile?.role === 'official'
    ? 'Barangay Official'
    : isAuthenticated
      ? 'Registered Resident'
      : 'Guest (Unauthenticated)'

  return (
    <div className="container" style={{ paddingTop: '3rem', maxWidth: '680px' }}>
      <Card
        title="Access Restricted (403 Forbidden)"
        subtitle="Barangay Timugan Security & Authorization Boundary"
        headerRight={<Badge status="reserved">Unauthorized</Badge>}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <Alert type="error" title="Insufficient Permissions">
            {reason}
          </Alert>

          <div
            style={{
              backgroundColor: 'var(--color-surface-muted)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              padding: '1rem 1.25rem',
              fontSize: '0.875rem',
            }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.5rem 1rem' }}>
              <span style={{ fontWeight: 600, color: 'var(--color-text-muted)' }}>Requested Area:</span>
              <span style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>{attemptedResource}</span>

              <span style={{ fontWeight: 600, color: 'var(--color-text-muted)' }}>Your Current Role:</span>
              <span style={{ color: 'var(--color-text-primary)' }}>{currentRoleLabel}</span>

              <span style={{ fontWeight: 600, color: 'var(--color-text-muted)' }}>Enforcement Layer:</span>
              <span style={{ color: 'var(--color-text-secondary)' }}>
                Route Guard + Supabase PostgreSQL Row Level Security (RLS)
              </span>
            </div>
          </div>

          <p style={{ fontSize: '0.875rem', margin: 0 }}>
            If you are a Barangay Timugan official and require administrative access to manage court
            reservations or facility schedules, please coordinate with an authorized official holding
            <code style={{ margin: '0 0.25rem', padding: '0.1rem 0.35rem', background: '#f1f5f9', borderRadius: '4px' }}>
              canCreateOfficial
            </code>
            verification privileges.
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
            {isAuthenticated ? (
              <>
                <Button variant="primary" onClick={() => navigateTo('account')}>
                  Go to My Account
                </Button>
                <Button variant="outline" onClick={() => navigateTo('calendar')}>
                  View Public Court Schedule
                </Button>
                <Button variant="ghost" onClick={() => navigateTo('home')}>
                  Return to Home
                </Button>
              </>
            ) : (
              <>
                <Button variant="primary" onClick={() => navigateTo('login')}>
                  Sign In to Account
                </Button>
                <Button variant="outline" onClick={() => navigateTo('home')}>
                  Return to Home
                </Button>
              </>
            )}
          </div>
        </div>
      </Card>
    </div>
  )
}

export default UnauthorizedPage

