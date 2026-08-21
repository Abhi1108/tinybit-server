# ADR 0005: Env-gated dev-mode payment bypass ahead of real Razorpay checkout

## Status
Accepted (planning session, 2026-07-11 — implementation not yet started)

## Context
The mobile onboarding rewrite needs a guardian plan-selection screen (choose elder-count tier,
mirroring `GET /api/payments/pricing`) and a payment step, because `requireActivePlan` (ADR 0001)
blocks *every* `/api/guardian/*` call for a guardian with no active plan — including the new
Connect-Member flow (ADR 0004) — with no free trial and no exceptions.

Real Razorpay checkout integration on mobile is explicitly out of scope for this phase ("payments —
next phase" per the mobile CONTEXT.md). Without *something* standing in for it, the entire
guardian-connect flow is untestable end-to-end during this phase — the guardian could pick a plan
but could never actually get past the 402 to add an elder.

## Decision
Add a temporary endpoint that fakes a successful payment and writes the same DB state a real
Razorpay `orders/:id/verify` success would:

- Only responds when an explicit env flag is set (e.g. `ALLOW_DEV_PAYMENTS=true`); returns 404 (not
  501/403 — don't reveal the route exists) when unset. This flag stays **unset** on the AWS EC2
  production target.
- Takes the same selected tier (country_code, elder_count) the plan-selection screen used to look up
  `GET /api/payments/pricing`, and:
  - Sets `profiles.plan_status='active'`, `plan_expires_at` = now + the tier's interval,
    `plan_amount`/`plan_currency`/`plan_elder_count` from the looked-up tier — identical fields to
    what a real verified payment sets.
  - Inserts a `payment_orders` + `payments` row so the guardian's payment history / admin dashboard
    isn't missing rows a real payment would have produced. These rows get a distinguishing marker
    (e.g. `payments.gateway = 'dev_mock'` or a reserved `razorpay_payment_id` prefix like `dev_`) so
    they're trivially identifiable and truncatable once real checkout replaces this path.
- No HMAC/signature verification, obviously — this endpoint exists specifically to skip that.

## Consequences
- The whole guardian-connect flow (plan select → "payment" → add/create elder) is testable
  end-to-end this phase without any real money moving.
- This is a standing security liability as long as it exists: anyone who can reach it with a valid
  JWT gets a free active plan. The env-gate is the only thing stopping that outside dev — it must be
  removed (not just left disabled) once real Razorpay checkout ships on mobile, not carried forward
  as permanent "test mode."
- Before removing it: truncate/delete the `dev_mock`-tagged `payment_orders`/`payments` rows and
  reset any `profiles.plan_status` that only became `active` through this path, per the mobile
  team's own note that this is throwaway dev-mode state.
- Swagger/docs for this endpoint (if added) should say **DEV ONLY — DO NOT ENABLE IN PRODUCTION** up
  front, not bury it in prose.
