# TICORE Frontend

This directory contains the React 19 + Vite frontend application for **TICORE** (Timugan Court Reservation System).

For complete system setup, Supabase configuration checklist, and production deployment guides for Netlify and Vercel, please refer to the main repository [README.md](../README.md).

---

## Quick Reference

### Environment Variables
Copy `.env.example` to `.env.local`:
```bash
cp .env.example .env.local
```

Ensure `.env.local` contains:
```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-or-anon-key
```

### Commands
- `npm run dev` — Start local Vite development server at `http://localhost:5173`
- `npm run lint` — Run Oxlint static code analysis
- `npm run build` — Build production bundle into `dist/`
- `npm run preview` — Locally preview the production build

### Deployment Pre-configurations Included
- **Netlify:** Pre-configured via `public/_redirects` and `netlify.toml`
- **Vercel:** Pre-configured via `vercel.json`
- **SPA Fallback:** All routes (`/calendar`, `/reservation`, `/login`, `/dashboard`, etc.) resolve to `index.html` with full client-side routing.
