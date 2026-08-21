const { randomUUID } = require('crypto');
const { query, execute, withTransaction } = require('../config/mysql');

function badRequest(message, code) { const err = new Error(message); err.status = 400; err.code = code; return err; }
function toIso(value) { return value instanceof Date ? value.toISOString() : value; }

async function getEligibleOffer(countryCode) {
  const rows = await query(
    `SELECT * FROM payment_trial_offers
     WHERE is_active = 1 AND (country_code IS NULL OR country_code = ?)
       AND (starts_at IS NULL OR starts_at <= UTC_TIMESTAMP(3))
       AND (ends_at IS NULL OR ends_at > UTC_TIMESTAMP(3))
     ORDER BY country_code IS NULL ASC, created_at DESC LIMIT 1`,
    [countryCode || '*'],
  );
  return rows[0] || null;
}

async function getClaim(guardianId) {
  const rows = await query('SELECT * FROM payment_trial_claims WHERE guardian_id = ? LIMIT 1', [guardianId]);
  const claim = rows[0] || null;
  if (claim) { claim.started_at = toIso(claim.started_at); claim.expires_at = toIso(claim.expires_at); }
  return claim;
}

async function startTrial({ guardianId, countryCode, elderCount, tier }) {
  const offer = await getEligibleOffer(countryCode);
  if (!offer) throw badRequest('No trial is currently available for this plan.', 'TRIAL_UNAVAILABLE');
  const existing = await getClaim(guardianId);
  if (existing) throw badRequest('This account has already used its free trial.', 'TRIAL_ALREADY_USED');

  const id = randomUUID();
  const expiresAt = new Date(Date.now() + Number(offer.duration_days) * 86400000);
  const snapshot = { name: offer.name, duration_days: Number(offer.duration_days), country_code: offer.country_code, tier_id: tier?.id || null };
  try {
    await withTransaction(async (conn) => {
      const [claims] = await conn.execute('SELECT id FROM payment_trial_claims WHERE guardian_id = ? FOR UPDATE', [guardianId]);
      if (claims.length) throw badRequest('This account has already used its free trial.', 'TRIAL_ALREADY_USED');
      await conn.execute(
        `INSERT INTO payment_trial_claims (id, guardian_id, trial_offer_id, elder_count, pricing_tier_id, started_at, expires_at, status, offer_snapshot)
         VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(3), ?, 'active', ?)`,
        [id, guardianId, offer.id, elderCount, tier?.id || null, expiresAt, JSON.stringify(snapshot)],
      );
      await conn.execute(
        `UPDATE profiles SET plan_status = 'trial', plan_type = 'guardian', plan_started_at = CURRENT_TIMESTAMP(3),
         plan_expires_at = ?, plan_amount = ?, plan_currency = ?, plan_elder_count = ?, plan_interval = 'trial' WHERE id = ?`,
        [expiresAt, tier?.amount || null, tier?.currency || 'INR', elderCount, guardianId],
      );
    });
  } catch (err) {
    if (err?.code === 'ER_DUP_ENTRY') throw badRequest('This account has already used its free trial.', 'TRIAL_ALREADY_USED');
    throw err;
  }
  return { id, expires_at: expiresAt.toISOString(), duration_days: Number(offer.duration_days), offer: { id: offer.id, name: offer.name, display_message: offer.display_message } };
}

module.exports = { getEligibleOffer, getClaim, startTrial };
