import Navbar from './Navbar.jsx'
import Footer from './Footer.jsx'

export function PublicLayout({ children, currentPage, navigateTo }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {/* Accessible skip link */}
      <a href="#main-content" className="skip-to-content">
        Skip to main content
      </a>

      {/* Top Navbar */}
      <Navbar currentPage={currentPage} navigateTo={navigateTo} />

      {/* Main Content Area */}
      <main id="main-content" className="main-layout-content" tabIndex="-1">
        {children}
      </main>

      {/* Bottom Footer */}
      <Footer navigateTo={navigateTo} />
    </div>
  )
}

export default PublicLayout

