# ADR 0004: Guardian-created elders get a real, claimable account (no invite-only path)

## Status
Accepted (planning session, 2026-07-11 — implementation not yet started)

## Context
The mobile onboarding rewrite (see `tinybit/CONTEXT.md` "Guardian Connect-Member flow") adds a
"Create Elder Profile" screen: when a guardian's parent isn't on TinyBit yet, the guardian fills in
the elder's name, email, mobile, gender, language, and full health-profile fields themselves —
matching every field an elder would normally provide at their own sign-up (`your-name.tsx` +
`profile-setup.tsx` + `medical.tsx`).

The existing guardian-connect mechanism (`POST /api/guardian/invite` → `guardian_elder_links` with
`status='pending'`, `elder_id` null until the elder signs up and the emails/phones match) assumes
the elder already has, or will create, their own account and explicitly accept. The new screen
needs a different model: the guardian is asserting the elder's data directly, on their behalf, with
no separate acceptance step.

`profiles.id` has `FOREIGN KEY REFERENCES app_users(id)` — a `profiles` row cannot exist without a
matching `app_users` row (`phone_e164`, `email` both `NOT NULL UNIQUE`). So "create the elder's
profile" necessarily means creating a real `app_users` row too, just with `password_hash = NULL`
and no OTP ever verified for it.

## Decision
"Create Elder Profile" creates a real, immediately-usable account:

1. New guardian-scoped endpoint (`POST /api/guardian/elders` or similar — exact path TBD at
   implementation time) creates `app_users` (phone_e164 = guardian-supplied mobile, email =
   guardian-supplied email, `password_hash = NULL`) and `profiles` (same id, `role='elder'`, all
   guardian-supplied fields) in one transaction, then a `guardian_elder_links` row with
   `status='connected'` and `elder_id` set immediately — no pending/invite step.
2. **No new auth-matching logic is needed.** `findOrCreateByPhone` already checks
   `app_users.phone_e164` first; `findOrCreateByGoogle` already checks `app_users.email` first. When
   the real elder later installs the app and signs in with the same phone (OTP) or email (Google),
   they land on the exact profile the guardian created — `isNewUser: false`, no password ever
   required because phone-OTP/Google auth never checks `password_hash`.
3. Guardian-supplied `phone`/`email` must be unique across `app_users` (existing constraint) — the
   create-endpoint must surface a clear 409-style error ("this phone/email is already registered")
   rather than the raw MySQL duplicate-key error, since this is now a guardian-facing action, not a
   signup flow with its own retry UX.

## Consequences
- No schema changes required — `app_users`/`profiles`/`guardian_elder_links` already support this
  shape.
- The elder never needs to "accept" anything for the guardian-created path — this is a deliberate
  difference from `POST /invite`'s pending/accept model, and should be communicated clearly in-app
  (the guardian is asserting data on the elder's behalf, not sending a request).
- If a guardian enters a phone/email that's already used by a *different, unrelated* account, that
  create call must fail loudly (409) rather than silently attach to the wrong profile — reusing
  `findExistingProfileId`-style matching here would be actively wrong (it exists to preserve a
  profile row across auth methods for the *same* person, not to merge two different people's data).
- This endpoint sits behind `requireActivePlan` like every other `/api/guardian/*` route (see ADR
  0001) — a guardian must have completed payment before they can create a shadow elder profile. See
  ADR 0005 for how that's satisfied during the current dev phase.
