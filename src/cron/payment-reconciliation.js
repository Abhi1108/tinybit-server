const { query, execute } = require('../config/mysql');
const razorpayService = require('../services/razorpay.service');
const subscriptionsService = require('../services/payment-subscriptions.mysql');
const paymentsService = require('../services/payments.mysql');

/**
 * Auto-reconciliation cron task:
 * Runs periodically to auto-heal pending subscriptions and orders that were authorized/paid
 * on Razorpay/bank but were not verified because the user force-closed the app or the
 * Razorpay modal hung on "Processing your payment".
 */
async function reconcilePendingPayments() {
  if (!razorpayService.isRazorpayConfigured()) {
    return;
  }

  await reconcileSubscriptions();
  await reconcileOrders();
}

async function reconcileSubscriptions() {
  try {
    // Check subscriptions between 1 minute and 24 hours old in 'created' or 'authenticated' state
    const rows = await query(
      `SELECT * FROM payment_subscriptions
       WHERE status IN ('created', 'authenticated')
         AND created_at <= NOW() - INTERVAL 1 MINUTE
         AND created_at >= NOW() - INTERVAL 24 HOUR
       ORDER BY created_at ASC LIMIT 20`,
    );

    for (const sub of rows) {
      try {
        const rzpSub = await razorpayService.getSubscription(sub.razorpay_subscription_id);
        if (rzpSub && (rzpSub.status === 'active' || rzpSub.status === 'authenticated')) {
          console.info(
            `[cron:payments] Auto-healing subscription ${sub.razorpay_subscription_id} for guardian ${sub.guardian_id} (Razorpay status: ${rzpSub.status}).`,
          );
          await subscriptionsService.activateSubscriptionAndProfile(sub);
        } else if (rzpSub && (rzpSub.status === 'cancelled' || rzpSub.status === 'expired')) {
          await execute(
            `UPDATE payment_subscriptions SET status = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
            [rzpSub.status, sub.id],
          );
        }
      } catch (subErr) {
        console.warn(`[cron:payments] Could not check sub ${sub.razorpay_subscription_id}:`, subErr.message);
      }
    }
  } catch (err) {
    console.error('[cron:payments] Error during subscription reconciliation:', err.message);
  }
}

async function reconcileOrders() {
  try {
    const orders = await query(
      `SELECT * FROM payment_orders
       WHERE status = 'created'
         AND created_at <= NOW() - INTERVAL 1 MINUTE
         AND created_at >= NOW() - INTERVAL 24 HOUR
       ORDER BY created_at ASC LIMIT 20`,
    );

    for (const order of orders) {
      try {
        const payList = await razorpayService.fetchOrderPayments(order.razorpay_order_id);
        const payments = payList?.items || [];
        const captured = payments.find((p) => p.status === 'captured');

        if (captured) {
          console.info(
            `[cron:payments] Auto-healing order ${order.razorpay_order_id} for guardian ${order.guardian_id} (payment: ${captured.id}).`,
          );
          await paymentsService.recordCapturedPayment({
            order,
            razorpayPaymentId: captured.id,
            razorpaySignature: null,
            method: captured.method || null,
            rawResponse: captured,
          });
        }
      } catch (orderErr) {
        console.warn(`[cron:payments] Could not check order ${order.razorpay_order_id}:`, orderErr.message);
      }
    }
  } catch (err) {
    console.error('[cron:payments] Error during order reconciliation:', err.message);
  }
}

module.exports = { reconcilePendingPayments };
