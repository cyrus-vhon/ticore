# TICORE UI/UX Skill

## Purpose

Design TICORE as a modern, clean, trustworthy, professional, and easy-to-use Barangay Court Reservation System.

The interface should feel like a real usable system, not a generic student template.

Prioritize:

* Clarity
* Simplicity
* Trust
* Accessibility
* Mobile usability
* Consistency
* Good feedback

---

## Visual Direction

Use a modern civic/service-system style.

The design should feel:

* Clean
* Professional
* Calm
* Organized
* Trustworthy
* Modern

Avoid:

* Excessive gradients
* Excessive glassmorphism
* Too many colors
* Giant decorative elements
* Excessive animations
* Cluttered dashboards
* Random UI styles

---

## Color Direction

A possible primary palette:

```text
Primary Dark Green: #1B4332
Primary Green:      #2D6A4F
Light Green:        #D8F3DC
White:              #FFFFFF
```

Use neutral colors for backgrounds, text, borders, and surfaces.

Do not use color alone to communicate important information.

---

## Typography

Use a clean modern font.

Prioritize:

* Readability
* Clear hierarchy
* Consistent sizes
* Comfortable line height

Example hierarchy:

```text
Page Title
Section Heading
Card Heading
Body Text
Supporting Text
```

Avoid using too many font sizes.

---

## Layout

Use consistent:

* Spacing
* Container widths
* Cards
* Borders
* Radius
* Shadows
* Alignment

Keep important information visually organized.

Do not fill every available space.

Whitespace is useful.

---

## Public/Resident Experience

The resident side should make the main actions obvious.

Important actions may include:

```text
View Court Availability
Make Reservation
View My Reservations
Check Reservation Status
```

A user should not need to search through multiple menus to find the main reservation function.

---

## Official/Admin Experience

The admin dashboard should prioritize information that officials need.

Possible dashboard sections:

```text
Pending Reservations
Approved Reservations
Today's Reservations
Court Status
Recent Activity
```

Use cards, tables, filters, and calendars appropriately.

Do not turn every piece of information into a card.

---

## Navigation

Navigation should clearly separate public and administrative areas.

Admin navigation may include:

* Dashboard
* Reservations
* Calendar
* Courts
* Court Details (Timugan Covered Court)
* Users
* Officials
* Reports
* Settings

Keep navigation consistent between pages.

---

## Forms

Forms should feel simple and guided.

Use:

* Clear labels
* Logical grouping
* Helpful descriptions
* Required indicators
* Inline validation
* Clear error messages

Do not make users guess what a field means.

---

## Address Form

Use a structured address experience.

Example:

```text
Province
↓
Municipality/City
↓
Barangay
↓
Street/Purok/Zone
↓
House/Lot information
```

Keep the form understandable on mobile.

Do not create one extremely large text field when structured information is useful.

---

## Reservation Calendar

The calendar should clearly communicate:

* Available
* Pending
* Reserved
* Closed

Use clear visual states.

The user should be able to quickly understand:

```text
Can I reserve this?
```

Avoid overcrowding the calendar with private information.

---

## Status Badges

Use consistent badges for:

```text
Pending
Approved
Rejected
Cancelled
Completed
No-show
Rescheduled
```

The status should include readable text.

Do not rely only on red/green colors.

---

## Official Verification UI

The official verification interface should feel serious and trustworthy.

Clearly explain:

* Why information is required
* What information is being checked
* Current verification status
* What happens next

Possible status flow:

```text
Submitted
↓
Under Verification
↓
Verified / Rejected
```

Do not display sensitive official ID information to unauthorized users.

---

## OTP UI

OTP verification should use:

* Six digit fields
* Auto-advance
* Backspace navigation
* Paste support
* Resend countdown
* Expiration message
* Incorrect-code feedback
* Loading state
* Success state

Example:

```text
[ 1 ][ 2 ][ 3 ][ 4 ][ 5 ][ 6 ]
```

Make it easy to use on both mobile and desktop.

---

## Confirmation Dialogs

Use confirmation dialogs for important actions.

Examples:

```text
Approve reservation?
Reject reservation?
Cancel reservation?
Close court?
Close Timugan Covered Court?
Create official account?
```

The dialog should explain what will happen.

Avoid unnecessary confirmation dialogs for harmless actions.

---

## Toasts and Feedback

Use short feedback messages.

Examples:

```text
Reservation submitted successfully.
Reservation approved.
Changes saved.
Unable to save changes.
```

Do not use overly long toast messages.

Important errors should remain visible when necessary.

---

## Loading States

Every action that communicates with the server should provide feedback.

Examples:

```text
Saving...
Submitting...
Verifying...
Loading reservations...
```

Prevent accidental repeated submissions where appropriate.

---

## Empty States

Empty screens should explain what is happening.

Example:

```text
No reservations yet.

Your submitted reservations will appear here.
```

When appropriate, provide a useful action:

```text
Make a Reservation
```

---

## Error States

Errors should be understandable.

Avoid technical messages such as:

```text
PostgreSQL error 23505
```

Prefer:

```text
This time slot is no longer available.
Please choose another schedule.
```

---

## Animation and Transitions

Animations should be subtle and purposeful.

Recommended timing:

```text
Micro interactions: 120–180ms
Normal transitions: 180–250ms
Modal/panel transitions: 250–350ms
```

Prefer:

* Opacity
* Transform
* Small scale
* Small slide
* Hover transitions
* Focus transitions

Avoid:

* Excessive bouncing
* Flashing
* Large movement
* Long animations
* Animation on every element

Animations should support the interface, not distract from it.

---

## Reduced Motion

Respect:

```text
prefers-reduced-motion
```

Users who prefer reduced motion should receive minimal or no non-essential animations.

---

## Responsive Design

Design mobile-first.

Check layouts at:

* Small phone
* Large phone
* Tablet
* Laptop
* Desktop

Do not simply shrink the desktop interface.

Navigation, tables, forms, calendars, and modals must be usable on smaller screens.

---

## Accessibility

Support:

* Keyboard navigation
* Focus states
* Readable contrast
* Clear labels
* Accessible form controls
* Meaningful button text
* Screen-reader-friendly structure

Do not use tiny text for important information.

Do not use icons without accessible labels when the icon is the only control.

---

## Privacy UX

The interface should avoid unnecessarily exposing private information.

For public calendar views, show:

```text
Reserved
```

instead of:

```text
Reserved by Juan Dela Cruz
```

Do not show:

* Phone numbers
* Full addresses
* Private reservation purposes
* Internal notes
* Official ID information

unless the current user is authorized.

---

## Trust and Transparency

For forms collecting personal information, provide a short privacy explanation.

Users should understand:

* What information is collected
* Why it is collected
* How it is used
* Who may access it
* Relevant retention/deletion information

Do not overwhelm users with a huge wall of text.

---

## Consistency

Once a UI pattern is established, reuse it.

Examples:

* Same button styles
* Same status badges
* Same form controls
* Same modal style
* Same spacing system
* Same navigation behavior
* Same loading patterns

Do not create a different design for every page.

---

## Premium Feel

A professional interface comes from consistency and details, not excessive decoration.

Focus on:

* Good spacing
* Clean typography
* Clear hierarchy
* Smooth interactions
* Consistent components
* Good empty states
* Good error states
* Responsive behavior
* Accessibility

The goal is:

> Simple enough for residents, professional enough for barangay officials.

---

## Before Making Changes

Before changing the UI:

1. Check existing design patterns.
2. Reuse existing components.
3. Check mobile behavior.
4. Check accessibility.
5. Check loading/error/empty states.
6. Check privacy implications.
7. Check animations and reduced-motion behavior.
8. Avoid unnecessary visual changes.
9. Keep the design consistent across public and admin pages.
10. Do not add decoration that does not improve usability.