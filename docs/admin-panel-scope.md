# Admin Panel — API Scope

_Status across `tinybit-server` (API) and `tinybit-admin` (UI)._

## Phase 1 — API wiring (complete)

Create/point admin APIs and wire existing UI (no redesign). Waves A–D landed the yellow/orange items below.

### Done — API + UI wired

- **Dashboard** — stats/analytics tiles; Phase 2 also wires subs/revenue/audit feed
- **Users** (Elders / Guardians / Incomplete / Invitations / Family Circle) — list, detail, CRUD, trash/restore/purge, connections
- **Admin Management → Logs** — `admin_audit_log` via `GET /admin/api/audit-log`
- **AI → Usage / Conversations** — conversation volume + read-only transcripts
- **Care → Calendar / Doctors / Family Events / Appointments**
- **Content** (Breathing, Inspirations, Mood Media, Quizzes, FAQs, Tutorials)
- **Emergency → SOS / Contacts / Incidents** (incidents = SOS list)
- **Health** (Checkins, Conditions, Medicines, Vault, Wellness)
- **Journal → Text / Voice / Shared** (shared = `family_messages` proxy)
- **Location → Live** (`elder_locations` snapshot)
- **Notifications → Push / Logs** (+ root notifications history/broadcast)
- **Rewards → Leaderboard / Streaks** (config/rewards tabs still local-only)
- **Subscriptions → Plans / Payments / User Subscriptions / Revenue**
- **Reports** — remapped from `/analytics`

### Explicitly skipped in Phase 1

- **Location → History** — needs a GPS history table (`elder_locations` is live-only)

---

## Phase 2 — Dashboard honesty + easy Static leftovers (in progress)

Finish leftover mock/mixed pages that already have APIs. No net-new product systems.

| Item | Notes |
|------|--------|
| Dashboard KPI cards | Active subs, month revenue, AI active users via extended `/stats`; support tickets stay "—" |
| Dashboard activity feed | Recent `getAuditLogs` |
| Settings → Audit Logs | Same source as Admin Management → Logs |
| Notifications (root) | Live inbox/broadcast history |
| AI → Usage cleanup | Drop mock tokens/cost; use analytics + conversations |

---

## Remaining — net-new feature work (not Phase 1/2)

Needs product scoping + schema before admin wiring:

- **Admin Management → Accounts / Roles / Permissions** + **Settings → Roles** + **Users → Roles** — multi-admin RBAC (single shared login today)
- **AI → Analytics / Costs / Models / Prompts** — no token/cost instrumentation or prompt config store
- **Support → Tickets / Chat / Escalation / Queries** — no ticketing system
- **Rewards → Achievements / Badges** — no schema
- **Notifications → Email / Scheduled** — no email channel or campaign scheduler
- **Location → Geofencing** — no geofence concept
- **Location → History** — needs GPS history table
- **Settings → General / Notifications / Payment / AI / API Keys** — env-var config only; no settings tables
- **Auth → 2FA, Forgot Password** — UI only; not implemented server-side

---

## Totals (historical estimates from Phase 1 planning)

| Bucket | Status |
|---|---|
| Quick wins (pure wiring) | Done (Phase 1) |
| New endpoint on existing table | Done (Phase 1 Waves A–D) |
| Net-new feature (needs scoping) | Still open — see Remaining |
