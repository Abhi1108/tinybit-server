/** Normalize to E.164 (e.g. +919876543210). */
function toE164(phone, countryCode = '+91') {
  const cc = countryCode.replace(/\D/g, '');
  const digits = phone.replace(/\D/g, '');
  if (!digits) throw new Error('Invalid phone number');
  return `+${cc}${digits}`;
}

/** Stable Supabase auth email from phone (server-side only). */
function phoneToAuthEmail(phone, countryCode = '+91') {
  const cc = countryCode.replace(/\D/g, '');
  const digits = phone.replace(/\D/g, '');
  return `${cc}${digits}@phone.tinybit.app`;
}

function formatMobile(phone, countryCode = '+91') {
  return toE164(phone, countryCode);
}

module.exports = { toE164, phoneToAuthEmail, formatMobile };
