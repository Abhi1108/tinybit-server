const { randomUUID } = require('crypto');
const { query, execute } = require('../config/mysql');

const bool = (v) => v ? 1 : 0;
function normalizeCode(v) { return String(v || '').trim().toUpperCase(); }
function invalid(message) { const e = new Error(message); e.status = 400; return e; }

async function listTrialOffers() { return query('SELECT * FROM payment_trial_offers ORDER BY created_at DESC'); }
async function saveTrialOffer(body, id) {
  const duration = Number(body.duration_days ?? 7);
  if (!Number.isInteger(duration) || duration < 1) throw invalid('duration_days must be an integer >= 1');
  const name = body.name?.trim();
  if (!name) throw invalid('name is required');
  const fields = [name, duration, bool(body.is_active ?? true), body.display_message?.trim() || null];
  if (id) {
    await execute(`UPDATE payment_trial_offers SET name=?,duration_days=?,is_active=?,display_message=? WHERE id=?`, [...fields, id]);
  } else {
    id = randomUUID();
    await execute(`INSERT INTO payment_trial_offers (id,name,duration_days,is_active,display_message) VALUES (?,?,?,?,?)`, [id, ...fields]);
  }
  return (await query('SELECT * FROM payment_trial_offers WHERE id=?', [id]))[0];
}
async function listCoupons() {
  return query(
    `SELECT c.*,
            (SELECT COUNT(*) FROM payment_coupon_redemptions r WHERE r.coupon_id = c.id AND r.status = 'redeemed') AS redemption_count
     FROM payment_coupons c
     ORDER BY c.created_at DESC`
  );
}
async function saveCoupon(body, id) {
  const code = normalizeCode(body.code);
  const percent = Number(body.discount_percent ?? body.discount_value);
  if (!code || !Number.isFinite(percent) || percent <= 0 || percent > 100) {
    throw invalid('code and a valid discount percentage (1-100) are required');
  }
  const name = body.name?.trim() || code;
  const fields = [code, name, Math.round(percent), bool(body.is_active ?? true), body.notes?.trim() || null];
  if (id) {
    await execute(`UPDATE payment_coupons SET code=?,name=?,discount_percent=?,is_active=?,notes=? WHERE id=?`, [...fields, id]);
  } else {
    id = randomUUID();
    await execute(`INSERT INTO payment_coupons (id,code,name,discount_percent,is_active,notes) VALUES (?,?,?,?,?,?)`, [id, ...fields]);
  }
  return (await query('SELECT * FROM payment_coupons WHERE id=?', [id]))[0];
}
async function archiveCoupon(id) { await execute('UPDATE payment_coupons SET is_active=0 WHERE id=?', [id]); }
module.exports = { listTrialOffers, saveTrialOffer, listCoupons, saveCoupon, archiveCoupon };
