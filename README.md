# TICORE — Timugan Court Reservation System

TICORE is the official civic court reservation and scheduling platform for **Timugan Main Covered Court**, located in **Barangay Timugan, Los Baños, Laguna**.

The system enables residents to view real-time court availability, submit reservations with conflict-free double-booking prevention, and track approval statuses. It also provides authorized Barangay officials with a protected dashboard for reviewing requests, scheduling official court closures (maintenance, tournaments, emergencies), inspecting immutable audit trails, and managing official credentials.

---

## Tech Stack

- **Frontend:** React 19, Vite 8, Plain CSS (Civic Design System), Oxlint
- **Backend & Database:** Supabase (PostgreSQL 15+, Row Level Security, Realtime WebSocket sync)
- **Authentication:** Supabase Auth (Email & Password, password recovery flows)
- **Deployment Targets:** Netlify or Vercel (Single Page Application with SPA rewrites)

---

## 1. Local Development Setup

### Prerequisites
- Node.js 18.x or later
- npm 9.x or later
- A Supabase project (Auth, Database, and Realtime enabled)

### Step 1: Install Dependencies
Navigate into the `frontend` directory and install dependencies:
```bash
cd frontend
npm install
```

### Step 2: Configure Environment Variables
Create a `.env.local` file inside the `frontend/` directory based on `.env.example`:
```bash
cp .env.example .env.local
```
Edit `frontend/.env.local`:
```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-or-anon-key
```
> **Security Notice:** Only use your Supabase **Publishable / Anon key** in the frontend. Never place the Supabase `service_role` key in frontend code or environment files.

### Step 3: Run the Development Server
```bash
npm run dev
```
The application will start at `http://localhost:5173`.

---

## 2. Production Build & Quality Checks

Run the following commands inside `frontend/`:
```bash
# Code quality and linting (Oxlint)
npm run lint

# Production build
npm run build

# Preview production build locally
npm run preview
```
The output will be generated in `frontend/dist/`.

---

## 3. Supabase Production Configuration Checklist

Before going live, verify the following settings in your [Supabase Dashboard](https://supabase.com/dashboard):

### A. Authentication & Redirect URLs
Navigate to **Authentication -> URL Configuration**:
1. **Site URL:** Set to your production domain, e.g.:
   ```
   https://your-app-name.netlify.app
   ```
2. **Redirect URLs:** Whitelist your domain and callback endpoints:
   ```
   https://your-app-name.netlify.app/**
   https://your-app-name.netlify.app/#account
   https://your-app-name.netlify.app/#reset-password
   http://localhost:5173/**
   ```

### B. Email Authentication
Navigate to **Authentication -> Providers -> Email**:
1. Ensure the **Email Provider** is enabled.
2. Confirm your email confirmation policy (On or Off depending on barangay requirements).
3. If email confirmations are enabled, configure a custom SMTP provider (e.g. Resend, SendGrid) to prevent reaching default Supabase email rate limits.

### C. Database Migrations & Row Level Security (RLS)
Apply the SQL migration files located in `supabase/migrations/` in sequential order:
1. `20260923000001_initial_ticore_schema.sql` (Core schema, GiST exclusion double-booking constraints, RLS)
2. `20260924000002_reservation_workflow_hardening.sql` (Slot checking RPCs, public schedule RPCs)
3. `20260924000003_official_verification_workflow.sql` (Official verification tables, credential protection)
4. `20260924000004_official_dashboard_workflow.sql` (Official administrative actions, audit logging)
5. `20260924000005_supabase_realtime_schedule_sync.sql` (Realtime publication setup, zero-PII schedule sync trigger)

Verify in **Database -> Tables** that Row Level Security (RLS) is enabled on all tables:
- `public.profiles`
- `public.reservations`
- `public.court_closures`
- `public.official_verifications`
- `public.audit_logs`
- `public.court_schedule_realtime_events`

### D. Realtime Configuration
Navigate to **Database -> Replication**:
Verify that the `supabase_realtime` publication includes:
- `public.reservations`
- `public.court_closures`
- `public.audit_logs`
- `public.court_schedule_realtime_events`

---

## 4. Deploying to Production

The project is pre-configured for deployment on either **Netlify** or **Vercel** with full SPA routing fallback.

### Deploying to Netlify

#### Option 1: Netlify UI (Git Integration - Recommended)
1. Connect your Git repository in the Netlify Dashboard.
2. Configure build settings:
   - **Base directory:** `frontend`
   - **Build command:** `npm run build`
   - **Publish directory:** `frontend/dist` (or `dist` if base is `frontend`)
3. Under **Site configuration -> Environment variables**, add:
   - `VITE_SUPABASE_URL`: Your Supabase Project URL
   - `VITE_SUPABASE_PUBLISHABLE_KEY`: Your Supabase Anon/Publishable Key
4. Deploy the site.

#### Option 2: Netlify CLI
```bash
cd frontend
npm install -g netlify-cli
netlify login
netlify init
netlify deploy --prod
```
*Note:* SPA routing is pre-configured via `frontend/public/_redirects` and `netlify.toml`. Direct navigation to routes like `/calendar`, `/reservation`, `/login`, or `/dashboard` will not return 404.

---

### Deploying to Vercel

#### Option 1: Vercel Dashboard (Git Integration - Recommended)
1. Import your Git repository in the Vercel Dashboard.
2. In Project Settings:
   - **Root Directory:** Click edit and select `frontend`.
   - **Framework Preset:** Vite
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
3. Under **Environment Variables**, add:
   - `VITE_SUPABASE_URL`: Your Supabase Project URL
   - `VITE_SUPABASE_PUBLISHABLE_KEY`: Your Supabase Anon/Publishable Key
4. Deploy.

#### Option 2: Vercel CLI
```bash
cd frontend
npm install -g vercel
vercel login
vercel --prod
```
*Note:* SPA routing is pre-configured via `vercel.json`.

---

## 5. Application Routes

| Path / Hash | Description | Access Level |
|---|---|---|
| `/` or `/#home` | Barangay Timugan civic home page | Public |
| `/calendar` or `/#calendar` | Live court availability schedule | Public (Zero PII) |
| `/courts` or `/#courts` | Court facility specifications & amenities | Public |
| `/about` or `/#about` | About TICORE & civic reservation policies | Public |
| `/login` or `/#login` | Resident and official sign-in | Public (Guest) |
| `/register` or `/#register` | Resident registration (always creates resident role) | Public (Guest) |
| `/forgot-password` | Password recovery request | Public |
| `/reset-password` | Set new password via email recovery link | Authenticated Recovery |
| `/reservation` or `/#reservation` | Step-by-step court reservation form | Authenticated Resident |
| `/my-reservations` or `/#my-reservations` | Personal reservation history & status | Authenticated Resident (Own records) |
| `/reservation-details` | Detailed view of user's own reservation | Authenticated Resident (Own records) |
| `/account` or `/#account` | Resident account profile and credentials | Authenticated Resident (Own profile) |
| `/dashboard` or `/official-dashboard` | Barangay Official Dashboard overview & metrics | Verified Barangay Official |
| `/official-reservations` | Manage pending, approved, and rejected reservations | Verified Official (`canManageReservations`) |
| `/official-calendar` | Administrative schedule review | Verified Barangay Official |
| `/official-closures` | Schedule maintenance & official court closures | Verified Official (`canManageCourtClosures`) |
| `/official-portal` | Verification status & official onboarding | Verified Barangay Official |
| `/unauthorized` | 403 Forbidden boundary screen | Authenticated / Public |
| *Unmatched routes* | 404 Page Not Found screen | Public |

---

## 6. Security Guarantees

- **No Secrets in Frontend:** Only the Supabase publishable/anon key is bundled. Service-role keys are never included.
- **Server-Enforced Authorization:** Frontend route guards provide UX navigation, but all data access and administrative operations are enforced server-side by PostgreSQL Row Level Security (RLS) and `SECURITY DEFINER` RPCs.
- **Zero Self-Role Escalation:** Public registration unconditionally creates a `resident` profile. Official accounts require verification by an authorized official via `official_verifications`.
- **Double-Booking Protection:** Backed by database-level PostgreSQL GiST exclusion constraints (`reservations_no_double_booking_excl`) preventing overlapping approved reservations even under simultaneous race conditions.
- **Privacy Preservation:** Public schedules and realtime event streams expose only availability status (`available`, `reserved`, `pending`, `closed`). Applicant names, mobile numbers, and private purposes are restricted to the owner and authorized officials.
