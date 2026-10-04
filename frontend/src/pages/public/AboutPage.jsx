import Button from '../../components/common/Button.jsx'
import Card from '../../components/common/Card.jsx'

export function AboutPage({ navigateTo }) {
  return (
    <div className="container" style={{ paddingTop: '2.5rem' }}>
      {/* Header */}
      <div style={{ marginBottom: '2.5rem', maxWidth: '760px' }}>
        <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Civic Initiative
        </span>
        <h1 style={{ margin: '0.5rem 0' }}>About TICORE</h1>
        <p style={{ fontSize: '1.0625rem' }}>
          Timugan Court Reservation (TICORE) is an official digital initiative created to serve the residents,
          youth athletes, and community groups of Barangay Timugan, Los Baños, Laguna.
        </p>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: '2rem',
          marginBottom: '3.5rem',
        }}
      >
        {/* Mission & Purpose */}
        <Card title="Our Civic Mission">
          <p style={{ marginBottom: '1rem', fontSize: '0.9375rem' }}>
            Public sports facilities should be accessible, organized, and equitably shared. Historically,
            court reservations were documented via physical logbooks or informal requests, which often led to
            scheduling conflicts, misunderstandings, and uneven access.
          </p>
          <p style={{ fontSize: '0.9375rem' }}>
            TICORE introduces a modern, transparent system where every citizen can check availability, request
            usage, and receive prompt verification from Barangay officials without unnecessary visits or delays.
          </p>
        </Card>

        {/* Core Principles */}
        <Card title="Civic Principles">
          <ul style={{ paddingLeft: '1.25rem', fontSize: '0.9375rem', color: 'var(--color-text-secondary)', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <li>
              <strong>Fairness & Priority:</strong> Priority booking windows are maintained for Timugan residents and youth sports development programs.
            </li>
            <li>
              <strong>Transparency:</strong> All scheduled slots, official tournaments, and maintenance periods are openly displayed on the community calendar.
            </li>
            <li>
              <strong>Integrity & Care:</strong> Automated conflict avoidance ensures no overlapping reservations, protecting both players and organizers.
            </li>
            <li>
              <strong>Accountability:</strong> Official Barangay Timugan personnel oversee and verify all approvals.
            </li>
          </ul>
        </Card>
      </div>

      {/* Guidelines and Policies */}
      <div style={{ marginBottom: '3.5rem' }}>
        <Card title="Official Reservation Guidelines & Policies">
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: '1.5rem',
              fontSize: '0.875rem',
            }}
          >
            <div>
              <h4 style={{ marginBottom: '0.5rem', color: 'var(--color-primary-dark)' }}>
                Booking Lead Time
              </h4>
              <p>
                Reservations should be requested at least 24 to 48 hours prior to the intended schedule to
                give Barangay officials sufficient time for verification and setup.
              </p>
            </div>

            <div>
              <h4 style={{ marginBottom: '0.5rem', color: 'var(--color-primary-dark)' }}>
                Cancellations & Rescheduling
              </h4>
              <p>
                If your team cannot proceed with your reservation, please inform the Barangay office at least
                12 hours prior so the slot can be made available to other residents.
              </p>
            </div>

            <div>
              <h4 style={{ marginBottom: '0.5rem', color: 'var(--color-primary-dark)' }}>
                Priority for Official Events
              </h4>
              <p>
                Official Barangay assemblies, medical missions, evacuation necessities, and recognized municipal
                leagues hold priority over regular recreational bookings.
              </p>
            </div>

            <div>
              <h4 style={{ marginBottom: '0.5rem', color: 'var(--color-primary-dark)' }}>
                Facility Protection & Cleanliness
              </h4>
              <p>
                No smoking, alcoholic beverages, or sharp objects allowed inside court boundaries. Users are
                responsible for proper garbage disposal under the CLAYGO policy.
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Contact & Location */}
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--color-border)',
          padding: '2.5rem',
          boxShadow: 'var(--shadow-sm)',
          marginBottom: '4rem',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '2rem',
            alignItems: 'center',
          }}
        >
          <div>
            <h2 style={{ marginBottom: '0.75rem' }}>Barangay Timugan Office</h2>
            <p style={{ marginBottom: '1rem', fontSize: '0.9375rem' }}>
              For official inquiries, paper document submission, or tournament coordination, visit the
              Barangay Hall during standard government hours.
            </p>
            <div style={{ fontSize: '0.875rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div>
                <strong>Address:</strong> Barangay Hall, Timugan, Los Baños, Laguna 4030
              </div>
              <div>
                <strong>Office Hours:</strong> Monday to Friday • 8:00 AM – 5:00 PM
              </div>
              <div>
                <strong>Jurisdiction:</strong> Municipality of Los Baños, Province of Laguna
              </div>
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
              backgroundColor: 'var(--color-mint-surface)',
              border: '1px solid #b7e4c7',
              borderRadius: 'var(--radius-md)',
              padding: '1.5rem',
            }}
          >
            <h4 style={{ margin: 0, color: 'var(--color-primary-dark)' }}>
              Ready to play?
            </h4>
            <p style={{ fontSize: '0.875rem', margin: 0 }}>
              Check out open slots for today or reserve a schedule ahead of time.
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
              <Button variant="primary" size="sm" onClick={() => navigateTo('reservation')}>
                Reserve Court
              </Button>
              <Button variant="outline" size="sm" onClick={() => navigateTo('calendar')}>
                View Calendar
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default AboutPage

