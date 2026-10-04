import { useState } from 'react'
import Button from '../components/common/Button.jsx'
import useAuth from '../hooks/useAuth.js'

export function Navbar({ currentPage, navigateTo }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const { isAuthenticated, isOfficial, profile, signOut } = useAuth()

  const navItems = [
    { id: 'home', label: 'Home' },
    { id: 'courts', label: 'Courts' },
    { id: 'calendar', label: 'Calendar' },
    { id: 'reservation', label: 'Reservation' },
    ...(isAuthenticated ? [{ id: 'my-reservations', label: 'My Reservations' }] : []),
    { id: 'about', label: 'About' },
  ]

  if (isOfficial) {
    navItems.push({ id: 'official-dashboard', label: 'Official Dashboard' })
    navItems.push({ id: 'official-portal', label: 'Official Portal' })
  }

  const handleNavClick = (pageId) => {
    navigateTo(pageId)
    setMobileMenuOpen(false)
  }

  const handleSignOut = async () => {
    await signOut()
    setMobileMenuOpen(false)
    navigateTo('home')
  }

  const displayFirstName = profile?.full_name
    ? profile.full_name.trim().split(' ')[0]
    : 'Account'

  return (
    <>
      {/* Top Official Civic Banner */}
      <div className="civic-topbar">
        <div className="container civic-topbar-content">
          <div className="civic-topbar-left">
            <span className="ph-flag-dot" aria-hidden="true"></span>
            <span>Official Portal • Barangay Timugan, Los Baños, Laguna</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.75rem' }}>
            {isAuthenticated ? (
              <span>
                Signed in as <strong>{profile?.full_name || 'Resident'}</strong> ({isOfficial ? 'Verified Official' : 'Resident'})
              </span>
            ) : (
              <span>Office Hours: Mon–Fri 8:00 AM – 5:00 PM</span>
            )}
          </div>
        </div>
      </div>

      {/* Main Navbar */}
      <header className="site-header">
        <div className="container">
          <div className="navbar-content">
            {/* Branding */}
            <a
              href="#home"
              className="brand-logo-link"
              onClick={(e) => {
                e.preventDefault()
                handleNavClick('home')
              }}
              aria-label="TICORE - Timugan Court Reservation Home"
            >
              <div className="brand-icon-badge" aria-hidden="true">
                T
              </div>
              <div className="brand-info">
                <span className="brand-title">TICORE</span>
                <span className="brand-subtitle">Timugan Court Reservation</span>
              </div>
            </a>

            {/* Desktop Navigation */}
            <nav className="nav-menu" aria-label="Main Navigation">
              {navItems.map((item) => {
                const isActive = currentPage === item.id
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`nav-link ${isActive ? 'active' : ''}`}
                    onClick={() => handleNavClick(item.id)}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    {item.label}
                  </button>
                )
              })}
            </nav>

            {/* Desktop Actions */}
            <div className="nav-actions">
              {isAuthenticated ? (
                <>
                  <Button
                    variant={currentPage === 'account' ? 'secondary' : 'outline'}
                    size="sm"
                    onClick={() => handleNavClick('account')}
                  >
                    {displayFirstName} ({isOfficial ? 'Official' : 'Resident'})
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleSignOut}
                  >
                    Sign Out
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant={currentPage === 'login' ? 'secondary' : 'ghost'}
                    size="sm"
                    onClick={() => handleNavClick('login')}
                  >
                    Sign In
                  </Button>
                  <Button
                    variant={currentPage === 'register' ? 'secondary' : 'outline'}
                    size="sm"
                    onClick={() => handleNavClick('register')}
                  >
                    Register
                  </Button>
                </>
              )}
              <Button
                variant="primary"
                size="sm"
                onClick={() => handleNavClick('reservation')}
              >
                Reserve Court
              </Button>
            </div>

            {/* Mobile Hamburger Toggle */}
            <button
              type="button"
              className="mobile-toggle-btn"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              aria-expanded={mobileMenuOpen}
              aria-label="Toggle navigation menu"
            >
              {mobileMenuOpen ? (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="3" y1="12" x2="21" y2="12"></line>
                  <line x1="3" y1="6" x2="21" y2="6"></line>
                  <line x1="3" y1="18" x2="21" y2="18"></line>
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Mobile Navigation Drawer */}
        {mobileMenuOpen && (
          <nav className="mobile-menu-drawer" aria-label="Mobile Navigation">
            {navItems.map((item) => {
              const isActive = currentPage === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`mobile-nav-link ${isActive ? 'active' : ''}`}
                  onClick={() => handleNavClick(item.id)}
                  aria-current={isActive ? 'page' : undefined}
                >
                  {item.label}
                </button>
              )
            })}
            <div
              style={{
                marginTop: '0.5rem',
                paddingTop: '0.75rem',
                borderTop: '1px solid var(--color-border)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
              }}
            >
              {isAuthenticated ? (
                <>
                  <Button
                    variant="outline"
                    style={{ width: '100%' }}
                    onClick={() => handleNavClick('account')}
                  >
                    My Account ({displayFirstName})
                  </Button>
                  <Button
                    variant="ghost"
                    style={{ width: '100%' }}
                    onClick={handleSignOut}
                  >
                    Sign Out
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="outline"
                    style={{ width: '100%' }}
                    onClick={() => handleNavClick('login')}
                  >
                    Sign In
                  </Button>
                  <Button
                    variant="secondary"
                    style={{ width: '100%' }}
                    onClick={() => handleNavClick('register')}
                  >
                    Create Resident Account
                  </Button>
                </>
              )}
              <Button
                variant="primary"
                style={{ width: '100%' }}
                onClick={() => handleNavClick('reservation')}
              >
                Reserve Court
              </Button>
            </div>
          </nav>
        )}
      </header>
    </>
  )
}

export default Navbar
