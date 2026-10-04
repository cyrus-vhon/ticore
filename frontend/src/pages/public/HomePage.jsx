import Button from '../../components/common/Button.jsx'
import Card from '../../components/common/Card.jsx'
import Badge from '../../components/common/Badge.jsx'
import Alert from '../../components/common/Alert.jsx'
import AvailabilityLegend from '../../components/calendar/AvailabilityLegend.jsx'

export function HomePage({ navigateTo }) {
  // Static schedule preview items (strictly UI preview, clearly labeled as non-realtime)
  const previewSlots = [
    { time: '06:00 AM - 08:00 AM', court: 'Timugan Covered Court', status: 'reserved', note: 'Community Morning Sports' },
    { time: '08:00 AM - 10:00 AM', court: 'Timugan Covered Court', status: 'available', note: 'Open for booking' },
    { time: '10:00 AM - 12:00 PM', court: 'Timugan Covered Court', status: 'available', note: 'Open for booking' },
    { time: '01:00 PM - 03:00 PM', court: 'Timugan Covered Court', status: 'pending', note: 'Under official review' },
    { time: '03:00 PM - 05:00 PM', court: 'Timugan Covered Court', status: 'available', note: 'Open for booking' },
    { time: '06:00 PM - 08:00 PM', court: 'Timugan Covered Court', status: 'closed', note: 'Scheduled maintenance / Inspection' },
  ]

  const howItWorksSteps = [
    {
      step: '01',
      title: 'Check Schedule',
      desc: 'Browse available time slots on our open community calendar without needing to visit the barangay hall in person.',
    },
    {
      step: '02',
      title: 'Submit Reservation',
      desc: 'Fill in your name, contact details, structured residence address, and event purpose using our simple form.',
    },
    {
      step: '03',
      title: 'Barangay Verification',
      desc: 'Authorized Barangay Timugan officials review schedules to prevent double bookings and ensure fair community access.',
    },
    {
      step: '04',
      title: 'Play & Enjoy',
      desc: 'Receive your verified schedule confirmation and enjoy clean, well-maintained court facilities with your team.',
    },
  ]

  return (
    <div>
      {/* Hero Section */}
      <section
        style={{
          backgroundColor: '#ffffff',
          borderBottom: '1px solid var(--color-border)',
          padding: 'clamp(2.5rem, 5vw, 4.5rem) 0',
          position: 'relative',
        }}
      >
        <div className="container">
          <div style={{ maxWidth: '780px', margin: '0 auto', textAlign: 'center' }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                backgroundColor: 'var(--color-mint-surface)',
                border: '1px solid #b7e4c7',
                padding: '0.35rem 0.85rem',
                borderRadius: 'var(--radius-full)',
                fontSize: '0.8125rem',
                fontWeight: 600,
                color: 'var(--color-primary-dark)',
                marginBottom: '1.25rem',
              }}
            >
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--color-primary)' }}></span>
              Brgy. Timugan, Los Baños, Laguna
            </div>

            <h1 style={{ marginBottom: '1.25rem', color: 'var(--color-primary-dark)' }}>
              Timugan Court Reservation System
            </h1>

            <p style={{ fontSize: 'clamp(1rem, 2vw, 1.1875rem)', color: 'var(--color-text-secondary)', marginBottom: '2rem', lineHeight: 1.6 }}>
              A modern, transparent civic booking platform for our community covered court. Check schedule
              availability, reserve time slots, and keep our recreational spaces organized and accessible to all residents.
            </p>

            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
              <Button
                variant="primary"
                size="lg"
                onClick={() => navigateTo('reservation')}
              >
                Reserve a Court
              </Button>
              <Button
                variant="outline"
                size="lg"
                onClick={() => navigateTo('calendar')}
              >
                View Schedule
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Short Explanation of TICORE */}
      <section style={{ padding: '3.5rem 0', backgroundColor: 'var(--color-bg)' }}>
        <div className="container">
          <div style={{ textAlign: 'center', maxWidth: '640px', margin: '0 auto 2.5rem' }}>
            <h2 style={{ marginBottom: '0.75rem' }}>Civic Recreation, Streamlined</h2>
            <p>
              TICORE replaces disorganized logbooks and scheduling disputes with an equitable, publicly
              visible reservation service operated under Barangay Timugan leadership.
            </p>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: '1.5rem',
            }}
          >
            <Card hoverable title="Transparent Scheduling" subtitle="Fair community access">
              <p style={{ fontSize: '0.9375rem' }}>
                Every confirmed schedule and maintenance period is clearly indicated on the public calendar.
                No double bookings or unexpected closures.
              </p>
            </Card>

            <Card hoverable title="Resident Priority" subtitle="Empowering local youth and teams">
              <p style={{ fontSize: '0.9375rem' }}>
                Timugan residents enjoy smooth reservation processes for sports leagues, youth training,
                and legitimate community recreation.
              </p>
            </Card>

            <Card hoverable title="Official Oversight" subtitle="Accountable Barangay management">
              <p style={{ fontSize: '0.9375rem' }}>
                Barangay officials verify each request to maintain peace, order, and equal opportunity for
                all neighborhood zones and organizations.
              </p>
            </Card>
          </div>
        </div>
      </section>

      {/* How Reservation Works Section */}
      <section style={{ padding: '3.5rem 0', backgroundColor: '#ffffff', borderTop: '1px solid var(--color-border)', borderBottom: '1px solid var(--color-border)' }}>
        <div className="container">
          <div style={{ textAlign: 'center', maxWidth: '600px', margin: '0 auto 3rem' }}>
            <h2 style={{ marginBottom: '0.75rem' }}>How Reservation Works</h2>
            <p>Follow four simple steps to request court usage for sports or community activities.</p>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: '1.5rem',
            }}
          >
            {howItWorksSteps.map((item) => (
              <div
                key={item.step}
                style={{
                  backgroundColor: 'var(--color-bg)',
                  padding: '1.75rem',
                  borderRadius: 'var(--radius-lg)',
                  border: '1px solid var(--color-border)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem',
                }}
              >
                <span
                  style={{
                    fontSize: '1.75rem',
                    fontWeight: 800,
                    color: 'var(--color-primary)',
                    lineHeight: 1,
                  }}
                >
                  {item.step}
                </span>
                <h3 style={{ fontSize: '1.125rem' }}>{item.title}</h3>
                <p style={{ fontSize: '0.875rem' }}>{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Court Availability Preview Section (Static UI Preview) */}
      <section style={{ padding: '3.5rem 0', backgroundColor: 'var(--color-bg)' }}>
        <div className="container">
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
              marginBottom: '2rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '1rem' }}>
              <div>
                <h2 style={{ marginBottom: '0.5rem' }}>Court Availability Preview</h2>
                <p>Sample schedule preview for the Timugan Covered Court today.</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => navigateTo('calendar')}>
                View Full Calendar →
              </Button>
            </div>

            <Alert type="info" title="Preview Mode Notice">
              This schedule is an illustrative preview showing availability states.
              Realtime database synchronization will be activated in upcoming phases.
            </Alert>

            <AvailabilityLegend />
          </div>

          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--color-border)',
              boxShadow: 'var(--shadow-sm)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: '1px',
                backgroundColor: 'var(--color-border)',
              }}
            >
              {previewSlots.map((slot, index) => (
                <div
                  key={index}
                  style={{
                    backgroundColor: '#ffffff',
                    padding: '1.25rem',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: '0.75rem',
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <span style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--color-primary-dark)' }}>
                        {slot.time}
                      </span>
                      <Badge status={slot.status} />
                    </div>
                    <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', margin: 0 }}>
                      {slot.court}
                    </p>
                  </div>
                  <div style={{ borderTop: '1px dashed var(--color-border)', paddingTop: '0.5rem', fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>
                    {slot.note}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Trust & Barangay Information Section */}
      <section style={{ padding: '3.5rem 0', backgroundColor: '#ffffff', borderTop: '1px solid var(--color-border)' }}>
        <div className="container">
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
              gap: '2rem',
              alignItems: 'center',
            }}
          >
            <div>
              <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Civic Responsibility & Guidelines
              </span>
              <h2 style={{ marginTop: '0.5rem', marginBottom: '1rem' }}>
                Court Rules & Community Standards
              </h2>
              <p style={{ marginBottom: '1.25rem' }}>
                The Barangay Timugan Covered Court is a shared community treasure. To ensure safety,
                fairness, and facility longevity, all court users are expected to adhere to our standard policies:
              </p>
              <ul style={{ paddingLeft: '1.25rem', color: 'var(--color-text-secondary)', display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.9375rem' }}>
                <li>Proper sports footwear must be worn at all times on the playing surface.</li>
                <li>Clean As You Go (CLAYGO) policy is strictly enforced across court premises.</li>
                <li>Official Barangay activities and emergency community events take precedence.</li>
                <li>Cancellations should be requested at least 24 hours in advance.</li>
              </ul>
            </div>

            <div
              style={{
                backgroundColor: 'var(--color-mint-surface)',
                border: '1px solid #b7e4c7',
                borderRadius: 'var(--radius-lg)',
                padding: '2rem',
              }}
            >
              <h3 style={{ color: 'var(--color-primary-dark)', marginBottom: '0.75rem' }}>
                Need Help or In-Person Assistance?
              </h3>
              <p style={{ fontSize: '0.9375rem', marginBottom: '1.5rem', color: 'var(--color-text-secondary)' }}>
                Our Barangay staff is happy to assist residents who require help submitting a reservation
                or need further information regarding special tournaments and league permits.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.875rem' }}>
                <div>
                  <strong>Location:</strong> Barangay Hall, Timugan, Los Baños, Laguna
                </div>
                <div>
                  <strong>Hours:</strong> Monday to Friday, 8:00 AM – 5:00 PM
                </div>
                <div>
                  <strong>Official Hotlines:</strong> (049) Los Baños Local Assistance
                </div>
              </div>

              <div style={{ marginTop: '1.5rem' }}>
                <Button variant="primary" size="sm" onClick={() => navigateTo('about')}>
                  Learn More About TICORE
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

export default HomePage

