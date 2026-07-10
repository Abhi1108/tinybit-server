const { randomUUID } = require('crypto');
const { query, execute } = require('../config/mysql');
const paymentsService = require('./payments.mysql');

/**
 * Record the event for idempotency. Returns false if this event_id was already
 * seen (caller should treat as a no-op success) or true if newly recorded.
 */
async function recordEventOnce({ eventId, eventType, payload }) {
  try {
    await execute(
      `INSERT INTO payment_webhook_events (id, razorpay_event_id, event_type, payload)
       VALUES (?, ?, ?, ?)`,
      [randomUUID(), eventId, eventType, JSON.stringify(payload)],
    );
    return true;
  } catch (err) {
    if (err?.code === 'ER_DUP_ENTRY' || err?.errno === 1062) {
      return false;
    }
    throw err;
  }
}

async function markProcessed(eventId) {
  await execute(
    `UPDATE payment_webhook_events SET processed_at = CURRENT_TIMESTAMP(3) WHERE razorpay_event_id = ?`,
    [eventId],
  );
}

async function handlePaymentCaptured(entity) {
  const order = await paymentsService.getOrderByRazorpayId(entity.order_id);
  if (!order) {
    console.warn('[payment-webhooks] payment.captured for unknown order_id:', entity.order_id);
    return;
  }
  await paymentsService.recordCapturedPayment({
    order,
    razorpayPaymentId: entity.id,
    razorpaySignature: null,
    method: entity.method ?? null,
    rawResponse: entity,
  });
}

async function handlePaymentFailed(entity) {
  const order = await paymentsService.getOrderByRazorpayId(entity.order_id);
  if (!order) {
    console.warn('[payment-webhooks] payment.failed for unknown order_id:', entity.order_id);
    return;
  }
  await paymentsService.recordFailedPayment({
    order,
    razorpayPaymentId: entity.id,
    failureCode: entity.error_code ?? null,
    failureReason: entity.error_description ?? null,
    rawResponse: entity,
  });
}

async function handleRefundProcessed(entity) {
  const result = await execute(
    `UPDATE payment_refunds SET status = 'processed', raw_response = ? WHERE razorpay_refund_id = ?`,
    [JSON.stringify(entity), entity.id],
  );
  if (result.affectedRows === 0) {
    console.warn('[payment-webhooks] refund.processed for unknown razorpay_refund_id:', entity.id);
    return;
  }

  const [refundRow] = await query('SELECT payment_id FROM payment_refunds WHERE razorpay_refund_id = ? LIMIT 1', [entity.id]);
  if (refundRow?.payment_id) {
    await execute(`UPDATE payments SET status = 'refunded' WHERE id = ?`, [refundRow.payment_id]);
  }
}

/** Dispatch a verified webhook payload. `body` is the parsed JSON (already signature-verified by the caller). */
async function handleWebhookEvent({ eventId, eventType, body }) {
  const isNew = await recordEventOnce({ eventId, eventType, payload: body });
  if (!isNew) return { deduped: true };

  try {
    switch (eventType) {
      case 'payment.captured':
        await handlePaymentCaptured(body.payload.payment.entity);
        break;
      case 'payment.failed':
        await handlePaymentFailed(body.payload.payment.entity);
        break;
      case 'refund.processed':
        await handleRefundProcessed(body.payload.refund.entity);
        break;
      default:
        // Unhandled event type — acknowledged and stored, no action needed.
        break;
    }
  } finally {
    await markProcessed(eventId);
  }

  return { deduped: false };
}

module.exports = {
  handleWebhookEvent,
};
