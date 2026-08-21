const { randomUUID } = require('crypto');
const { query, execute } = require('../config/mysql');

const bool = (v) => v ? 1 : 0;
function normalizeCode(v) { return String(v || '').trim().toUpperCase(); }
function invalid(message) { const e = new Error(message); e.status = 400; return e; }

async function listTrialOffers() { return query('SELECT * FROM payment_trial_offers ORDER BY created_at DESC'); }
async function saveTrialOffer(body, id) {
  const duration = Number(body.duration_days ?? 7); if (!Number.isInteger(duration) || duration < 1) throw invalid('duration_days must be an integer >= 1');
  const fields = [body.name?.trim(), duration, body.country_code?.trim().toUpperCase() || null, bool(body.is_active ?? true), body.starts_at || null, body.ends_at || null, body.display_message?.trim() || null];
  if (!fields[0]) throw invalid('name is required');
  if (id) { await execute(`UPDATE payment_trial_offers SET name=?,duration_days=?,country_code=?,is_active=?,starts_at=?,ends_at=?,display_message=? WHERE id=?`, [...fields, id]); }
  else { id = randomUUID(); await execute(`INSERT INTO payment_trial_offers (id,name,duration_days,country_code,is_active,starts_at,ends_at,display_message) VALUES (?,?,?,?,?,?,?,?)`, [id, ...fields]); }
  return (await query('SELECT * FROM payment_trial_offers WHERE id=?', [id]))[0];
}
async function listCoupons() { return query(`SELECT c.*, COUNT(r.id) AS redemption_count FROM payment_coupons c LEFT JOIN payment_coupon_redemptions r ON r.coupon_id=c.id AND r.status='redeemed' GROUP BY c.id ORDER BY c.created_at DESC`); }
async function saveCoupon(body, id) {
  const code = normalizeCode(body.code); const type = body.discount_type; const value = Number(body.discount_value);
  if (!code || !['percent','fixed'].includes(type) || !Number.isFinite(value) || value <= 0) throw invalid('code, valid discount_type, and positive discount_value are required');
  if (type === 'percent' && value > 100) throw invalid('percentage coupons cannot exceed 100');
  const fields = [code, body.name?.trim() || code, type, value, body.maximum_discount_amount ?? null, body.currency?.trim().toUpperCase() || null, body.minimum_order_amount ?? null, body.country_code?.trim().toUpperCase() || null, bool(body.first_paid_purchase_only), body.total_redemption_limit ?? null, Number(body.per_guardian_limit ?? 1), body.starts_at || null, body.ends_at || null, bool(body.is_active ?? true), body.notes?.trim() || null];
  if (id) await execute(`UPDATE payment_coupons SET code=?,name=?,discount_type=?,discount_value=?,maximum_discount_amount=?,currency=?,minimum_order_amount=?,country_code=?,first_paid_purchase_only=?,total_redemption_limit=?,per_guardian_limit=?,starts_at=?,ends_at=?,is_active=?,notes=? WHERE id=?`, [...fields, id]);
  else { id=randomUUID(); await execute(`INSERT INTO payment_coupons (id,code,name,discount_type,discount_value,maximum_discount_amount,currency,minimum_order_amount,country_code,first_paid_purchase_only,total_redemption_limit,per_guardian_limit,starts_at,ends_at,is_active,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [id,...fields]); }
  return (await query('SELECT * FROM payment_coupons WHERE id=?', [id]))[0];
}
async function archiveCoupon(id) { await execute('UPDATE payment_coupons SET is_active=0 WHERE id=?', [id]); }
module.exports = { listTrialOffers, saveTrialOffer, listCoupons, saveCoupon, archiveCoupon };
