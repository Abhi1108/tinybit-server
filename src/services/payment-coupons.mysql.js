const { randomUUID } = require('crypto');
const { query, withTransaction } = require('../config/mysql');

function badRequest(message, code) { const err = new Error(message); err.status = 400; err.code = code; return err; }
function normalizeCode(code) { return String(code || '').trim().toUpperCase(); }

async function validateCoupon({ code, guardianId, countryCode, tier, grossAmount }) {
  const normalized = normalizeCode(code);
  if (!normalized) return null;
  const rows = await query('SELECT * FROM payment_coupons WHERE code = ? LIMIT 1', [normalized]);
  const coupon = rows[0];
  if (!coupon || !coupon.is_active) throw badRequest('This coupon is not available.', 'COUPON_INVALID');
  const now = Date.now();
  if ((coupon.starts_at && new Date(coupon.starts_at).getTime() > now) || (coupon.ends_at && new Date(coupon.ends_at).getTime() <= now)) throw badRequest('This coupon has expired.', 'COUPON_EXPIRED');
  if (coupon.country_code && coupon.country_code !== countryCode) throw badRequest('This coupon is not valid in your country.', 'COUPON_INELIGIBLE');
  if (coupon.currency && coupon.currency !== tier.currency) throw badRequest('This coupon is not valid for this currency.', 'COUPON_INELIGIBLE');
  if (coupon.minimum_order_amount != null && Number(grossAmount) < Number(coupon.minimum_order_amount)) throw badRequest('This coupon requires a higher order amount.', 'COUPON_MINIMUM_NOT_MET');
  const allowed = await query('SELECT 1 FROM payment_coupon_tiers WHERE coupon_id = ? LIMIT 1', [coupon.id]);
  if (allowed.length) {
    const match = await query('SELECT 1 FROM payment_coupon_tiers WHERE coupon_id = ? AND pricing_tier_id = ? LIMIT 1', [coupon.id, tier.id]);
    if (!match.length) throw badRequest('This coupon is not valid for the selected plan.', 'COUPON_INELIGIBLE');
  }
  if (coupon.first_paid_purchase_only) {
    const paid = await query(`SELECT 1 FROM payment_orders WHERE guardian_id = ? AND status = 'paid' LIMIT 1`, [guardianId]);
    if (paid.length) throw badRequest('This coupon is only for a first paid purchase.', 'COUPON_INELIGIBLE');
  }
  let discount = coupon.discount_type === 'percent' ? Number(grossAmount) * Number(coupon.discount_value) / 100 : Number(coupon.discount_value);
  if (coupon.maximum_discount_amount != null) discount = Math.min(discount, Number(coupon.maximum_discount_amount));
  discount = Math.min(Number(grossAmount), Math.round(discount * 100) / 100);
  return { coupon, code: normalized, gross_amount: Number(grossAmount), discount_amount: discount, final_amount: Math.round((Number(grossAmount) - discount) * 100) / 100 };
}

async function reserveCoupon({ coupon, guardianId, discountAmount }) {
  const id = randomUUID();
  await withTransaction(async (conn) => {
    const [rows] = await conn.execute('SELECT * FROM payment_coupons WHERE id = ? FOR UPDATE', [coupon.id]);
    const locked = rows[0];
    if (!locked || !locked.is_active) throw badRequest('This coupon is not available.', 'COUPON_INVALID');
    await conn.execute(`UPDATE payment_coupon_redemptions SET status = 'expired' WHERE coupon_id = ? AND status = 'reserved' AND reservation_expires_at <= UTC_TIMESTAMP(3)`, [coupon.id]);
    const [totalRows] = await conn.execute(`SELECT COUNT(*) AS count FROM payment_coupon_redemptions WHERE coupon_id = ? AND status IN ('reserved','redeemed')`, [coupon.id]);
    const [userRows] = await conn.execute(`SELECT COUNT(*) AS count FROM payment_coupon_redemptions WHERE coupon_id = ? AND guardian_id = ? AND status IN ('reserved','redeemed')`, [coupon.id, guardianId]);
    if (locked.total_redemption_limit != null && Number(totalRows[0].count) >= Number(locked.total_redemption_limit)) throw badRequest('This coupon has reached its usage limit.', 'COUPON_EXHAUSTED');
    if (Number(userRows[0].count) >= Number(locked.per_guardian_limit)) throw badRequest('You have already used this coupon.', 'COUPON_ALREADY_USED');
    await conn.execute(`INSERT INTO payment_coupon_redemptions (id, coupon_id, guardian_id, discount_amount, status, reservation_expires_at) VALUES (?, ?, ?, ?, 'reserved', DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 30 MINUTE))`, [id, coupon.id, guardianId, discountAmount]);
  });
  return id;
}

async function attachReservation(reservationId, orderId) { if (reservationId) await query(`UPDATE payment_coupon_redemptions SET payment_order_id = ? WHERE id = ? AND status = 'reserved'`, [orderId, reservationId]); }
async function redeemReservationForOrder(orderId) { await query(`UPDATE payment_coupon_redemptions SET status = 'redeemed', redeemed_at = CURRENT_TIMESTAMP(3) WHERE payment_order_id = ? AND status = 'reserved'`, [orderId]); }
async function releaseReservation(id) { if (id) await query(`UPDATE payment_coupon_redemptions SET status = 'released' WHERE id = ? AND status = 'reserved'`, [id]); }

module.exports = { normalizeCode, validateCoupon, reserveCoupon, attachReservation, redeemReservationForOrder, releaseReservation };
