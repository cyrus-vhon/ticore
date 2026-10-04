# TICORE Backend Skill

## Purpose

Build the TICORE backend as a secure, reliable, maintainable API and business-logic layer.

The backend is responsible for enforcing rules.

Never depend on the frontend to enforce security.

---

## Tech Stack

Preferred backend:

* Python
* FastAPI
* Supabase/PostgreSQL
* JWT/Supabase Auth where applicable

Use the existing project stack unless a change is specifically requested.

---

## Backend Responsibilities

The backend should handle:

* Authentication integration
* Authorization
* Business rules
* Reservation validation
* Official verification
* Reservation conflict checking
* Court closure rules
* Ownership checks
* Rate limiting/abuse protection
* Input validation
* Sensitive operations
* Audit logging
* Secure database access

---

## Authentication

Authentication answers:

> "Who is this user?"

Use Supabase Auth or another established authentication mechanism.

Do not build custom password storage unless specifically required.

Never store plain-text passwords.

Never trust a user-provided identity such as:

```text
user_id
role
is_admin
is_official
```

without verifying it from the authenticated session/token and authorized data source.

---

## Authorization

Authorization answers:

> "What is this authenticated user allowed to do?"

Authentication alone is not enough.

Every protected operation must verify permission.

Example:

```text
Authenticated resident
        ↓
Can view own reservation
        ↓
Cannot modify another resident's reservation
```

An official may have additional permissions.

Do not rely only on:

```javascript
if (user.role === "official")
```

in the frontend.

The backend must enforce the permission.

---

## Roles and Permissions

Current roles:

```text
resident
official
```

Prefer explicit permissions for sensitive operations.

Examples:

```text
canManageReservations
canManageCourts
canManageCourt
canCreateOfficial
canViewReports
```

Do not allow users to escalate their own role.

A request such as:

```text
PATCH /profile
{
  "role": "official"
}
```

must never allow self-promotion.

---

## Official Account Creation

Official account creation is a high-risk operation.

Public registration must create only:

```text
resident
```

Official creation should require an authorized existing official or another controlled administrative process.

The process may collect:

* Full name
* Mobile number
* Position/designation
* Official ID type
* Official ID number
* Verification information

Important:

> OTP verifies control of a phone number. It does not prove that the person is a barangay official.

Official eligibility must be verified separately.

The backend must determine whether the person can become an official.

If possible, use a permission such as:

```text
canCreateOfficial
```

instead of automatically allowing every official to create another official.

This reduces privilege escalation if one official account is compromised.

Every official creation or verification action should be audited.

Record information such as:

* Who performed the action
* Who was created/verified
* Result
* Timestamp
* Relevant action

Do not store unnecessary sensitive information.

---

## Official Verification

Do not treat an ID number as proof by itself.

The backend should verify the official through the defined barangay process.

Possible states:

```text
pending
verified
rejected
revoked
```

Keep verification information separate from normal resident profile data when appropriate.

Protect verification information from ordinary residents.

---

## Reservation Business Rules

The backend must enforce:

* Valid applicant
* Valid court
* Valid court (Timugan Covered Court)
* Valid date
* Valid time
* Valid reservation duration
* Valid reservation status
* Court availability
* Court closure rules
* No unauthorized modifications
* No unauthorized cancellation
* No double booking

Do not trust values from the frontend.

---

## Double Booking Protection

Availability must not be protected only by frontend checks.

Bad approach:

```text
Frontend checks availability
↓
User submits
↓
Reservation created
```

Two users could submit at almost the same time.

The database/backend must protect against race conditions.

Use appropriate PostgreSQL mechanisms such as:

* Transactions
* Database constraints
* Exclusion constraints where suitable
* Row locking where appropriate
* Secure database functions/RPC

The final reservation operation must be atomic.

The system must never intentionally create two conflicting approved/active reservations for the same court and time.
The system must never intentionally create two conflicting approved/active reservations for the covered court at the same time.

---

## Court Closures

Court closures must be enforced server-side.

Example:

```text
Court closed
↓
Frontend disables the date
↓
Backend still rejects the reservation
```

The backend must always perform the final check.

---

## Reservation Status

Use controlled statuses such as:

```text
pending
approved
rejected
cancelled
completed
no_show
rescheduled
```

Do not allow arbitrary status values from clients.

Use server-side validation and database constraints.

---

## Ownership and IDOR Protection

Always check ownership or permission before returning or modifying user-owned resources.

Example:

```text
GET /reservations/123
```

must verify:

```text
Is this the user's reservation?
OR
Does this user have permission to access it?
```

Changing the ID must not expose another user's information.

This protection must exist on every relevant endpoint.

---

## Input Validation

Validate all input on the backend.

Check:

* Type
* Required fields
* Length
* Format
* Range
* Allowed values
* Date/time rules
* Relationships
* Business rules

Never assume frontend validation is enough.

---

## SQL Injection

Never construct SQL queries using raw string concatenation with user input.

Bad:

```text
"SELECT * FROM users WHERE name = '" + name + "'"
```

Use:

* Parameterized queries
* Supabase query methods
* Safe database functions

Treat all user input as untrusted.

---

## XSS

Backend responses should not blindly trust or transform user input into executable HTML.

If rich HTML is ever accepted, sanitize it properly.

Prefer storing normal text instead of arbitrary HTML when HTML is not required.

---

## Rate Limiting and Abuse Protection

Protect sensitive operations such as:

* Login
* OTP requests
* OTP verification
* Registration
* Reservation submission
* Password reset
* Official account creation
* Repeated API requests

Frontend timers are not enough.

Actual rate limiting must be enforced by the backend/auth provider/infrastructure.

---

## Secrets

Never expose:

* Service-role keys
* Database passwords
* Private API keys
* Server secrets
* JWT signing secrets

to the frontend.

Use environment variables or secure secret management.

The Supabase service-role key must remain server-side.

---

## Error Handling

Do not expose internal errors to users.

Avoid returning:

```text
PostgreSQL table xyz failed because...
```

to public clients.

Use safe messages such as:

```text
Unable to complete the request.
```

Log technical details securely on the server when needed.

For authentication-related errors, avoid unnecessarily revealing whether a particular account exists.

---

## Audit Logs

Record important security-sensitive actions.

Examples:

* Official created
* Official verification changed
* Reservation approved
* Reservation rejected
* Reservation cancelled by official
* Court closed
* Permission changed
* Important account changes

Do not log:

* Passwords
* OTP codes
* Access tokens
* Secret keys

Audit logs must not be editable by ordinary residents.

---

## Privacy

Collect only the information necessary for TICORE.

Private information should not be returned through public endpoints.

Never expose:

* Full address
* Mobile number
* Internal notes
* Official ID information
* Verification documents

unless the requesting user is authorized to access them.

---

## Realtime

Backend operations that modify important data should work correctly with Supabase Realtime.

Examples:

```text
Reservation created
Reservation approved
Reservation rejected
Court closed
Reservation changed
```

Realtime is an update mechanism, not an authorization mechanism.

RLS and backend permissions still determine what data can be accessed.

---

## Database Integrity

Important rules should be enforced at the database level whenever possible.

Examples:

* Valid foreign keys
* Valid statuses
* Unique values
* Required fields
* Reservation conflict prevention
* Valid relationships

Do not put every important rule only inside Python.

---

## Testing

Test both normal and malicious cases.

At minimum test:

### Normal

* Register resident
* Login
* Make reservation
* View own reservation
* Cancel own reservation
* Official approves reservation
* Official rejects reservation

### Security

* Resident tries to become official
* Resident accesses another user's reservation
* User changes reservation ID
* User submits invalid data
* User submits duplicate reservation
* User attempts double booking
* User accesses admin endpoint
* User modifies another user's data
* User attempts to bypass court closure
* Repeated OTP requests
* Invalid OTP
* Expired OTP

---

## Before Making Changes

Before changing backend code:

1. Understand the endpoint or service.
2. Check related frontend usage.
3. Check database tables and constraints.
4. Check RLS implications.
5. Check authentication and authorization.
6. Check whether realtime behavior is affected.
7. Preserve existing API contracts unless change is necessary.
8. Validate all new inputs server-side.
9. Consider malicious requests, not only normal requests.
10. Test ownership and permission boundaries.

Never weaken security just to make a feature easier to implement.
