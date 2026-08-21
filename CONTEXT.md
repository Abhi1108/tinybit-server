# CONTEXT — Razorpay Guardian Payments

Source of truth for the payment-gating feature design. Backend-only work (`tinybit-server`).
Mobile (`tinybit`) and admin (`tinybit-admin`) integration will be scoped later, referenced here
only where it constrains the API contract.

**Mobile integration, now scoped (2026-07-11):** the onboarding rewrite in `tinybit/CONTEXT.md`
adds a guardian plan-selection screen and a payment step. Real Razorpay checkout on mobile is still
future work; this phase uses an env-gated dev-mode bypass instead — see ADR 0005. It also adds a
new "guardian creates an elder profile directly" capability that touches this feature only in that
the new endpoint sits behind the same `requireActivePlan` gate as everything else — see ADR 0004.

---

## System Goals

- A **guardian** account must complete payment before they can use the app (exact gate boundary TBD — see open questions).
- Elders are free; only guardians pay.
- Price is **configurable from the DB**, not hardcoded, along two axes:
  - **Country** (e.g. India → ₹399 INR; outside India → $699 USD, or similar).
  - **Number of elders** the guardian manages (e.g. 1 elder → 399, 2 elders → 699 — non-linear tiers, not a flat per-elder multiplier).
- All amounts/currency/tier data must be admin-editable without a code deploy.
- Every payment-relevant fact (amount charged, currency, gateway ids, status transitions, refunds) must be persisted server-side so **history and refunds never depend on calling Razorpay's API retroactively** — the DB is the reconciliation source of truth.
- Scope for this pass: **backend only**. No mobile UI, no admin UI screens — but backend must expose whatever endpoints those layers will eventually need.

## Ubiquitous Language Glossary

| Term | Meaning |
|------|---------|
| Guardian | `profiles.role = 'guardian'` — the paying party |
| Elder | `profiles.role = 'elder'` — free, linked to a guardian via `guardian_elder_links` |
| Pricing Plan / Tier | A DB-configured (country, elder_count) → (amount, currency) rule |
| Order | A Razorpay Order — created server-side before checkout, one per payment attempt |
| Payment | A Razorpay Payment — the actual charge attached to an Order |
| Subscription | *(term reserved — not yet decided whether we use Razorpay's Subscriptions entity or model recurrence ourselves; see Q1)* |
| Entitlement | The guardian's current paid access state — derived from `profiles.plan_status` / `plan_expires_at` (already present in schema) |

## Existing relevant schema (confirmed from `mysql/schema.sql`)

`profiles` already has unused scaffolding for this: `plan_type`, `plan_status`, `plan_started_at`,
`plan_expires_at`, `plan_amount`, `plan_currency` (default `'INR'`), `plan_interval`. These predate
this feature (added speculatively) and are currently unpopulated/unused — we will decide whether to
reuse or replace them.

`profiles` also already has `country` and `country_code` columns (nullable, currently informational only).

No `razorpay`, `payments`, `orders`, `refunds`, `pricing`, or `subscriptions` tables exist yet.
`package.json` has no `razorpay` SDK dependency yet.

## Core Architecture Constraints (from `tinybit-server` CLAUDE.md)

- MySQL 8 via `mysql2/promise`, layered `routes → controllers → services/*.mysql.js`.
- All money-relevant endpoints must sit behind `requireJwtAuth` except the Razorpay webhook receiver (which authenticates via HMAC signature instead, must accept raw body).
- No mock/fallback data — errors surface as explicit 4xx/5xx.
- New tables go in `mysql/schema.sql`, applied to RDS manually (no migration runner in this repo).
- Admin-facing config changes follow the existing catalog-CRUD pattern (`/admin/api/...`, Bearer admin session, audit-logged via `admin_audit.mysql.js`).

## Razorpay facts confirmed from official docs (this session)

- **Order creation** (server-side, before checkout): `amount` (in the currency's smallest unit, e.g. paise for INR), `currency`, `receipt`, optional `notes`. Returns an `order_id`.
- **Checkout → backend handoff**: client SDK returns `razorpay_payment_id`, `razorpay_order_id`, `razorpay_signature`; backend must independently verify `HMAC_SHA256(order_id + "|" + payment_id, key_secret) === razorpay_signature` before trusting the payment client-side.
- **Webhooks**: Razorpay POSTs JSON to a configured HTTPS endpoint. Signature is `HMAC_SHA256(raw_body, webhook_secret)` sent in the `X-Razorpay-Signature` header — must be verified against the **raw, unparsed** request body. `x-razorpay-event-id` header is unique per event and must be used for idempotency (same event can be delivered more than once).
- **Refunds**: only allowed on payments in `captured` state (an `authorized`-but-not-captured payment auto-refunds after 3 days). Refund creation is idempotent (safe to retry with the same idempotency key). Normal vs instant refund speed options exist.
- **International/multi-currency**: Razorpay supports 160+ currencies, but an Indian merchant account must explicitly enable "International Payments" (KYC step) before charging non-INR currencies — this is an account-level prerequisite, not just an API parameter.

---

## Open Questions Log

### Q1 — Payment cadence — RESOLVED
**Decision:** Manual renewal, not auto-recurring. See [ADR 0001](docs/adr/0001-manual-renewal-not-subscriptions.md).
Each payment = one Razorpay Order for one plan period. `plan_expires_at` gates access; guardian
creates a fresh Order to renew. No Razorpay Subscriptions entity, no mandate/auto-debit.

### Q2 — Plan interval — RESOLVED
**Decision:** Single fixed period across all tiers (interval length itself configurable in the
pricing table, e.g. 365 days), not a monthly/yearly matrix. Pricing table keyed by
`(country, elder_count)` only — no `interval` dimension needed in the tier lookup.

### Q3 — Country detection — RESOLVED
**Decision:** Backend trusts `profiles.country`, however it got populated. Mobile app will
populate it via device location permission → reverse-geocode → country (a **frontend/mobile
concern, out of scope for this backend-only pass**). Backend's job is just: pricing lookup keys off
`profiles.country`; needs to define a fallback tier for when it's `NULL`/unrecognized (see Q4).

### Q4 — Pricing table shape — RESOLVED
**Decision:** Explicit `(country_code, elder_count)` rows, `country_code=NULL` as default/fallback
country, elder counts beyond the highest configured row reuse that row's price. See
[ADR 0002](docs/adr/0002-pricing-table-shape.md).

### Q5 — Mid-cycle elder-count upgrade — RESOLVED
**Decision:** Block the elder-add/invite action if it would cross into a higher pricing tier than
currently paid for. The write endpoint returns a 402-style response carrying the required upgrade
Order; the guardian must complete that payment before the new elder link is created. `plan_amount`
stays always in sync with actual `elder_count` — no proration, no drift, no periodic true-up job
needed.

### Q6 — Gate scope & trial — RESOLVED
**Decision:** No free trial. From the moment a profile has `role='guardian'`, every
`/api/guardian/*` endpoint and any elder-link-creating action requires
`plan_status='active' AND plan_expires_at > now()` on the guardian's own profile, enforced by a
single new auth middleware layered on top of `requireJwtAuth`. Elders are never gated — they don't
see or care about their guardian's payment status. Pricing-lookup and Order-creation endpoints are
explicitly exempted from this middleware (a guardian must be able to pay while unpaid). A brand-new
guardian with 0 elders is naturally gated by the same mid-cycle-upgrade check from Q5 — adding
their very first elder requires paying the elder_count=1 tier.

### Q7 — Refund trigger — RESOLVED
**Decision:** Admin-only, via a new `/admin/api/payments/:id/refund` endpoint (Bearer admin
session, audit-logged like other admin mutations), calling Razorpay's Refund API. No guardian-facing
self-serve refund/cancel in this pass.

### Q8 — Mid-cycle downgrade — RESOLVED
**Decision:** No-op. Removing an elder never touches `plan_amount`/`plan_expires_at`/tier — the
guardian keeps what they already paid for until natural renewal, which is priced off `elder_count`
at that future time.

### Q9 — International Payments account status — RESOLVED
**Decision:** Already enabled on the Razorpay account. Non-INR Order creation is a fully live path
to build and test, not a dormant one.

### Q10 — Elder count definition — RESOLVED
**Decision:** `elder_count = COUNT(guardian_elder_links WHERE guardian_id=:g AND status IN
('pending','connected'))`. Sending an invite counts immediately, before acceptance — prevents
dodging payment via unlimited pending invites. A declined/removed link naturally lowers the count
going forward (no retroactive effect on current cycle, per Q8).

### Q11 — Rollout for existing users — RESOLVED
**Decision:** N/A — fresh app start, zero existing users to migrate/grandfather. No backfill script needed.

### Q12 — Upgrade payment math — RESOLVED
**Decision:** Upgrade Order = flat `new_tier_price − old_tier_price`, no time-weighting.
`plan_expires_at` unchanged; only `plan_amount`/`plan_elder_count` bump. See
[ADR 0003](docs/adr/0003-upgrade-payment-math.md).

All open questions resolved for this design pass. Proceeding to the implementation plan below.

---

## Implementation Plan (backend only)

### New tables (add to `mysql/schema.sql`)

```sql
-- -----------------------------------------------------------------------------
-- Payment pricing tiers — admin-editable, (country_code, elder_count) -> price.
-- country_code = '*' is the fallback used for any country without an explicit row.
-- elder_count beyond the highest configured row for a country reuses that row's price.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_pricing_tiers (
  id              CHAR(36)      NOT NULL DEFAULT (UUID()),
  country_code    VARCHAR(4)    NOT NULL DEFAULT '*',   -- ISO 3166-1 alpha-2, or '*' for default
  elder_count     INT           NOT NULL,               -- tier applies at this elder count and above (capped at next configured row)
  amount          DECIMAL(12,2) NOT NULL,                -- major unit (e.g. rupees, dollars) — converted to minor unit at Order-creation time
  currency        VARCHAR(8)    NOT NULL,                -- ISO 4217, e.g. 'INR', 'USD'
  interval_days   INT           NOT NULL DEFAULT 365,
  is_active       TINYINT(1)    NOT NULL DEFAULT 1,
  created_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_pricing_country_eldercount (country_code, elder_count),
  CONSTRAINT chk_pricing_elder_count CHECK (elder_count >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Orders — one row per Razorpay Order we create. Snapshots the tier at purchase
-- time so history/refunds never depend on pricing_tiers still having the same values.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_orders (
  id                     CHAR(36)      NOT NULL DEFAULT (UUID()),
  guardian_id            CHAR(36)      NOT NULL,
  razorpay_order_id      VARCHAR(64)   NOT NULL,
  kind                   VARCHAR(16)   NOT NULL DEFAULT 'renewal',   -- 'renewal' | 'upgrade'
  pricing_tier_id        CHAR(36)      NULL,             -- informational FK; nullable since tier rows can be edited/removed later
  elder_count_at_purchase INT          NOT NULL,
  amount                 DECIMAL(12,2) NOT NULL,          -- amount actually charged (full tier price, or upgrade delta per ADR 0003)
  currency               VARCHAR(8)    NOT NULL,
  previous_tier_amount   DECIMAL(12,2) NULL,              -- upgrade orders only (ADR 0003 audit trail)
  previous_elder_count   INT           NULL,              -- upgrade orders only
  receipt                VARCHAR(64)   NOT NULL,
  status                 VARCHAR(16)   NOT NULL DEFAULT 'created',  -- created | paid | expired | cancelled
  notes                  JSON          NULL,
  created_at             DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at             DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_payment_orders_razorpay_id (razorpay_order_id),
  KEY idx_payment_orders_guardian (guardian_id),
  CONSTRAINT chk_payment_orders_kind CHECK (kind IN ('renewal', 'upgrade')),
  CONSTRAINT chk_payment_orders_status CHECK (status IN ('created', 'paid', 'expired', 'cancelled')),
  CONSTRAINT fk_payment_orders_guardian
    FOREIGN KEY (guardian_id) REFERENCES profiles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Payments — one row per Razorpay Payment entity. An Order can have multiple
-- payment attempts (retries after a failure); only one is ever captured.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
  id                   CHAR(36)      NOT NULL DEFAULT (UUID()),
  order_id             CHAR(36)      NOT NULL,
  razorpay_payment_id  VARCHAR(64)   NOT NULL,
  razorpay_signature   VARCHAR(255)  NULL,
  method               VARCHAR(32)   NULL,               -- card | upi | netbanking | wallet | ...
  status               VARCHAR(16)   NOT NULL DEFAULT 'created', -- created|authorized|captured|failed|refunded
  amount               DECIMAL(12,2) NOT NULL,
  currency             VARCHAR(8)    NOT NULL,
  failure_code         VARCHAR(64)   NULL,
  failure_reason       TEXT          NULL,
  captured_at          DATETIME(3)   NULL,
  raw_response         JSON          NULL,                -- full Razorpay payment entity, for audit/support
  created_at           DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at           DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_payments_razorpay_id (razorpay_payment_id),
  KEY idx_payments_order (order_id),
  CONSTRAINT chk_payments_status CHECK (status IN ('created', 'authorized', 'captured', 'failed', 'refunded')),
  CONSTRAINT fk_payments_order
    FOREIGN KEY (order_id) REFERENCES payment_orders (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Refunds — admin-initiated only (Q7).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_refunds (
  id                  CHAR(36)      NOT NULL DEFAULT (UUID()),
  payment_id          CHAR(36)      NOT NULL,
  razorpay_refund_id  VARCHAR(64)   NOT NULL,
  amount              DECIMAL(12,2) NOT NULL,
  currency            VARCHAR(8)    NOT NULL,
  speed               VARCHAR(16)   NOT NULL DEFAULT 'normal',  -- normal | instant
  status               VARCHAR(16)   NOT NULL DEFAULT 'pending', -- pending | processed | failed
  reason              TEXT          NULL,
  initiated_by_admin  VARCHAR(255)  NULL,                -- admin username, mirrors admin_audit_log.actor
  raw_response        JSON          NULL,
  created_at          DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at          DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_refunds_razorpay_id (razorpay_refund_id),
  KEY idx_refunds_payment (payment_id),
  CONSTRAINT chk_refunds_status CHECK (status IN ('pending', 'processed', 'failed')),
  CONSTRAINT fk_refunds_payment
    FOREIGN KEY (payment_id) REFERENCES payments (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -----------------------------------------------------------------------------
-- Webhook events — idempotency ledger (Razorpay may redeliver the same event).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id                 CHAR(36)     NOT NULL DEFAULT (UUID()),
  razorpay_event_id  VARCHAR(64)  NOT NULL,
  event_type         VARCHAR(64)  NOT NULL,
  payload            JSON         NOT NULL,
  processed_at       DATETIME(3)  NULL,
  created_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_webhook_events_event_id (razorpay_event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### `profiles` additions

Reuse existing `plan_status`, `plan_started_at`, `plan_expires_at`, `plan_amount`, `plan_currency`
as-is. Add one new column to carry the entitled elder count (needed for the Q5 gate check without
re-deriving it from `payment_orders` on every write):

```sql
ALTER TABLE profiles ADD COLUMN plan_elder_count INT NULL AFTER plan_interval;
```

`plan_type`/`plan_interval` stay as free-form labels (e.g. `plan_type='guardian'`,
`plan_interval='annual'`) for display purposes — not used in gating logic (`interval_days` on the
pricing tier row is the authoritative number).

### New services (`src/services/`)

| File | Responsibility |
|------|-----------------|
| `payment-pricing.mysql.js` | Tier lookup: `getTierForCountryAndElderCount(country, elderCount)` implementing the Q4 fallback logic; admin CRUD for `payment_pricing_tiers`. |
| `razorpay.service.js` | Thin wrapper around the `razorpay` npm SDK — `createOrder`, `verifyPaymentSignature`, `verifyWebhookSignature`, `createRefund`. |
| `payments.mysql.js` | `payment_orders`/`payments` CRUD, the gate-check query (Q5/Q10's `elder_count` computation), applying a successful payment to `profiles.plan_*`. |
| `payment-refunds.mysql.js` | `payment_refunds` CRUD + calls `razorpay.service.js#createRefund`. |
| `payment-webhooks.mysql.js` | Idempotency check/insert into `payment_webhook_events`, dispatch by `event_type`. |

### New middleware

| File | Responsibility |
|------|-----------------|
| `requireActivePlan.middleware.js` | Layered after `requireJwtAuth` on all `/api/guardian/*` routes (Q6). Loads the caller's profile, checks `role==='guardian' && plan_status==='active' && plan_expires_at > now()`, else `402 { code: 'PLAN_EXPIRED' }`. |
| Raw-body capture for the webhook route only (`express.raw({ type: 'application/json' })` scoped to `/api/payments/webhook`, since the rest of the app uses `express.json()` globally — signature verification needs the exact raw bytes). |

### New routes (`src/routes/`, mounted in `src/index.js`)

**Mobile-facing — `/api/payments`** (JWT auth, guardian-only; explicitly *not* behind `requireActivePlan`):

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/pricing` | Returns the tier applicable to the caller's `profiles.country` + current elder_count, and the next tier up (for "what would elder N+1 cost" UI) |
| POST | `/orders` | Creates a `payment_orders` row + Razorpay Order for a renewal or an upgrade (kind inferred from context: called directly = renewal; called from the 402 response of an elder-add = upgrade) |
| POST | `/orders/:id/verify` | Body: `razorpay_payment_id`, `razorpay_order_id`, `razorpay_signature`. Verifies signature, marks order/payment paid, applies `plan_*` update on `profiles` (this is the fast client-side-confirmation path; the webhook is the authoritative backstop for cases where the app is killed before this call completes) |
| GET | `/history` | Guardian's own past orders/payments (for future "Billing History" screen) |

**Server-to-server — `/api/payments/webhook`** (no JWT — HMAC signature auth, raw body):

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/webhook` | Handles `payment.captured`, `payment.failed`, `refund.processed` (at minimum). Idempotent via `payment_webhook_events.razorpay_event_id`. |

**Elder-linking gate integration** — existing `guardian.controller.js` invite/link-creating
endpoint(s) (under `/api/guardian/elders`) gain a pre-check per Q5: compute prospective
`elder_count`, look up the tier it would require, compare against `profiles.plan_elder_count`; if
higher, return `402` with a pre-built upgrade Order (kind `'upgrade'`, amount = delta per ADR 0003)
instead of creating the link.

**Admin-facing — `/admin/api/payments`** (admin Bearer session):

| Method | Path | Purpose |
|--------|------|---------|
| GET/POST/PATCH/DELETE | `/pricing-tiers` | CRUD on `payment_pricing_tiers`, audit-logged (`pricing_tier.create/update/delete`) |
| GET | `/orders`, `/orders/:id` | Full order/payment history, any guardian |
| POST | `/payments/:id/refund` | Calls Razorpay refund API, writes `payment_refunds`, audit-logged (`payment.refund`) |

### Environment variables (add to `.env.example`)

```
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
```

### New dependency

```
npx expo install     # N/A — this is tinybit-server, plain npm
npm install razorpay
```

### Out of scope for this pass (explicitly, per the goals above)

- Mobile UI (checkout screen, billing history, upgrade-prompt modal) — `tinybit` repo, later.
- Admin UI screens for pricing-tier management — `tinybit-admin` repo, later (endpoints above are
  built so that UI has something to call).
- Renewal reminder notifications before `plan_expires_at` (flagged as a follow-up in ADR 0001).
- Any backfill/migration script (Q11 — not needed, fresh start).

### Suggested build order

1. Schema: `payment_pricing_tiers`, `payment_orders`, `payments`, `payment_refunds`,
   `payment_webhook_events` tables + `profiles.plan_elder_count` column → apply to RDS.
2. `razorpay.service.js` + env vars + `npm install razorpay`.
3. `payment-pricing.mysql.js` + admin pricing-tier CRUD (needed to seed real tier rows before
   anything else can be tested end-to-end).
4. `payments.mysql.js` + mobile `/api/payments/pricing`, `/orders`, `/orders/:id/verify`.
5. Webhook route + raw-body middleware + `payment-webhooks.mysql.js`.
6. `requireActivePlan.middleware.js` wired onto `/api/guardian/*`.
7. Q5 upgrade-gate check wired into the guardian elder-invite endpoint.
8. Admin refund endpoint + `payment-refunds.mysql.js`.
9. Update `tinybit-server/CLAUDE.md` (routes table, schema table count, pending-work row) once built.
