# TinyBit Server — Project Guide

Single source of truth for AI sessions and developers working on **tinybit-server** (DD Medax / TinyBit elderly health companion backend).

**Related repos**

| Repo | Role |
|------|------|
| `tinybit` (Expo SDK 56) | Mobile app — consumes `/api/*` |
| `tinybit-admin` (separate) | Admin UI — consumes `/admin/api/*` |
| **This repo** | Node/Express API + embedded admin dashboard |

**Production target:** AWS EC2 + RDS MySQL + PM2 (`tinybit-api`, port **5002**), with S3 for
media storage.

---

## Tech stack

| Item | Version / notes |
|------|----------------|
| Node | `>=20` (engines in `package.json`) |
| Express | 4.x |
| Database | **MySQL 8** via `mysql2/promise` pool (`src/config/mysql.js`) |
| Auth | Custom JWT (`JWT_SECRET`) + Firebase Admin (Google + Phone ID tokens) |
| AI | OpenAI + Google Gemini (env keys; used in `src/controllers/ai.controller.js`) |
| Media | AWS S3 presigned URLs (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`) |
| Docs | Swagger UI at `/api/docs`, OpenAPI JSON at `/api/docs/openapi.json` |
| Admin UI | Static assets in `public/admin/`, served under `/admin` |

**Not used in production path:** Supabase Auth, Twilio OTP (endpoints return **410**).

---

## Quick start (local)

```bash
cp .env.example .env   # fill JWT_SECRET, MYSQL_*, FIREBASE_*, optional S3/AI keys
npm ci
npm run dev            # nodemon
# or
npm start
```

Health check: `GET /api/health` → `{ status, db, dbOk }`.

---

## Deployment

### AWS EC2 (recommended)

```bash
git pull
npm ci --omit=dev
pm2 restart tinybit-api
```

Typical `.env` on EC2:

```env
PORT=5002
DB_DRIVER=mysql
MYSQL_HOST=<rds-host>.ap-northeast-1.rds.amazonaws.com
MYSQL_USER=<user>
MYSQL_PASSWORD=<pass>
MYSQL_DATABASE=tinybit
JWT_SECRET=<secret>
FIREBASE_SERVICE_ACCOUNT_JSON=<one-line JSON>
OPENAI_API_KEY=...
GEMINI_API_KEY=...
SERVER_URL=https://<public-api-host>:5002
S3_BUCKET=tinybit-media-prod
S3_REGION=ap-northeast-1
```

EC2 instance IAM role needs S3: `PutObject`, `GetObject`, `DeleteObject` on `arn:aws:s3:::tinybit-media-prod/*`.

---

## Architecture

```
src/
├── index.js                 # Express app, route mounting, error handler, listen()
├── config/
│   ├── mysql.js             # Connection pool, query(), execute()
│   ├── storage.js           # S3_BUCKET, S3_REGION, buildPublicUrl()
│   └── swagger.js           # OpenAPI generation + /api/docs mount
├── middleware/
│   └── jwtAuth.middleware.js   # Bearer JWT → req.auth / req.supabase { userId, email }
├── routes/                  # Thin routers → controllers
├── controllers/             # HTTP layer: validate, call services, JSON responses
├── services/
│   ├── *.service.js         # Facade — almost all re-export *.mysql.js
│   ├── *.mysql.js           # SQL implementation (active path)
│   ├── *.supabase.js        # Legacy stubs — NOT wired when DB_DRIVER=mysql
│   ├── admin-catalog.mysql.js
│   ├── storage.service.js   # S3 presign upload/download/delete
│   ├── jwt.service.js
│   ├── firebase-admin.service.js
│   └── auth-users.mysql.js  # Users, passwords, refresh tokens, sessions
├── swagger/
│   ├── schemas.js
│   └── paths/*.js           # JSDoc @openapi blocks per domain
├── utils/                   # phone, otp, verificationToken
└── db/index.js              # getDriver(), isDuplicateKeyError()

mysql/schema.sql             # Canonical schema (27 tables) — apply to RDS manually
public/admin/                # Bundled admin dashboard static files
```

### Request flow

1. Route → middleware (`requireJwtAuth` where needed).
2. Controller parses body/query, maps errors to HTTP status.
3. Service (`*.mysql.js`) runs parameterized SQL via `config/mysql.js`.
4. JSON response `{ success: true, ... }` or `{ success: false, message }`.

### Auth model

| Flow | Endpoint | Notes |
|------|----------|-------|
| Google | `POST /api/auth/google` | Firebase ID token → `findOrCreateByGoogle` → JWT session |
| Phone | `POST /api/auth/phone` | Firebase phone ID token → user row → JWT session |
| Email/password (legacy) | `POST /api/auth/login`, `/register` | Verification token + password |
| Refresh | `POST /api/auth/refresh` | Refresh token rotation |
| Profile | `PATCH /api/auth/profile` | Upsert `profiles` row |
| **Removed** | `POST /api/auth/otp/*` | Returns **410** — use Firebase on device |

**Mobile clients:** send `Authorization: Bearer <access_token>` on protected routes.

**Admin clients:** `POST /admin/api/login` → Bearer admin session token on `/admin/api/*`.

---

## Database (MySQL)

**Schema file:** `mysql/schema.sql`  
**Driver:** `DB_DRIVER=mysql` (default). All active `*.service.js` files point to `*.mysql.js`.

### Tables (39)

| Group | Tables |
|-------|--------|
| Auth | `app_users`, `refresh_tokens`, `otp_verifications` (legacy) |
| User | `profiles`, `user_settings`, `elder_locations`, `streak_activity_log` |
| Guardian | `guardian_elder_links` |
| Safety | `emergency_contacts`, `sos_alerts` |
| Health | `medicines`, `medicine_logs`, `calorie_goals`, `meal_logs`, `daily_checkins`, `mood_entries`, `health_readings`, `health_records` |
| Calendar | `appointments`, `care_events` |
| Social | `journal`, `family_messages` |
| AI | `ai_conversations` |
| Content | `mood_media_tracks`, `mood_media_favorites`, `mind_games_scores`, `daily_quiz_questions`, `daily_inspirations`, `doctors`, `saved_doctors`, `help_tutorials`, `help_faqs` |
| System | `notifications`, `admin_audit_log` |
| Guardian payments (Razorpay) | `payment_pricing_tiers`, `payment_orders`, `payments`, `payment_refunds`, `payment_webhook_events` — see "Guardian payments" section below |

**FK pattern:** Most user-owned rows reference `profiles(id)` (which references `app_users(id)`).

### Important column conventions

| Feature | Column | Format |
|---------|--------|--------|
| Health vault file | `health_records.uri` | HTTPS S3 URL (`file_url` on create) — **no base64** |
| Journal voice | `journal.audio_uri` | HTTPS S3 URL (`audio_url` on create) — **no base64** |
| Profile photo | `profiles.profile_image` | HTTPS S3 URL — **no data: URIs** |
| Mood media | `mood_media_tracks.audio_url` | HTTPS S3 URL (admin catalog) |
| Doctor photo | `doctors.image_url` | HTTPS S3 URL optional (admin catalog) |

---

## S3 media storage

Private bucket; clients never receive AWS keys. Stored in DB as virtual-host style URL:

`https://{bucket}.s3.{region}.amazonaws.com/{key}`

Or override with `S3_PUBLIC_BASE_URL` (CloudFront).

### Key layout

```
{purpose}/{ownerId}/{uuid}.{ext}
```

| Purpose | Owner segment | Used by |
|---------|---------------|---------|
| `health-vault` | `{userId}` | Health vault PDFs/images |
| `journal` | `{userId}` | Voice journal audio |
| `profile` | `{userId}` | Avatar |
| `catalog` | `admin` | Mood media audio, doctor images (admin upload) |

### Mobile API (`Authorization: Bearer JWT`)

| Method | Path | Body |
|--------|------|------|
| POST | `/api/storage/presign-upload` | `{ purpose, filename, content_type? }` |
| POST | `/api/storage/presign-download` | `{ key }` |

Response upload: `{ uploadUrl, key, fileUrl, contentType, expiresIn }` (15 min TTL).

Download rules:

- User-owned keys: `purpose/userId/...` must match JWT `sub`.
- Catalog keys: `catalog/...` readable by **any** authenticated user (for mood media playback).

### Admin API (`Authorization: Bearer admin session`)

| Method | Path | Body |
|--------|------|------|
| POST | `/admin/api/storage/presign-upload` | `{ filename, content_type? }` → always `catalog/admin/...` |

Workflow for **tinybit-admin**:

1. Presign upload → PUT file to `uploadUrl`.
2. Save returned `fileUrl` as `audio_url` or `image_url` in catalog CRUD.

### S3 bucket CORS (required for direct PUT from app/admin)

```json
[{
  "AllowedHeaders": ["*"],
  "AllowedMethods": ["PUT", "GET"],
  "AllowedOrigins": ["*"],
  "ExposeHeaders": ["ETag"]
}]
```

If `S3_BUCKET` is unset, storage endpoints return **503** — no silent fallback to MySQL blobs.

---

## Mobile API reference (`/api`)

Base URL example: `https://<host>:5002/api`.

Swagger covers most routes (admin excluded). Summary by router:

### Auth — `/api/auth`

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | `/google`, `/phone` | No | Returns `{ session: { access_token, refresh_token, user } }` |
| POST | `/login`, `/register` | No | Legacy password flow |
| POST | `/refresh`, `/logout` | No / optional | Session rotation |
| GET | `/me` | JWT | Profile + user |
| PATCH | `/profile` | JWT | `profile_image` must be HTTPS if set |
| GET/PATCH | `/settings` | JWT | User settings |
| POST | `/otp/*` | — | **410 Gone** |

### Storage — `/api/storage`

Presign upload/download (see S3 section).

### Health vault — `/api/health-vault`

| Method | Path | Notes |
|--------|------|-------|
| GET | `/records` | List user records |
| POST | `/records` | Requires `file_url` (HTTPS) + metadata |
| DELETE | `/records/:id` | |

### Journal — `/api/journal`

| Method | Path | Notes |
|--------|------|-------|
| GET | `/`, `/count` | List / count |
| POST | `/` | Voice type requires `audio_url` (HTTPS) |

### Wellness — `/api/wellness`

Daily check-in, health metrics, yesterday summary.

### Medicines — `/api/medicines`

CRUD medicines + `/logs`, `/logs/toggle`.

### Appointments — `/api/appointments`

List, create, patch status.

### Care events — `/api/care-events`

| Method | Path | Notes |
|--------|------|-------|
| GET | `/` | Returns **both** `careEvents` and `events` (same array) |

**No POST/PATCH/DELETE yet** — read-only from mobile.

### Doctors — `/api/doctors`

Public list + get by id (from `doctors` table — populate via admin).

### Content — `/api/content`

| Method | Path | Notes |
|--------|------|-------|
| GET | `/quiz/today` | 404 if no rows in `daily_quiz_questions` |
| GET | `/inspiration/today` | 404 if no rows in `daily_inspirations` |

Quiz response includes **both** legacy (`q`, `opts`, `ans`) and API (`question`, `options`, `correct_index`) field names.

### Mood media — `/api/mood-media`

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/:category` | No | `bhajans`, `meditation`, `jokes_fun`, `nature_sounds` |
| GET/POST/DELETE | `/favorites` | JWT | User favorites |

Categories must match DB CHECK constraint exactly.

### Mind games — `/api/mind-games`

POST scores, GET stats, GET leaderboard.

### AI — `/api/ai`

| Path | Purpose |
|------|---------|
| `/chat` | Sathi AI chat |
| `/transcribe`, `/tts` | Voice |
| `/analyze-report` | Health vault scan (base64 in request body — AI only, not stored) |
| `/analyze-food`, `/suggest-clothing`, `/wellness-summary`, `/health-forecast`, `/health-forecast-multi` | Wellness AI |

Requires `OPENAI_API_KEY` / `GEMINI_API_KEY` per implementation branch in controller.

### Guardian — `/api/guardian`

Invites, connections, elder list (+ `DELETE /elders/:elderId` to unlink), alerts, location
(now backed by real `elder_locations` GPS rows, gated by the elder's `is_sharing` flag — not the
old `profiles.location` text field), reports, and per-elder detail (`GET /elders/:elderId/summary`
— mood + check-in history).

**`POST /elders`** (ADR 0004, `docs/adr/0004-guardian-created-elder-shadow-profile.md`) — guardian
creates a full elder profile directly when the elder isn't on the app yet. Unlike `POST /invite`,
this is **not** a pending invite: it creates a REAL, immediately-claimable `app_users` row
(`password_hash = NULL`) + `profiles` row (`role='elder'`) + `guardian_elder_links` row with
`status='connected'` — all in one transaction (new `src/config/mysql.js#withTransaction` helper,
`getPool().getConnection()` + `beginTransaction`/`commit`/`rollback`). No new auth-matching logic
was needed: `findOrCreateByPhone`/`findOrCreateByGoogle` already check `app_users.phone_e164`/
`email` first, so when the real elder later signs in with the same phone (OTP) or email (Google)
they land on exactly this profile (`isNewUser: false`). Body: `{ first_name, last_name, email,
mobile, mobile_country, relation, location?, country?, country_code?, date_of_birth?, blood_group?,
biological_sex?, preferred_language?, height?, height_unit?, weight?, weight_unit?,
medical_conditions?, other_condition?, medical_notes?, allergies?, doctor_name?, doctor_contact?,
profile_image? }`. Notes:
- No `age` field — elder age is captured as `date_of_birth` only (age intentionally not written at
  create time; `profiles.age` still exists and is used elsewhere, e.g. elder self-onboarding).
- `other_condition` and `medical_notes` are two distinct free-text inputs on `create-elder-profile.tsx`
  (an explicit "other condition" field and a separate "additional notes" field) that both target the
  single `profiles.other_condition` column (no new column) — the controller concatenates both
  (`" | "`-joined) when present so neither is silently dropped.
- **Emergency contact is not client-supplied at create time** — `emergency_name`/`emergency_phone`/
  `emergency_relation` are always derived server-side from the *guardian's own profile* (the guardian
  is the elder's default emergency contact), never trusted from the request body. Editable later via
  `PATCH /elders/:elderId/profile` (below), which *does* accept explicit values from the client.

Guardian-supplied phone/email must be unique across `app_users` — returns `409 { code: 'PHONE_TAKEN' |
'EMAIL_TAKEN' }` rather than silently attaching to an unrelated existing account. Applies the same
mid-cycle tier-upgrade gate as `POST /invite` (`402 { code: 'UPGRADE_REQUIRED', order }`) since a
shadow elder counts toward `elder_count` exactly like an invite does. Response: `{ success: true,
elder: { id, first_name, last_name, email, mobile, relation, location, country, country_code,
date_of_birth, blood_group, biological_sex, preferred_language, height, height_unit, weight,
weight_unit, medical_conditions, other_condition, allergies, doctor_name, doctor_contact,
emergency_name, emergency_phone, emergency_relation, profile_image } }`.

**`GET /elders/:elderId/profile`** / **`PATCH /elders/:elderId/profile`** — full elder-profile
read/update for the guardian "Edit Elder Profile" screen. GET returns the same field set as the
`POST /elders` response above (camelCase JSON: `firstName`, `bloodGroup`, `dateOfBirth`, etc.,
wrapped in `{ success, data }` like `/summary`/`/dashboard`). PATCH accepts a partial snake_case body
of the same fields (minus `role`) — unlike creation, **PATCH does accept explicit
`emergency_name`/`emergency_phone`/`emergency_relation`** from the client (a guardian can override the
auto-derived value from create time). Email/mobile uniqueness on change reuses the same
`409 EMAIL_TAKEN`/`PHONE_TAKEN` pattern as `POST /elders`, excluding the elder's own row.

**Elder-scoped write endpoints** (guardian manages a connected elder's own data; every route is
gated by `guardianService.isConnectedToElder(guardianId, elderId)`; none of these touch the
elder-facing `/api/medicines`, `/api/health-vault/*`, or `/api/storage/*` routes):

| Method | Path | Notes |
|--------|------|-------|
| GET/POST | `/elders/:elderId/medicines` | List / create — mirrors `/api/medicines`, notifies the elder via push on change |
| GET | `/elders/:elderId/medicines/:id` | Single fetch — used by `add-medicine.tsx` in guardian mode |
| PATCH/DELETE | `/elders/:elderId/medicines/:id` | Update / delete |
| GET | `/elders/:elderId/medicines/logs` | Read-only — guardian never marks a dose "taken" on the elder's behalf |
| GET | `/elders/:elderId/medicines/adherence-week` | Mon–Sun (UTC) per-day medicine adherence bucket — `good`\|`ok`\|`poor`\|`none`\|`future` + `percent`, computed from each active medicine's `days_of_week`/start-end window matched against `medicine_logs`. **Not yet consumed by the mobile app** (see note below). |
| GET/POST | `/elders/:elderId/health-records` | Mirrors `/api/health-vault/records` |
| DELETE | `/elders/:elderId/health-records/:id` | |
| POST | `/elders/:elderId/health-records/:id/insights` | `?refresh=true\|false` — mirrors `/api/health-vault/records/:id/insights`; uses/caches the elder record's `ai_insights` column same as the self-service endpoint |
| POST | `/elders/:elderId/health-records/compare` | Body: `{ recordIds: string[] }` (2+) — mirrors `/api/health-vault/compare` |
| GET/POST | `/elders/:elderId/doctors` | Elder's saved doctors — mirrors `/api/health-vault/doctors` |
| DELETE | `/elders/:elderId/doctors/:id` | |
| GET/PATCH | `/elders/:elderId/profile` | Full elder-profile read/update — see `POST /elders` notes above for field set and emergency-contact semantics |
| POST | `/elders/:elderId/storage/presign-upload` | Keys the S3 object under the **elder's** id (not the guardian's), so the elder can read it back via the normal `/api/storage/presign-download` |
| POST | `/elders/:elderId/storage/presign-download` | For the guardian to re-read a file keyed under the elder's id |
| GET | `/elders/:elderId/dashboard` | Guardian Home Dashboard — profile, medicines+adherence, memories count, mind-games score, real "Today's Activity" feed, plus `mood`/`lastActiveAt` (today's `daily_checkins` mood + `profiles.last_active`), `checkinWeek` (Mon–Sun `done`\|`missed`\|`pending`\|`future`), and an embedded `location` object (all fields null unless the elder has `is_sharing` on in `elder_locations`). |
| GET | `/elders/:elderId/co-guardians` | Other guardians also connected to this elder (Family Circle screen) |
| GET/POST | `/elders/:elderId/emergency-contacts` | Elder's emergency contacts (Quick Actions screen) |
| POST | `/elders/:elderId/notify-guardians` | Push-notifies the elder's *other* connected guardians (Alerts "Notify Caregiver", Quick Actions "SOS Alert") |
| POST | `/elders/:elderId/send-reminder` | One-off push notification to the elder (Quick Actions "Send Reminders") |

`GET /reports?period=weekly|monthly|yearly` is now period-aware (was previously hardcoded to a
7-day window regardless of the query param) — weekly returns 7 daily bars, monthly ~4 weekly bars
over the last 30 days, yearly 12 monthly bars over the last 365 days. Check-in streak is always
"consecutive days ending today" over a fixed 30-day lookback, independent of the selected period.

**Frontend/backend drift (as of commit `7e49c58`):** the `mood`/`lastActiveAt`/`checkinWeek`/
`location` fields on the dashboard response and the whole `medicines/adherence-week` endpoint were
added here, but `tinybit`'s paired "Guardian screens" commit (`06ed716`) removed the matching
frontend types (`GuardianElder.mood/lastActiveAt`, `GuardianElderDashboard.mood/lastActiveAt/
checkinWeek/location`, `GuardianMedicineAdherenceDay`) and UI (7-Day Adherence strip, mood/
last-active display) rather than wiring them up — a new UI for these is planned but not yet built.
Until then these fields/endpoint have no mobile caller.

### SOS — `/api/sos`

Trigger alert + emergency contacts CRUD.

### Location — `/api/location`

Elder location GET/PUT.

### Health card — `/api/health-card`

QR generation (uses `SERVER_URL`) + public read by token.

### Family messages — `/api/family/messages`

Latest, count, create — accepts `content` or `message` alias; default date today. Create also
accepts an optional `audio_url` (voice message; requires migration below). `POST
/presign-download` `{ audio_url }` lets either the sender or receiver play a voice message back —
needed because the object is keyed under the *sender's* id, so the generic
`/api/storage/presign-download` would reject the receiver. `GET /history?with=<userId>&limit=` —
full two-way thread between the caller and `with`, newest first (default limit 50, max 200); safe
by construction since the query only ever returns rows where the caller is sender or receiver, so
an arbitrary `with` value just yields an empty/existing thread, never another pair's messages.

**Pending manual migration**: `mysql/add_family_messages_audio.sql` adds `family_messages.audio_url`
— run it against RDS before voice messages go live.

---

## Guardian payments (Razorpay) — `/api/payments`

Guardians must complete payment before using any `/api/guardian/*` endpoint — enforced by
`requireActivePlan` middleware (checks `profiles.plan_status='active' AND plan_expires_at > now()`
for `role='guardian'` callers only; elders always pass through untouched). No free trial. Manual
renewal, not auto-recurring (no Razorpay Subscriptions/mandates) — each payment is a standalone
Razorpay Order for one plan period. Full design rationale: `CONTEXT.md` and `docs/adr/0001-0003`.

Price is looked up from the admin-editable `payment_pricing_tiers` table, keyed by
`(country_code, elder_count)` — `country_code='*'` is the fallback for any country without an
explicit row; elder counts beyond the highest configured row for a country reuse that row's price.
`elder_count` for pricing/gating = `guardian_elder_links` rows with status `pending` **or**
`connected` (sending an invite counts immediately, before acceptance).

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/api/payments/pricing` | JWT | Current tier + next tier for the caller's country/elder_count |
| GET | `/api/payments/pricing/tiers` | JWT | All active tiers for the caller's country (falls back to the `*` default-country tiers if none) — powers the mobile Plan Selection screen where a guardian picks an elder-count tier up front, not just current-vs-next |
| POST | `/api/payments/orders` | JWT | Creates a renewal Order at the full tier price (first payment or post-expiry renewal) |
| POST | `/api/payments/orders/:id/verify` | JWT | Body: `razorpay_payment_id`, `razorpay_order_id`, `razorpay_signature` — verifies signature, applies plan update. Fast client-confirmation path; the webhook is the authoritative backstop |
| GET | `/api/payments/history` | JWT | Guardian's own past orders + payment status |
| POST | `/api/payments/webhook` | HMAC (no JWT) | `X-Razorpay-Signature` over the raw body (`req.rawBody`, captured by a `verify` hook on the global `express.json()` in `index.js`). Handles `payment.captured`, `payment.failed`, `refund.processed`; idempotent via `payment_webhook_events.razorpay_event_id` (also checks `X-Razorpay-Event-Id` header) |
| POST | `/api/payments/dev-complete` | JWT | **DEV ONLY — env-gated (`ALLOW_DEV_PAYMENTS=true`), do not enable in production.** Body: `{ elder_count }`. Fakes a successful renewal payment (no Razorpay call, no signature check) using the real pricing lookup + `applyPlanUpdate`, so mobile onboarding is testable before real Razorpay checkout ships. 404s (not 403) when the env flag is unset, checked *before* JWT auth so the route's existence isn't revealed. Writes `payment_orders`/`payments` rows with `dev_order_*`/`dev_payment_*` Razorpay ids and `payments.method='dev_mock'` so they're trivially identifiable and truncatable later. See `docs/adr/0005-dev-mode-payment-bypass.md`. |

**Mid-cycle elder-count upgrades** (ADR 0003): adding an elder that would push `elder_count` past
what the guardian's plan currently covers (`profiles.plan_elder_count`) is blocked at
`POST /api/guardian/invite` — returns `402 { code: 'UPGRADE_REQUIRED', order }` carrying a
pre-built upgrade Order. The charge is a **flat delta** (`new_tier.amount − profiles.plan_amount`,
not time-weighted), and `plan_expires_at` is **not** extended — only `plan_amount`/`plan_elder_count`
bump once paid. Removing an elder is a no-op (no downgrade, no partial refund) until natural
renewal. If the computed delta is `<= 0` (e.g. admin lowered prices), the tier bump is applied
immediately with no Razorpay order (Razorpay rejects non-positive amounts).

**Admin** (`/admin/api/...`, Bearer admin session, audit-logged):

| Method | Path | Notes |
|--------|------|-------|
| GET/POST/PATCH/DELETE | `/admin/api/pricing-tiers` | CRUD on `payment_pricing_tiers` |
| GET | `/admin/api/payments/orders`, `/orders/:id` | Full order/payment history, any guardian |
| POST | `/admin/api/payments/:id/refund` | `:id` is a `payments.id`. Body: `{ amount?, speed?, reason? }` — `amount` defaults to the full captured amount; `speed` is `'normal'` (default) or `'instant'`. Only guardian-facing refund path — no self-serve refund from the app |

**Env vars**: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` (must match the
secret configured on the Razorpay Dashboard's webhook, Settings → Webhooks).

---

## Admin API reference (`/admin`)

**Login:** `POST /admin/api/login` `{ username, password }` → Bearer token.  
**Env:** `ADMIN_USERNAME`, `ADMIN_PASSWORD`, optional `ADMIN_JWT_SECRET`.

### Operations dashboard (existing)

Stats, analytics, users CRUD, connections, medicines/check-ins/moods read-only, AI conversations read-only, care events read-only, mind games read-only, broadcast.

### Catalog CRUD (P1 — for tinybit-admin)

All require admin Bearer token. **No seed data** — content comes from admin only.

| Resource | Base path |
|----------|-----------|
| Doctors | `/admin/api/doctors` |
| Mood media | `/admin/api/mood-media` |
| Quiz questions | `/admin/api/quiz-questions` |
| Inspirations | `/admin/api/inspirations` |
| S3 presign | `/admin/api/storage/presign-upload` |

Mood media categories: `bhajans`, `meditation`, `jokes_fun`, `nature_sounds`.

Validation:

- `audio_url` — required HTTPS on create/update.
- `icon_url`, `image_url` — HTTPS if provided.

Implementation: `src/services/admin-catalog.mysql.js`, `src/controllers/admin-catalog.controller.js`.

Embedded dashboard: `GET /admin/` serves `public/admin/`.

---

## API contract notes (mobile app alignment)

These were fixed explicitly for the Expo app — **do not regress**:

| Area | Server behavior |
|------|-----------------|
| Health vault create | `file_url` / `fileUrl` / HTTPS `uri` only |
| Journal voice | `audio_url` / `audio_uri` HTTPS only |
| Profile patch | `profile_image` HTTPS only |
| Care events list | `{ careEvents, events }` both present |
| Family messages | `content` ↔ `message` aliases |
| Content quiz | Dual field naming (see Content section) |
| Errors | No mock/fallback data on server — return 4xx/5xx with `message` |

Mobile app (`tinybit`) also removed client-side fallbacks — API failures surface to the user.

---

## Environment variables

See `.env.example` for the full list. Critical:

| Variable | Required | Purpose |
|----------|----------|---------|
| `JWT_SECRET` | Yes | Sign/verify access tokens |
| `MYSQL_*` or `MYSQL_URL` | Yes | Database |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Yes (Google/Phone auth) | Verify Firebase ID tokens |
| `S3_BUCKET` | Yes (media features) | Presigned uploads |
| `SERVER_URL` | Yes (health QR) | Public base URL in QR codes |
| `OPENAI_API_KEY` | For AI routes | Chat, vision, etc. |
| `GEMINI_API_KEY` | For AI routes | Alternate/fallback models |
| `ADMIN_USERNAME/PASSWORD` | Admin panel | |
| `RAZORPAY_KEY_ID/KEY_SECRET/WEBHOOK_SECRET` | Yes (guardian payments) | Order creation, signature verification — see "Guardian payments" |
| `ALLOW_DEV_PAYMENTS` | **No — DEV ONLY, must stay unset on production EC2** | Enables `POST /api/payments/dev-complete` (ADR 0005 dev-mode payment bypass) |
| `TWILIO_*` | **No** | Deprecated |

---

## Legacy / cleanup candidates

Files still in repo but **not on the MySQL production path**:

- `src/services/*.supabase.js` — historical; facades no longer switch to these.
- `src/config/supabase.js`, `src/middleware/supabaseAuth.middleware.js` — unused for current auth.
- `supabase/` migrations — reference only; RDS uses `mysql/schema.sql`.
- Twilio OTP utilities — endpoints hard-disabled.

Safe future task: delete Supabase files after final audit.

---

## Completed plan (backend)

| Phase | Status | Summary |
|-------|--------|---------|
| **MySQL migration** | Done | All active services use `*.mysql.js`; RDS on AWS |
| **Firebase auth** | Done | Google + Phone; Twilio OTP → 410 |
| **P0 API contracts** | Done | Health vault, journal, care-events, content, family-messages field aliases |
| **Swagger** | Done | `/api/docs`, ~80 mobile operations documented |
| **P1 Admin catalog API** | Done | Doctors, mood-media, quiz, inspirations CRUD — no dummy seed |
| **P2 S3 storage** | Done | Mobile presign upload/download; HTTPS-only media in DB |
| **P3 App media (server side)** | Done | Health vault, journal, profile reject non-HTTPS |
| **P4 Admin S3** | Done | `/admin/api/storage/presign-upload`; catalog URL validation |
| **Error policy** | Done | No base64/blob fallback for user media; explicit 400/503 |
| **P5 Guardian payments (Razorpay)** | Done | Manual-renewal Orders, country×elder_count pricing tiers, mid-cycle upgrade gate, webhooks, admin refunds — see "Guardian payments" section |

---

## Pending work (backend)

| Priority | Item | Notes |
|----------|------|-------|
| **P1** | **AI chat persistence** | `ai_conversations` table exists; wire `POST /api/ai/chat` to save/load threads |
| **P2** | **Care events CRUD** | Only `GET` today; add POST/PATCH/DELETE; optional auto-create from appointments |
| **P3** | ~~Pro plan / payments~~ | **Done** — see "Guardian payments" section. Follow-up not yet built: renewal-reminder push notifications before `plan_expires_at` (ADR 0001) |
| **P4** | **Daily check-in photos** | If app sends images, extend S3 `purpose` (e.g. `wellness`) + endpoint rules |
| **P5** | **Supabase file cleanup** | Remove `*.supabase.js` and dead config after audit |
| **P6** | **OpenAPI admin paths** | Optional — document `/admin/api/catalog/*` separately |
| ~~P7~~ | ~~Health vault S3 delete~~ | **Done** — `health-records.mysql.js#deleteById` already cleans up the S3 object on record DELETE. |
| **P8** | **Rate limiting / WAF** | EC2 port 5002 currently open for HTTP testing — tighten for prod |
| **Ops** | **tinybit-admin** | Separate app must call catalog + presign APIs (not in this repo) |
| **Ops** | **Populate catalog** | Doctors, mood tracks, quiz, inspirations via admin — **no SQL seed** |

---

## Commands

```bash
npm start              # production
npm run dev            # nodemon
npm ci --omit=dev      # EC2 install

# After schema change on RDS:
mysql -h $MYSQL_HOST -u $MYSQL_USER -p $MYSQL_DATABASE < mysql/schema.sql

# Manually purge users past their soft-delete grace period (normally run via cron, see below):
node scripts/purge-deleted-users.js
```

---

## Scheduled jobs

No in-process job scheduler exists in this stack — recurring work runs as a bare `node` script
via the EC2 box's OS crontab.

| Script | Purpose | Suggested schedule |
|--------|---------|---------------------|
| `scripts/purge-deleted-users.js` | Permanently purges any user whose admin soft-delete grace period (`USER_PURGE_GRACE_DAYS`, default 30) has elapsed — real S3 cleanup + cascading DB delete. See "Admin user deletion" below. | Daily |
| `scripts/send-reminders.js` | Push/in-app notification sweep for time-based reminders that have no request-triggered hook: missed medicine doses (30 min grace past scheduled time), stale health records (no upload in 30 days, re-nudges every 7 days), daily check-in not yet done (gated to ~12:00 UTC), and upcoming care_events (next 60 min). Dedup is via the `notifications` table itself (per user+type+day, or per user+type+entity via `data.medicineId`/`data.eventId`) — safe to run frequently. All time gates are UTC (no per-user timezone stored). | Every 15 min |

```cron
15 3 * * * cd /path/to/tinybit-server && /usr/bin/node scripts/purge-deleted-users.js >> /var/log/tinybit-purge.log 2>&1
*/15 * * * * cd /path/to/tinybit-server && /usr/bin/node scripts/send-reminders.js >> /var/log/tinybit-reminders.log 2>&1
```

---

## Admin user deletion (soft-delete / trash / purge)

Deleting a user from the admin panel is a reversible **trash** flow, not an instant hard delete:

| Method | Path | Behavior |
|--------|------|----------|
| `DELETE` | `/admin/api/users/:id` | Soft-deletes (`profiles.deleted_at`/`deleted_by`). Audit-logs `user.trash`. |
| `PATCH` | `/admin/api/users/:id/restore` | Clears trash state. Audit-logs `user.restore`. 404 if not trashed. |
| `DELETE` | `/admin/api/users/:id/purge` | Requires already-trashed (409 otherwise). Runs S3 cleanup (profile photo, health-vault files, journal audio, meal photos, check-in voice notes) + the real cascading delete. Audit-logs `user.purge`. |
| `GET` | `/admin/api/users?deleted=only` | Lists trashed users (default listing excludes them). |

Shared purge logic lives in `src/services/user-purge.service.js#purgeUserById` — used by both the
manual purge endpoint and `scripts/purge-deleted-users.js`, so there's exactly one place the
S3-sweep-then-cascade-delete logic lives. Every trash/restore/purge action writes to
`admin_audit_log` via `src/services/admin-audit.mysql.js`.

A soft-deleted user is blocked from logging in / refreshing their session (`isProfileDeleted` check
in `auth.controller.js` and `auth-users.mysql.js#refreshSessionFromToken`) but **an already-issued
access token keeps working until it expires** (stateless JWT, no per-request DB check) — acceptable
for a 30-day reversible trash, not an emergency lockout feature. `is_banned` has this same
non-enforcement gap and was *not* fixed as part of this work — flagged as a related follow-up.

---

## Admin audit log

`admin_audit_log` (`actor, action, target_type, target_id, details JSON, ip, created_at`) records
every significant admin action, written via `src/services/admin-audit.mysql.js#recordSafe`
(write failures warn but never block the underlying action). `req.admin.username` is the actor
(attached by `sessionAuth`); `req.ip` is real thanks to `trust proxy`.

**Actions logged:** `auth.login` / `auth.login_failed`, `user.create|update|ban|unban|trash|restore|purge`,
`notification.broadcast`, and catalog CRUD (`doctor.*`, `mood_media.*`, `quiz.*`, `inspiration.*`).
Cron purges log as actor `system:cron` (no ip). Get/list reads are not logged.

| Method | Path | Behavior |
|--------|------|----------|
| `GET` | `/admin/api/audit-log` | Paginated (`page`, `limit` ≤500), filters: `action` (exact), `search` (LIKE over actor/action/target_id/ip). Newest first. |
| `GET` | `/admin/api/audit-log/export` | CSV download (latest 5000 rows). |

Consumed by tinybit-admin's `admin-management/logs` page. When adding a new admin mutation
endpoint, add a `recordSafe` call with a dot-convention action name (`<domain>.<verb>`).

---

## Fact-check cheatsheet

| Question | Answer |
|----------|--------|
| Default DB? | MySQL via `DB_DRIVER=mysql` |
| Where is JWT validated? | `middleware/jwtAuth.middleware.js` |
| Where is SQL? | `src/services/*.mysql.js` |
| Health vault file storage? | S3 URL in `health_records.uri` |
| Can mobile upload base64 to health vault? | **No** — 400 without HTTPS `file_url` |
| Admin auth header? | `Authorization: Bearer <admin-token>` |
| Swagger URL? | `/api/docs` |
| OTP SMS? | **Removed** — 410 on `/api/auth/otp/*` |
| Mood media empty? | Normal until admin adds tracks |
| EC2 restart? | `pm2 restart tinybit-api` |
| Do guardians need to pay? | **Yes** — gated by `requireActivePlan` middleware on every `/api/guardian/*` route, no trial |
| Auto-recurring billing? | **No** — manual renewal only, no Razorpay Subscriptions/mandates (ADR 0001) |
| Where is the payment webhook? | `POST /api/payments/webhook`, HMAC-verified, no JWT |
| Is `adherence-week` used by the app yet? | **No** — built ahead of the frontend UI, see "Frontend/backend drift" note above |

---

*Last updated: reflects S3 storage, admin catalog, no-fallback media policy, guardian payments (Razorpay), and the dashboard mood/lastActiveAt/checkinWeek/location + adherence-week additions. Update this file when adding routes or changing contracts.*
