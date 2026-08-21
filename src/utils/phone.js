/**
 * Canonicalize a phone number to E.164 (e.g. +919876543210).
 *
 * Single source of truth for phone normalization so that every entry point produces the *same*
 * string for the same real number — most importantly the guardian "create elder" path and the
 * Firebase phone-login path. When those diverged, a later phone sign-in couldn't find the app_users
 * row created earlier and tried to re-INSERT it, colliding on the PRIMARY key.
 *
 * Handles the two common ways human input differs from a bare national number:
 *   - Already international ("+91 98765 43210", or Firebase's `phone_number`): the digits already
 *     include the country code, so it is never prepended again.
 *   - National input from a country picker with a leading trunk "0" ("09876543210"): the single
 *     leading zero is dropped before the country code is applied.
 */
function canonicalizeE164(phone, countryCode = '+91') {
  const raw = String(phone ?? '').trim();
  const cc = String(countryCode ?? '').replace(/\D/g, '');
  const digits = raw.replace(/\D/g, '');
  if (!digits) throw new Error('Invalid phone number');

  // Full international form — the country code is already part of the digits; keep them as-is.
  if (raw.startsWith('+')) {
    return `+${digits}`;
  }

  // National form — strip a single leading trunk 0, then apply the picker's country code.
  const national = digits.replace(/^0/, '');
  return `+${cc}${national}`;
}

/** Legacy name kept for existing callers — identical behavior to {@link canonicalizeE164}. */
function toE164(phone, countryCode = '+91') {
  return canonicalizeE164(phone, countryCode);
}

/** Stable synthetic account email for an already-canonical E.164 (server-side app_users key). */
function authEmailFromE164(e164) {
  return `${String(e164).replace(/\D/g, '')}@phone.tinybit.app`;
}

/** Stable synthetic account email derived from raw phone input (canonicalizes first). */
function phoneToAuthEmail(phone, countryCode = '+91') {
  return authEmailFromE164(canonicalizeE164(phone, countryCode));
}

function formatMobile(phone, countryCode = '+91') {
  return canonicalizeE164(phone, countryCode);
}

module.exports = { canonicalizeE164, toE164, authEmailFromE164, phoneToAuthEmail, formatMobile };
