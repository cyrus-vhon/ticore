import { useEffect } from 'react'
import useAuth from '../../hooks/useAuth.js'
import { ROLES } from '../../utils/authorization.js'
import Card from '../common/Card.jsx'
import UnauthorizedPage from '../../pages/auth/UnauthorizedPage.jsx'

export function ProtectedRoute({
  children,
  navigateTo,
  routeId = 'account',
  requiredRole = null,
  requiredPermission = null,
  resourceLabel = 'Protected Area',
}) {
  const {
    loading,
    isAuthenticated,
    isOfficial,
    hasPermission,
    setIntendedRoute,
    setAuthNotice,
  } = useAuth()

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      setIntendedRoute(routeId)
      setAuthNotice({
        type: 'info',
        title: 'Authentication Required',
        message: `Please sign in to access ${resourceLabel}.`,
      })
      if (navigateTo) {
        navigateTo('login')
      }
    }
  }, [loading, isAuthenticated, routeId, resourceLabel, navigateTo, setIntendedRoute, setAuthNotice])

  if (loading) {
    return (
      <div className="container" style={{ paddingTop: '3.5rem', maxWidth: '560px' }}>
        <Card title="Verifying Session">
          <p style={{ fontSize: '0.9375rem', margin: 0 }}>
            Checking your authentication status and Barangay Timugan access permissions...
          </p>
        </Card>
      </div>
    )
  }

  if (!isAuthenticated) {
    return null
  }

  if (requiredRole === ROLES.OFFICIAL && !isOfficial) {
    return (
      <UnauthorizedPage
        navigateTo={navigateTo}
        attemptedResource={resourceLabel}
        reason="Only authenticated Barangay Timugan officials with verified status in the database may access official management areas. Resident accounts cannot access official routes."
      />
    )
  }

  if (requiredPermission && !hasPermission(requiredPermission)) {
    return (
      <UnauthorizedPage
        navigateTo={navigateTo}
        attemptedResource={`${resourceLabel} (${requiredPermission})`}
        reason={`Your account does not have the required '${requiredPermission}' capability assigned in your database profile.`}
      />
    )
  }

  return children
}

export default ProtectedRoute

