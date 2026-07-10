const { randomUUID } = require('crypto');
const { query, execute } = require('../config/mysql');
const razorpayService = require('./razorpay.service');

function toIso(val) {
  if (!val) return val;
  if (val instanceof Date) return val.toISOString();
  return val;
}

function notFound(what, id) {
  const err = new Error(`${what} not found`);
  err.status = 404;
  err.id = id;
  return err;
}

function badRequest(message, code) {
  const err = new Error(message);
  err.status = 400;
  if (code) err.code = code;
  return err;
}

function mapRefund(row) {
  if (!row) return null;
  return {
    ...row,
    amount:       Number(row.amount),
    raw_response: typeof row.raw_response === 'string' ? safeJsonParse(row.raw_response) : row.raw_response,
    created_at:   toIso(row.created_at),
    updated_at:   toIso(row.updated_at),
  };
}

function safeJsonParse(str) {
  try { return JSON.parse(str); } catch { return null; }
}

async function getPaymentById(id) {
  const rows = await query('SELECT * FROM payments WHERE id = ? LIMIT 1', [id]);
  return rows[0] ?? null;
}

async function listRefundsForPayment(paymentId) {
  const rows = await query(
    'SELECT * FROM payment_refunds WHERE payment_id = ? ORDER BY created_at DESC',
    [paymentId],
  );
  return rows.map(mapRefund);
}

/**
 * Admin-initiated refund (CONTEXT.md Q7 — no guardian self-serve refund). `amount` defaults
 * to the full payment amount if omitted. `speed` is 'normal' (default) or 'instant'.
 */
async function createRefund({ paymentId, amount, speed, reason, adminUsername }) {
  const payment = await getPaymentById(paymentId);
  if (!payment) throw notFound('Payment', paymentId);

  if (payment.status !== 'captured' && payment.status !== 'refunded') {
    throw badRequest(`Only captured payments can be refunded (this payment is '${payment.status}').`, 'NOT_CAPTURED');
  }

  const refundAmount = amount == null ? Number(payment.amount) : Number(amount);
  if (!Number.isFinite(refundAmount) || refundAmount <= 0 || refundAmount > Number(payment.amount)) {
    throw badRequest(`amount must be between 0 and ${payment.amount} (the captured payment amount).`, 'INVALID_AMOUNT');
  }

  const localId = randomUUID();

  let rzpRefund;
  try {
    rzpRefund = await razorpayService.createRefund({
      paymentId: payment.razorpay_payment_id,
      amount: refundAmount,
      currency: payment.currency,
      speed,
      notes: reason ? { reason } : undefined,
      idempotencyKey: localId,
    });
  } catch (err) {
    const wrapped = new Error(err?.error?.description || err.message || 'Razorpay refund failed');
    wrapped.status = err.statusCode || 502;
    throw wrapped;
  }

  const status = rzpRefund.status === 'processed' ? 'processed' : 'pending';

  await execute(
    `INSERT INTO payment_refunds
       (id, payment_id, razorpay_refund_id, amount, currency, speed, status, reason, initiated_by_admin, raw_response)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      localId, paymentId, rzpRefund.id, refundAmount, payment.currency,
      speed === 'instant' ? 'instant' : 'normal', status, reason ?? null,
      adminUsername ?? null, JSON.stringify(rzpRefund),
    ],
  );

  if (status === 'processed') {
    await execute(`UPDATE payments SET status = 'refunded' WHERE id = ?`, [paymentId]);
  }

  const rows = await query('SELECT * FROM payment_refunds WHERE id = ? LIMIT 1', [localId]);
  return mapRefund(rows[0]);
}

module.exports = {
  getPaymentById,
  listRefundsForPayment,
  createRefund,
};
