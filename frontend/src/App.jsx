import { useState } from 'react'
import { useNavigation } from './hooks/useNavigation.js'
import { AuthProvider } from './context/AuthContext.jsx'
import ProtectedRoute from './components/auth/ProtectedRoute.jsx'
import PublicLayout from './layouts/PublicLayout.jsx'
import HomePage from './pages/public/HomePage.jsx'
import CourtsPage from './pages/public/CourtsPage.jsx'
import CalendarPage from './pages/public/CalendarPage.jsx'
import ReservationPage from './pages/public/ReservationPage.jsx'
import MyReservationsPage from './pages/reservation/MyReservationsPage.jsx'
import ReservationDetailsPage from './pages/reservation/ReservationDetailsPage.jsx'
import AboutPage from './pages/public/AboutPage.jsx'
import LoginPage from './pages/auth/LoginPage.jsx'
import RegisterPage from './pages/auth/RegisterPage.jsx'
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage.jsx'
import ResetPasswordPage from './pages/auth/ResetPasswordPage.jsx'
import UnauthorizedPage from './pages/auth/UnauthorizedPage.jsx'
import NotFoundPage from './pages/public/NotFoundPage.jsx'
import ServerErrorPage from './pages/public/ServerErrorPage.jsx'
import AccountPage from './pages/account/AccountPage.jsx'
import OfficialPortalPage from './pages/admin/OfficialPortalPage.jsx'
import OfficialDashboardPage from './pages/admin/OfficialDashboardPage.jsx'
import { ROLES, PERMISSIONS } from './utils/authorization.js'

function App() {
  const { currentPage, navigateTo } = useNavigation('home')
  const [preselectedSlot, setPreselectedSlot] = useState(null)
  const [selectedReservationId, setSelectedReservationId] = useState(null)

  const renderPage = () => {
    switch (currentPage) {
      case 'courts':
        return <CourtsPage navigateTo={navigateTo} />
      case 'calendar':
        return (
          <CalendarPage
            navigateTo={navigateTo}
            onSelectSlotForReservation={setPreselectedSlot}
          />
        )
      case 'reservation':
        return (
          <ReservationPage
            navigateTo={navigateTo}
            preselectedSlot={preselectedSlot}
            onSelectReservationId={setSelectedReservationId}
          />
        )
      case 'my-reservations':
        return (
          <ProtectedRoute
            navigateTo={navigateTo}
            routeId="my-reservations"
            resourceLabel="My Court Reservations"
          >
            <MyReservationsPage
              navigateTo={navigateTo}
              onSelectReservationId={setSelectedReservationId}
            />
          </ProtectedRoute>
        )
      case 'reservation-details':
        return (
          <ProtectedRoute
            navigateTo={navigateTo}
            routeId="reservation-details"
            resourceLabel="Reservation Details"
          >
            <ReservationDetailsPage
              navigateTo={navigateTo}
              selectedReservationId={selectedReservationId}
            />
          </ProtectedRoute>
        )
      case 'about':
        return <AboutPage navigateTo={navigateTo} />
      case 'login':
        return <LoginPage navigateTo={navigateTo} />
      case 'register':
        return <RegisterPage navigateTo={navigateTo} />
      case 'forgot-password':
        return <ForgotPasswordPage navigateTo={navigateTo} />
      case 'reset-password':
        return <ResetPasswordPage navigateTo={navigateTo} />
      case 'unauthorized':
        return <UnauthorizedPage navigateTo={navigateTo} />
      case 'account':
        return (
          <ProtectedRoute
            navigateTo={navigateTo}
            routeId="account"
            resourceLabel="My Account & Profile"
          >
            <AccountPage navigateTo={navigateTo} />
          </ProtectedRoute>
        )
      case 'official-dashboard':
        return (
          <ProtectedRoute
            navigateTo={navigateTo}
            routeId="official-dashboard"
            requiredRole={ROLES.OFFICIAL}
            resourceLabel="Barangay Official Dashboard"
          >
            <OfficialDashboardPage navigateTo={navigateTo} initialTab="overview" />
          </ProtectedRoute>
        )
      case 'official-reservations':
        return (
          <ProtectedRoute
            navigateTo={navigateTo}
            routeId="official-reservations"
            requiredRole={ROLES.OFFICIAL}
            requiredPermission={PERMISSIONS.CAN_MANAGE_RESERVATIONS}
            resourceLabel="Official Reservation Management"
          >
            <OfficialDashboardPage navigateTo={navigateTo} initialTab="reservations" />
          </ProtectedRoute>
        )
      case 'official-calendar':
        return (
          <ProtectedRoute
            navigateTo={navigateTo}
            routeId="official-calendar"
            requiredRole={ROLES.OFFICIAL}
            resourceLabel="Official Facility Schedule Calendar"
          >
            <OfficialDashboardPage navigateTo={navigateTo} initialTab="calendar" />
          </ProtectedRoute>
        )
      case 'official-closures':
        return (
          <ProtectedRoute
            navigateTo={navigateTo}
            routeId="official-closures"
            requiredRole={ROLES.OFFICIAL}
            requiredPermission={PERMISSIONS.CAN_MANAGE_COURT_CLOSURES}
            resourceLabel="Official Court Closure Management"
          >
            <OfficialDashboardPage navigateTo={navigateTo} initialTab="closures" />
          </ProtectedRoute>
        )
      case 'official-reports':
        return (
          <ProtectedRoute
            navigateTo={navigateTo}
            routeId="official-reports"
            requiredRole={ROLES.OFFICIAL}
            requiredPermission={PERMISSIONS.CAN_VIEW_REPORTS}
            resourceLabel="Official Monthly Reports"
          >
            <OfficialDashboardPage navigateTo={navigateTo} initialTab="reports" />
          </ProtectedRoute>
        )
      case 'official-portal':
        return (
          <ProtectedRoute
            navigateTo={navigateTo}
            routeId="official-portal"
            requiredRole={ROLES.OFFICIAL}
            resourceLabel="Barangay Official Portal"
          >
            <OfficialPortalPage navigateTo={navigateTo} />
          </ProtectedRoute>
        )
      case 'not-found':
        return <NotFoundPage navigateTo={navigateTo} />
      case 'server-error':
        return <ServerErrorPage navigateTo={navigateTo} />
      case 'home':
      default:
        return <HomePage navigateTo={navigateTo} />
    }
  }

  return (
    <AuthProvider navigateTo={navigateTo}>
      <PublicLayout currentPage={currentPage} navigateTo={navigateTo}>
        {renderPage()}
      </PublicLayout>
    </AuthProvider>
  )
}

export default App
