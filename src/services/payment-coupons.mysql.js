const { randomUUID } = require('crypto');
const { query, withTransaction } = require('../config/mysql');

function badRequest(message, code) { const err = new Error(message); err.status = 400; err.code = code; return err; }
function normalizeCode(code) { return String(code || '').trim().toUpperCase(); }

async function validateCoupon({ code, grossAmount }) {
  const normalized = normalizeCode(code);
  if (!normalized) return null;
  const rows = await query('SELECT * FROM payment_coupons WHERE code = ? LIMIT 1', [normalized]);
  const coupon = rows[0];
  if (!coupon || !coupon.is_active) throw badRequest('This coupon is not available.', 'COUPON_INVALID');

  const percent = Number(coupon.discount_percent);
  let discount = Number(grossAmount) * percent / 100;
  discount = Math.min(Number(grossAmount), Math.round(discount * 100) / 100);
  const finalAmount = Math.round((Number(grossAmount) - discount) * 100) / 100;

  return {
    coupon,
    code: normalized,
    gross_amount: Number(grossAmount),
    discount_percent: percent,
    discount_amount: discount,
    final_amount: finalAmount,
  };
}

async function reserveCoupon({ coupon, guardianId, discountAmount }) {
  const id = randomUUID();
  await withTransaction(async (conn) => {
    const [rows] = await conn.execute('SELECT * FROM payment_coupons WHERE id = ? FOR UPDATE', [coupon.id]);
    const locked = rows[0];
    if (!locked || !locked.is_active) throw badRequest('This coupon is not available.', 'COUPON_INVALID');
    await conn.execute(
      `INSERT INTO payment_coupon_redemptions (id, coupon_id, guardian_id, discount_amount, status, reservation_expires_at)
       VALUES (?, ?, ?, ?, 'reserved', DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 30 MINUTE))`,
      [id, coupon.id, guardianId, discountAmount],
    );
  });
  return id;
}

async function attachReservation(reservationId, orderId) { if (reservationId) await query(`UPDATE payment_coupon_redemptions SET payment_order_id = ? WHERE id = ? AND status = 'reserved'`, [orderId, reservationId]); }
async function redeemReservationForOrder(orderId) { await query(`UPDATE payment_coupon_redemptions SET status = 'redeemed', redeemed_at = CURRENT_TIMESTAMP(3) WHERE payment_order_id = ? AND status = 'reserved'`, [orderId]); }
async function releaseReservation(id) { if (id) await query(`UPDATE payment_coupon_redemptions SET status = 'released' WHERE id = ? AND status = 'reserved'`, [id]); }

module.exports = { normalizeCode, validateCoupon, reserveCoupon, attachReservation, redeemReservationForOrder, releaseReservation };
