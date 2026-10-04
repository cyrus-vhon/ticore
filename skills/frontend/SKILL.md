# TICORE Frontend Skill

## Purpose

Build the TICORE frontend as a clean, modern, responsive, accessible, and secure React application.

TICORE has two sides:

* Public/Resident side
* Official/Admin side

Both sides use the same backend and database, but they must have different permissions and accessible features.

---

## Tech Stack

Use:

* React.js
* JavaScript or JSX
* Tailwind CSS
* Supabase client where appropriate
* React Router when routing is needed

Do not introduce another framework or UI library unless specifically requested.

---

## Project Structure

Prefer this structure:

```text
frontend/
└── src/
    ├── components/
    ├── pages/
    │   ├── public/
    │   └── admin/
    ├── layouts/
    ├── hooks/
    ├── services/
    ├── lib/
    ├── utils/
    ├── styles/
    ├── App.jsx
    └── main.jsx
```

Keep reusable components separate from page-specific components.

Do not place large amounts of application logic directly inside page components.

---

## Public/Resident Side

Typical features may include:

* Home
* Court information
* Court information (Timugan Covered Court)
* Court availability/calendar
* Reservation
* My reservations
* Reservation status
* Profile
* Notifications
* Help/About

The public/resident interface must only display information that the user is allowed to see.

The public calendar should show information such as:

* Available
* Pending
* Reserved
* Closed

Do not display private information such as:

* Other users' phone numbers
* Full addresses
* Private purposes
* Internal admin notes
* Official verification information

---

## Official/Admin Side

Typical features may include:

* Official login
* OTP verification where required
* Dashboard
* Reservation management
* Calendar management
* Court management
* Court status & settings (Timugan Covered Court)
* Court closure management
* Resident/user management
* Official account management
* Reports
* Audit information
* Settings

Admin pages must be protected by authentication and authorization.

Never rely only on hiding a page or button to protect an admin feature.

The backend and database must enforce the actual permission.

---

## Authentication UI

Authentication may include:

* Login
* Registration
* OTP verification
* Logout
* Password reset
* Session handling

For OTP:

* Use 6-digit input
* Automatically move to the next box
* Support backspace navigation
* Support pasting a code
* Show expiration state
* Show incorrect-code state
* Show resend timer
* Show loading state
* Show success state
* Prevent confusing repeated submissions

Frontend cooldowns are for user experience only.

Actual OTP rate limiting must be enforced by the authentication/backend system.

Never store or log OTP codes unnecessarily.

---

## Account Roles

The system currently supports:

* `resident`
* `official`

New users must default to `resident`.

Never allow a public registration form to choose:

```text
role = official
```

Do not trust role values sent from the browser.

The frontend may show/hide UI based on permissions, but actual authorization must happen on the backend/database.

Prefer permission-based UI when appropriate, for example:

* `canManageReservations`
* `canManageCourts`
* `canManageCourt`
* `canCreateOfficial`
* `canViewReports`

---

## Official Account Creation

Creating an official account is a protected process.

The frontend may collect:

* Full name
* Mobile number
* Position/designation
* Official ID type
* Official ID number
* Other required verification information

However:

> Entering an official ID number does NOT automatically prove that someone is an official.

The frontend should guide the user through verification, but the backend must make the final authorization decision.

Show clear states:

* Verification pending
* Verification successful
* Verification failed
* Verification requires review

The system should also clearly explain what information is being collected and why.

---

## Reservation Form

Reservation forms should be clear and easy to complete.

Possible fields:

* Applicant name
* Mobile number
* Address
* Purpose
* Court
* Court (Timugan Covered Court)
* Reservation date
* Start time
* End time
* Other required information

Address should be structured instead of using only one large text field.

Possible structure:

```text
Province
Municipality/City
Barangay
Street/Purok/Zone
House/Lot information
```

The system should support applicants who are:

* Timugan residents
* Other Los Baños residents
* Outside Los Baños

Do not automatically reject someone based on location unless that is an official barangay rule.

---

## Reservation Protection

Before submitting a reservation:

* Validate required fields
* Validate date/time
* Check selected court
* Check court open/closed status
* Check availability
* Prevent accidental duplicate submissions
* Show submission progress
* Show success/error result

Frontend availability checking is only an initial check.

The backend/database must perform the final availability check because two users can submit at nearly the same time.

Never assume:

```text
Frontend says available = reservation is guaranteed
```

---

## Realtime

Use Supabase Realtime when realtime updates are required.

Examples:

* Reservation status
* Calendar availability
* Dashboard counters
* Court closures
* Reservation changes

The interface should update without requiring the user to manually refresh.

Always:

* Subscribe only to required data
* Unsubscribe when the component is removed
* Avoid duplicate subscriptions
* Handle connection errors
* Show appropriate loading/offline states

Realtime does not replace authorization.

Only data the user is allowed to receive should be delivered.

---

## IDOR Protection

Never assume that changing an ID in a URL or request is safe.

Example:

```text
/reservations/123
```

Changing it to:

```text
/reservations/124
```

must not allow a resident to access another user's reservation.

The frontend should not expose unnecessary IDs or private data.

The backend/database must enforce ownership and permissions.

---

## Loading, Empty, and Error States

Every important data-driven page should handle:

### Loading

Show an appropriate loading indicator or skeleton.

### Empty

Example:

```text
No reservations yet.
```

### Error

Example:

```text
Something went wrong. Please try again.
```

### Unauthorized

Show an appropriate message and redirect when necessary.

Do not leave blank screens when an API request fails.

---

## Forms

Forms should provide:

* Clear labels
* Helpful placeholders
* Validation messages
* Required-field indicators
* Loading states
* Success feedback
* Error feedback
* Keyboard accessibility

Do not rely only on placeholder text as a label.

Validate on the frontend for good UX, but always validate again on the backend.

---

## Security Rules

Never:

* Store secret API keys in frontend code
* Expose Supabase service-role keys
* Trust frontend role checks
* Trust hidden form fields
* Trust URL parameters
* Store passwords manually
* Store OTPs unnecessarily
* Put sensitive information in localStorage without a clear security reason
* Use `dangerouslySetInnerHTML` without a strong reason and proper sanitization

Use the normal Supabase public/anon key on the frontend where appropriate.

Sensitive operations must go through secure backend/database rules.

---

## XSS

React normally escapes rendered text.

Avoid:

```jsx
dangerouslySetInnerHTML
```

unless absolutely necessary.

If HTML must be rendered, sanitize it before displaying it.

Never directly insert untrusted user input into HTML.

---

## User Feedback

Use consistent:

* Toasts
* Alerts
* Confirmation dialogs
* Status badges
* Loading indicators

Examples of statuses:

* Pending
* Approved
* Rejected
* Cancelled
* Completed
* No-show
* Rescheduled

Do not use color alone to communicate status.

---

## Responsive Design

Design mobile-first.

The system should work properly on:

* Mobile phones
* Tablets
* Laptops
* Desktop monitors

Do not create separate applications for mobile and desktop unless specifically required.

---

## Accessibility

Support:

* Keyboard navigation
* Visible focus states
* Readable text
* Sufficient contrast
* Proper labels
* Accessible buttons
* Accessible form errors
* Screen-reader-friendly structure

Do not depend only on icons.

---

## Before Making Changes

Before modifying frontend code:

1. Check the existing component/page.
2. Check related backend functionality.
3. Check database requirements if data is involved.
4. Check existing design patterns.
5. Reuse existing components when possible.
6. Avoid unnecessary file renaming.
7. Avoid unnecessary dependencies.
8. Make the smallest clean change that solves the requirement.
9. Check whether the change affects authentication, authorization, RLS, or realtime behavior.
10. Test both normal and unauthorized behavior.

Do not rewrite unrelated parts of the application.
