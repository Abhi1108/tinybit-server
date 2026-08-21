# ADR 0001: Manual renewal via Razorpay Orders, not Razorpay Subscriptions

## Status
Accepted

## Context
Guardians must pay to use the app. Payment could be a one-time lifetime unlock, an
auto-recurring mandate-based subscription (Razorpay Subscriptions API), or a manually-renewed
fixed-period unlock (Razorpay Orders API, repeated per period).

`profiles` already has unused `plan_status`, `plan_started_at`, `plan_expires_at`, `plan_amount`,
`plan_currency`, `plan_interval` columns, implying a period-based (not lifetime) model was
anticipated.

## Decision
Use **manual renewal**: each payment is a standalone Razorpay Order for one plan period (interval
TBD — see open questions). On successful payment we set `plan_status='active'`,
`plan_expires_at = now() + interval`. When `plan_expires_at` passes, access is gated again and the
guardian must create a new Order to pay again. No Razorpay Subscriptions entity, no mandate/UPI
Autopay, no auto-debit, no saved card requirement.

## Consequences
- Simpler integration: only Orders, Payments, Refunds, and Payment webhooks — no Subscription
  lifecycle webhooks (`subscription.charged`, `.halted`, `.cancelled`, `.paused`) to handle.
- No silent recurring charges — user must actively return to pay, which is more elder/guardian-app
  appropriate (avoids surprise auto-debits on a vulnerable user base) but does mean churn risk if
  the app doesn't proactively remind guardians before expiry (a reminder/notification job becomes
  a near-term follow-up, not built in this pass).
- `plan_expires_at`/`plan_interval` columns in `profiles` are validated as the right shape and will
  be reused rather than replaced.
- Revisiting this later to add auto-recurring is additive (new Subscriptions-specific tables/flow
  alongside existing Orders flow), not a breaking rework.
