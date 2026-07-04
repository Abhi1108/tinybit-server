# TinyBit Server — Project Guide

Single source of truth for AI sessions and developers working on **tinybit-server** (DD Medax / TinyBit elderly health companion backend).

**Related repos**

| Repo | Role |
|------|------|
| `tinybit` (Expo SDK 56) | Mobile app — consumes `/api/*` |
| `tinybit-admin` (separate) | Admin UI — consumes `/admin/api/*` |
| **This repo** | Node/Express API + embedded admin dashboard |

**Production target (current):** AWS EC2 + RDS MySQL + PM2 (`tinybit-api`, port **5002**).  
**Legacy target:** Vercel serverless (`vercel.json` still present; `VERCEL` env skips `listen()`).

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

### Vercel (legacy)

- Entry: `src/index.js` exported as serverless handler.
- Set all env vars in Vercel project settings.
- `SERVER_URL` must be the public alias (used in health-card QR URLs).
- Long-running uploads / large JSON bodies may be less suitable than EC2.

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

### Tables (27)

| Group | Tables |
|-------|--------|
| Auth | `app_users`, `refresh_tokens`, `otp_verifications` (legacy) |
| User | `profiles`, `user_settings`, `elder_locations` |
| Guardian | `guardian_elder_links` |
| Safety | `emergency_contacts`, `sos_alerts` |
| Health | `medicines`, `medicine_logs`, `daily_checkins`, `mood_entries`, `health_readings`, `health_records` |
| Calendar | `appointments`, `care_events` |
| Social | `journal`, `family_messages` |
| AI | `ai_conversations` |
| Content | `mood_media_tracks`, `mood_media_favorites`, `mind_games_scores`, `daily_quiz_questions`, `daily_inspirations`, `doctors` |
| System | `notifications` |

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

Base URL examples: `https://<host>:5002/api` or Vercel alias.

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

Invites, connections, elder list, alerts, location, reports.

### SOS — `/api/sos`

Trigger alert + emergency contacts CRUD.

### Location — `/api/location`

Elder location GET/PUT.

### Health card — `/api/health-card`

QR generation (uses `SERVER_URL`) + public read by token.

### Family messages — `/api/family/messages`

Latest, count, create — accepts `content` or `message` alias; default date today.

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

---

## Pending work (backend)

| Priority | Item | Notes |
|----------|------|-------|
| **P1** | **AI chat persistence** | `ai_conversations` table exists; wire `POST /api/ai/chat` to save/load threads |
| **P2** | **Care events CRUD** | Only `GET` today; add POST/PATCH/DELETE; optional auto-create from appointments |
| **P3** | **Pro plan / payments** | Not started — schema TBD |
| **P4** | **Daily check-in photos** | If app sends images, extend S3 `purpose` (e.g. `wellness`) + endpoint rules |
| **P5** | **Supabase file cleanup** | Remove `*.supabase.js` and dead config after audit |
| **P6** | **OpenAPI admin paths** | Optional — document `/admin/api/catalog/*` separately |
| **P7** | **Health vault S3 delete** | Optionally delete S3 object on record DELETE |
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
```

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

---

*Last updated: reflects S3 storage, admin catalog, and no-fallback media policy. Update this file when adding routes or changing contracts.*
