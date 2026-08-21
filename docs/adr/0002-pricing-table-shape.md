# ADR 0002: Explicit (country, elder_count) pricing rows with default-country and max-tier fallback

## Status
Accepted

## Context
Price must vary by country and by elder count, non-linearly (e.g. India: 1 elder = ₹399, 2 elders
= ₹699 — not elder_count × flat rate). The table must degrade gracefully for countries or elder
counts the admin hasn't explicitly priced yet.

## Decision
A single admin-editable table, one row per `(country_code, elder_count)`:
- `country_code = NULL` is the **default/fallback row set** used for any country without an
  explicit row (covers "everyone outside India" unless/until admin adds specific countries).
- Elder counts beyond the highest explicitly configured row for that country **reuse the highest
  configured row's price** (tier caps out — no auto-extrapolation, no formula).
- Currency is a column on each row (so `country=NULL` rows can be USD while `country='IN'` rows
  are INR).

## Consequences
- Every price the app can ever charge is a literal, admin-visible row — easy to audit, easy to
  reason about for support/refund disputes, no formula bugs.
- Admin must remember to add a new row when they want a new elder-count tier to have its own price;
  until they do, it silently reuses the previous tier's price (acceptable — documented behavior,
  not a bug).
- Lookup logic: `SELECT ... WHERE country_code = :country ORDER BY elder_count DESC LIMIT 1` where
  `elder_count <= :guardian_elder_count`, falling back to `country_code IS NULL` with the same
  ordering if no country-specific rows exist.
