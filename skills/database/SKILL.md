# TICORE Database Skill

## Purpose

Design and maintain TICORE's Supabase/PostgreSQL database with strong data integrity, security, performance, and clear relationships.

The database must act as an additional security layer.

---

## Tech Stack

Use:

* Supabase
* PostgreSQL
* Supabase Auth
* PostgreSQL Row Level Security (RLS)
* Supabase Realtime
* SQL migrations

Database changes should be made through migrations whenever possible.

---

## Core Tables

The exact schema may evolve, but TICORE will likely need tables similar to:

```text
profiles
reservations
courts
courts (single facility: Timugan Covered Court)
court_closures
official_verifications
audit_logs
```

Additional tables may be created when needed.

Do not create unnecessary duplicate tables.

---

## Profiles

User profile data should be associated with Supabase Auth users.

Typical relationship:

```text
auth.users
    ↓
profiles
```

Use the authenticated user's ID as the relationship where appropriate.

Do not allow ordinary users to directly change protected fields such as:

```text
role
permissions
verification_status
```

---

## Roles

Current roles:

```text
resident
official
```

A newly registered user should default to:

```text
resident
```

Never allow public registration to directly insert:

```text
official
```

Role changes must go through a secure process.

Database policies should prevent unauthorized role modification.

---

## Permissions

For sensitive systems, roles alone may not be enough.

Permissions can represent capabilities such as:

```text
canCreateOfficial
canManageReservations
canManageCourts
canManageCourt
canViewReports
```

Sensitive permission changes must be protected.

Avoid giving every official unlimited administrative power unless that is intentionally required.

---

## Official Verification

Keep official verification data protected.

Possible fields:

```text
user_id
full_name
mobile
position
id_type
id_number
verification_status
verified_by
verified_at
created_at
```

The exact fields may change according to the final requirements.

Do not expose official ID information to ordinary residents.

Do not assume an ID number is proof of official status.

OTP and official verification are separate concepts.

---

## Relationships

Use proper foreign keys.

Example:

```text
profiles
    ↓
reservations
    ↓
courts
```

Use foreign keys to maintain data integrity.

Avoid storing the same important information repeatedly when a relationship can be used instead.

---

## Reservations

Reservations should contain enough information to identify:

* Applicant
* Court
* Court (Timugan Covered Court)
* Date
* Start time
* End time
* Purpose
* Status
* Creation time
* Update time

Example statuses:

```text
pending
approved
rejected
cancelled
completed
no_show
rescheduled
```

Use database constraints to prevent invalid status values.

---

## Double Booking

This is a critical database rule.

Do not depend only on:

```text
SELECT availability
↓
INSERT reservation
```

because two requests can happen at the same time.

Use PostgreSQL mechanisms appropriate for the reservation design.

Possible solutions include:

* Exclusion constraints
* Transactions
* Locks
* Database functions/RPC
* Appropriate unique/partial indexes

The final design must prevent conflicting active reservations for the same court and time.
The final design must prevent conflicting active reservations for the Timugan Covered Court at the same time.

---

## Court Closures

Court closures should be stored in a dedicated structure when appropriate.

Example:

```text
court_closures
```

Possible information:

```text
court_id
start_datetime
end_datetime
reason
created_by
created_at
```

The backend/database must prevent reservations during a closure.

Do not rely only on the calendar UI.

---

## Row Level Security

RLS is required for protected Supabase data.

Policies should follow the principle:

> Users can access only the records they are authorized to access.

Examples:

### Resident

Can:

* View own profile
* View own reservations
* Create allowed reservations
* Update allowed information

Cannot:

* View another resident's private information
* Change their own role
* View official verification data
* Modify admin data

### Official

Can access administrative data only according to their permissions.

RLS should not simply be:

```text
if authenticated then allow everything
```

---

## Public Calendar Data

Public availability should expose only safe information.

Allowed examples:

```text
available
pending
reserved
closed
```

Do not expose:

* Applicant name
* Phone number
* Full address
* Private purpose
* Internal notes
* Official verification details

If necessary, create a safe database view or query that exposes only public fields.

---

## IDOR Protection

RLS must help prevent insecure direct object references.

For example:

```text
reservation_id = 123
```

must not automatically allow a resident to retrieve reservation 123.

The policy should verify ownership or appropriate permission.

Never depend only on frontend routing.

---

## Constraints

Use database constraints whenever possible.

Examples:

* `NOT NULL`
* `UNIQUE`
* `CHECK`
* Foreign keys
* Appropriate indexes
* Exclusion constraints where applicable

Database constraints should protect against invalid data even if the application has a bug.

---

## Indexes

Add indexes to columns frequently used for:

* User lookups
* Reservation searches
* Court filtering
* Date/time filtering
* Date/time filtering (covered court schedule)
* Status filtering
* Administrative dashboards

Do not create indexes randomly.

Consider actual query patterns.

---

## Audit Logs

Audit logs should record important administrative/security actions.

Examples:

```text
official_created
official_verified
reservation_approved
reservation_rejected
reservation_cancelled
court_closed
permission_changed
```

Include useful metadata such as:

* Actor
* Action
* Target
* Timestamp
* Relevant safe details

Never store:

* Passwords
* OTP codes
* Access tokens
* Secret keys

Protect audit logs using RLS.

Ordinary residents must not be able to edit or delete audit records.

---

## Privacy

Store only information required for the system.

Separate highly sensitive information where appropriate.

Do not expose sensitive columns through public queries.

Be careful when creating:

* Views
* RPC functions
* Realtime subscriptions
* API responses

A table being protected does not automatically mean every view or function is safe.

---

## Realtime and RLS

Supabase Realtime should respect the system's authorization model.

Realtime may be used for:

* Reservation changes
* Reservation status
* Calendar updates
* Court closures
* Dashboard updates

Do not create a broad subscription that sends sensitive records to everyone.

Only authorized data should be available to each user.

---

## Soft Deletion

For important records, consider soft deletion rather than immediately deleting them.

For example:

```text
deleted_at
```

may be used where appropriate.

This can help preserve:

* Audit history
* Reservation history
* Administrative records

Do not use soft deletion automatically for every table. Use it where it provides a real benefit.

---

## Migrations

Database changes should be reproducible.

Use migrations for:

* New tables
* New columns
* Constraints
* Indexes
* RLS policies
* Functions
* Views
* Triggers

Do not make undocumented manual production changes.

---

## Security Testing

Test:

* Resident accessing own reservation
* Resident accessing another reservation
* Resident changing role
* Resident accessing official verification
* Official accessing allowed records
* Unauthorized official actions
* Double booking
* Reservation during court closure
* Invalid foreign keys
* Invalid status values
* Duplicate records
* RLS bypass attempts

---

## Before Making Changes

Before changing the database:

1. Check existing schema.
2. Check foreign-key relationships.
3. Check existing RLS policies.
4. Check indexes.
5. Check backend queries.
6. Check frontend data requirements.
7. Check realtime behavior.
8. Check privacy implications.
9. Use a migration.
10. Test both authorized and unauthorized access.

Never remove or weaken RLS simply because it makes development easier.
