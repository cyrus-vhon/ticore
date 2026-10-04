import Button from '../../components/common/Button.jsx'
import Card from '../../components/common/Card.jsx'
import Badge from '../../components/common/Badge.jsx'

export function CourtsPage({ navigateTo }) {
  const courts = [
    {
      id: 'main-covered-court',
      name: 'Timugan Main Covered Court',
      location: 'Adjacent to Barangay Hall, Timugan, Los Baños',
      status: 'available',
      type: 'Full-Size Covered Court',
      surface: 'Heavy-Duty Painted Sports Concrete',
      capacity: 'Up to 300 spectators / 30 active players',
      operatingHours: '06:00 AM – 10:00 PM Daily',
      activities: ['Basketball (5v5)', 'Volleyball', 'Badminton', 'Official Barangay Assemblies', 'Youth Clinics'],
      amenities: [
        'Overhead Steel Roof Coverage',
        'High-Bay LED Night Illumination',
        'Standard Fiberglass Backboards & Breakaway Rims',
        'Tiered Concrete Bleachers',
        'Barangay Restrooms & Changing Area',
      ],
      guidelines: 'Priority for official Timugan league schedules and barangay community events.',
    },
  ]

  return (
    <div className="container" style={{ paddingTop: '2.5rem' }}>
      {/* Header */}
      <div style={{ marginBottom: '2.5rem', maxWidth: '720px' }}>
        <div style={{ display: 'inline-block', marginBottom: '0.5rem' }}>
          <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Barangay Sports Facilities
          </span>
        </div>
        <h1 style={{ marginBottom: '0.75rem' }}>Court Facilities</h1>
        <p style={{ fontSize: '1.0625rem' }}>
          Barangay Timugan maintains well-equipped sports facilities designed for recreational sports,
          youth training tournaments, and authorized civic gatherings.
        </p>
      </div>

      {/* Courts List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', marginBottom: '3.5rem' }}>
        {courts.map((court) => (
          <Card
            key={court.id}
            title={court.name}
            subtitle={court.location}
            headerRight={<Badge status={court.status}>{court.status}</Badge>}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: '1.5rem',
                marginBottom: '1.5rem',
              }}
            >
              {/* Specs Column */}
              <div>
                <h4 style={{ marginBottom: '0.75rem', color: 'var(--color-primary-dark)' }}>Facility Details</h4>
                <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.5rem 1rem', fontSize: '0.875rem' }}>
                  <dt style={{ fontWeight: 600, color: 'var(--color-text-muted)' }}>Type:</dt>
                  <dd style={{ margin: 0, color: 'var(--color-text-primary)' }}>{court.type}</dd>

                  <dt style={{ fontWeight: 600, color: 'var(--color-text-muted)' }}>Surface:</dt>
                  <dd style={{ margin: 0, color: 'var(--color-text-primary)' }}>{court.surface}</dd>

                  <dt style={{ fontWeight: 600, color: 'var(--color-text-muted)' }}>Capacity:</dt>
                  <dd style={{ margin: 0, color: 'var(--color-text-primary)' }}>{court.capacity}</dd>

                  <dt style={{ fontWeight: 600, color: 'var(--color-text-muted)' }}>Hours:</dt>
                  <dd style={{ margin: 0, color: 'var(--color-text-primary)' }}>{court.operatingHours}</dd>
                </dl>
              </div>

              {/* Amenities Column */}
              <div>
                <h4 style={{ marginBottom: '0.75rem', color: 'var(--color-primary-dark)' }}>Court Amenities</h4>
                <ul style={{ paddingLeft: '1.25rem', fontSize: '0.875rem', color: 'var(--color-text-secondary)', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                  {court.amenities.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>

              {/* Permitted Activities */}
              <div>
                <h4 style={{ marginBottom: '0.75rem', color: 'var(--color-primary-dark)' }}>Permitted Activities</h4>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', marginBottom: '1rem' }}>
                  {court.activities.map((activity, idx) => (
                    <span
                      key={idx}
                      style={{
                        backgroundColor: 'var(--color-surface-muted)',
                        border: '1px solid var(--color-border)',
                        padding: '0.2rem 0.6rem',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: '0.75rem',
                        fontWeight: 500,
                        color: 'var(--color-text-secondary)',
                      }}
                    >
                      {activity}
                    </span>
                  ))}
                </div>
                <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', margin: 0 }}>
                  <em>{court.guidelines}</em>
                </p>
              </div>
            </div>

            {/* Card Action Buttons */}
            <div
              style={{
                display: 'flex',
                gap: '0.75rem',
                flexWrap: 'wrap',
                borderTop: '1px solid var(--color-border-subtle)',
                paddingTop: '1rem',
              }}
            >
              <Button
                variant="primary"
                onClick={() => navigateTo('reservation')}
              >
                Reserve This Court
              </Button>
              <Button
                variant="outline"
                onClick={() => navigateTo('calendar')}
              >
                View Available Hours
              </Button>
            </div>
          </Card>
        ))}
      </div>

      {/* Facility Rules Card */}
      <div style={{ marginBottom: '3rem' }}>
        <Card title="Barangay Timugan Court Usage Rules">
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: '1.5rem',
              fontSize: '0.875rem',
            }}
          >
            <div>
              <strong style={{ display: 'block', marginBottom: '0.25rem', color: 'var(--color-primary-dark)' }}>
                1. Footwear & Equipment
              </strong>
              <p style={{ fontSize: '0.875rem', margin: 0 }}>
                Non-marking athletic rubber shoes are mandatory. Street shoes, cleats, or heels that can damage
                the playing surface are strictly prohibited.
              </p>
            </div>

            <div>
              <strong style={{ display: 'block', marginBottom: '0.25rem', color: 'var(--color-primary-dark)' }}>
                2. Clean As You Go (CLAYGO)
              </strong>
              <p style={{ fontSize: '0.875rem', margin: 0 }}>
                All teams and organizers must dispose of water bottles, tape, and trash in designated
                segregated bins before vacating the court.
              </p>
            </div>

            <div>
              <strong style={{ display: 'block', marginBottom: '0.25rem', color: 'var(--color-primary-dark)' }}>
                3. Respect Scheduled Times
              </strong>
              <p style={{ fontSize: '0.875rem', margin: 0 }}>
                Teams must conclude play promptly at the end of their approved reservation slot so subsequent
                reserved parties can begin without delay.
              </p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}

export default CourtsPage

