export function StepIndicator({
  steps = [
    { number: 1, title: 'Court & Schedule' },
    { number: 2, title: 'Applicant Details' },
    { number: 3, title: 'Purpose & Info' },
    { number: 4, title: 'Review & Confirm' },
  ],
  currentStep = 1,
  className = '',
}) {
  return (
    <nav aria-label="Reservation progress" className={className} style={{ width: '100%', marginBottom: '2rem' }}>
      <ol
        style={{
          listStyle: 'none',
          display: 'grid',
          gridTemplateColumns: `repeat(${steps.length}, 1fr)`,
          gap: '0.5rem',
          margin: 0,
          padding: 0,
        }}
      >
        {steps.map((step) => {
          const isComplete = currentStep > step.number
          const isCurrent = currentStep === step.number

          let circleBg = 'var(--color-surface-muted)'
          let circleColor = 'var(--color-text-muted)'
          let borderColor = 'var(--color-border)'
          let titleColor = 'var(--color-text-muted)'
          let titleWeight = 500

          if (isCurrent) {
            circleBg = 'var(--color-primary)'
            circleColor = '#ffffff'
            borderColor = 'var(--color-primary)'
            titleColor = 'var(--color-primary-dark)'
            titleWeight = 700
          } else if (isComplete) {
            circleBg = 'var(--color-mint-light)'
            circleColor = 'var(--color-primary-dark)'
            borderColor = 'var(--color-primary-light)'
            titleColor = 'var(--color-text-secondary)'
          }

          return (
            <li
              key={step.number}
              aria-current={isCurrent ? 'step' : undefined}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                textAlign: 'center',
                gap: '0.375rem',
                position: 'relative',
              }}
            >
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  backgroundColor: circleBg,
                  color: circleColor,
                  border: `2px solid ${borderColor}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                  fontSize: '0.875rem',
                  transition: 'all var(--transition-fast)',
                }}
              >
                {isComplete ? '✓' : step.number}
              </div>
              <span
                style={{
                  fontSize: '0.75rem',
                  fontWeight: titleWeight,
                  color: titleColor,
                  lineHeight: 1.2,
                }}
              >
                {step.title}
              </span>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

export default StepIndicator

