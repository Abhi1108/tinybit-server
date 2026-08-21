# ADR 0003: Mid-cycle tier upgrade charges a flat price delta, expiry unchanged

## Status
Accepted

## Context
A guardian paid for tier N elders; before renewal they add an elder that crosses into tier N+1.
Per ADR 0001/0002 and Q5/Q8, there's no proration elsewhere in this system (renewal is always a
fresh full-price period; downgrades are a no-op). But an upgrade mid-cycle still needs an amount to
charge and a decision on whether `plan_expires_at` moves.

## Decision
Upgrade Order amount = `new_tier_price − old_tier_price` (flat difference between the two pricing
rows the guardian is moving between), **not** time-weighted by days remaining.
`plan_expires_at` is **not** extended — the guardian keeps their original renewal date, just with
the higher elder-count entitlement (`plan_elder_count`, `plan_amount`) until then.

## Consequences
- No days-remaining/interval-length math anywhere in the payment path — every Order's amount is a
  direct lookup or a direct subtraction of two looked-up values. Consistent with the rest of the
  system's "no proration math" stance.
- A guardian who upgrades right before renewal pays the same delta as one who upgrades right after
  a fresh payment — flat delta is a discount off full price, not true day-accurate proration. This
  is an accepted, explicit trade-off (deliberately chosen over time-weighting for simplicity).
- `payment_orders` must record `previous_tier_amount`/`previous_elder_count` alongside the new
  values for any upgrade order, so refund/support history can reconstruct exactly what the delta
  represented without re-deriving it from possibly-since-edited pricing rows (pricing rows are
  mutable by admin; the order must snapshot the numbers actually charged).
- At renewal time, the *next* Order always reverts to a normal full-tier-price Order priced off
  elder_count at that moment — upgrade deltas never compound or carry forward.
