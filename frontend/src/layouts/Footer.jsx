import useAuth from '../hooks/useAuth.js'

export function Footer({ navigateTo }) {
  const { isAuthenticated, isOfficial } = useAuth()

  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-grid">
          {/* Column 1: Brand & Civic Identity */}
          <div className="footer-col">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--color-mint-light)',
                  color: 'var(--color-primary-dark)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 800,
                  fontSize: '1rem',
                }}
                aria-hidden="true"
              >
                T
              </div>
              <div>
                <strong style={{ fontSize: '1.125rem', color: '#ffffff', letterSpacing: '-0.01em' }}>TICORE</strong>
                <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-mint-light)' }}>
                  Timugan Court Reservation
                </p>
              </div>
            </div>
            <p>
              An official civic initiative of Barangay Timugan, Los Baños, Laguna. Providing a fair,
              transparent, and convenient court reservation service for all residents and community members.
            </p>
          </div>

          {/* Column 2: Quick Links */}
          <div className="footer-col">
            <h3>Quick Links</h3>
            <ul className="footer-links-list">
              <li>
                <button type="button" onClick={() => navigateTo('home')}>Home</button>
              </li>
              <li>
                <button type="button" onClick={() => navigateTo('courts')}>Court Facilities</button>
              </li>
              <li>
                <button type="button" onClick={() => navigateTo('calendar')}>Schedule & Calendar</button>
              </li>
              <li>
                <button type="button" onClick={() => navigateTo('reservation')}>Reserve a Court</button>
              </li>
              {isAuthenticated ? (
                <li>
                  <button type="button" onClick={() => navigateTo('account')}>My Account & Profile</button>
                </li>
              ) : (
                <>
                  <li>
                    <button type="button" onClick={() => navigateTo('login')}>Sign In</button>
                  </li>
                  <li>
                    <button type="button" onClick={() => navigateTo('register')}>Resident Registration</button>
                  </li>
                </>
              )}
              {isOfficial && (
                <li>
                  <button type="button" onClick={() => navigateTo('official-portal')}>Official Portal</button>
                </li>
              )}
            </ul>
          </div>

          {/* Column 3: Barangay Hall & Hours */}
          <div className="footer-col">
            <h3>Barangay Office</h3>
            <p>
              <strong>Barangay Hall</strong><br />
              Brgy. Timugan, Los Baños,<br />
              Laguna 4030, Philippines
            </p>
            <p>
              <strong>Office Hours:</strong><br />
              Monday – Friday<br />
              8:00 AM – 5:00 PM
            </p>
          </div>

          {/* Column 4: Resident Assistance & Privacy */}
          <div className="footer-col">
            <h3>Assistance & Policy</h3>
            <p>
              For inquiries or priority resident assistance, visit the Barangay Hall during official hours.
            </p>
            <p style={{ fontSize: '0.8125rem', color: '#94a3b8' }}>
              <strong>Privacy Assurance:</strong> Personal details collected are strictly utilized for
              verifying reservation eligibility and scheduling in accordance with community guidelines.
            </p>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="footer-bottom">
          <div>
            © {new Date().getFullYear()} Barangay Timugan, Los Baños, Laguna. All rights reserved.
          </div>
          <div>
            <span>TICORE • Civic Facility Reservation System</span>
          </div>
        </div>
      </div>
    </footer>
  )
}

export default Footer
