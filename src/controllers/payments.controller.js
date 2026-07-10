const paymentsService = require('../services/payments.mysql');

function handleError(res, err, fallback) {
  const status = err.status || 500;
  if (status === 500) console.error('[payments]', err);
  return res.status(status).json({ success: false, message: err.message || fallback, code: err.code });
}

/** GET /api/payments/pricing */
async function getPricing(req, res) {
  try {
    const summary = await paymentsService.getPricingSummaryForGuardian(req.auth.userId);
    return res.json({ success: true, ...summary });
  } catch (err) {
    return handleError(res, err, 'Could not load pricing.');
  }
}

/** POST /api/payments/orders — always a renewal order (first payment or post-expiry renewal). */
async function createOrder(req, res) {
  try {
    const order = await paymentsService.createRenewalOrder(req.auth.userId);
    return res.status(201).json({
      success: true,
      order,
      razorpay_key_id: process.env.RAZORPAY_KEY_ID || null,
    });
  } catch (err) {
    return handleError(res, err, 'Could not create order.');
  }
}

/** POST /api/payments/orders/:id/verify — body: razorpay_payment_id, razorpay_order_id, razorpay_signature */
async function verifyOrder(req, res) {
  try {
    const { razorpay_payment_id: razorpayPaymentId, razorpay_order_id: razorpayOrderId, razorpay_signature: razorpaySignature } = req.body ?? {};
    if (!razorpayPaymentId || !razorpayOrderId || !razorpaySignature) {
      return res.status(400).json({ success: false, message: 'razorpay_payment_id, razorpay_order_id, and razorpay_signature are required.' });
    }

    const { order, alreadyApplied } = await paymentsService.verifyAndApplyOrder(
      req.params.id,
      req.auth.userId,
      { razorpayPaymentId, razorpayOrderId, razorpaySignature },
    );
    return res.json({ success: true, order, already_applied: alreadyApplied });
  } catch (err) {
    return handleError(res, err, 'Could not verify payment.');
  }
}

/** GET /api/payments/history */
async function getHistory(req, res) {
  try {
    const orders = await paymentsService.getHistoryForGuardian(req.auth.userId);
    return res.json({ success: true, orders });
  } catch (err) {
    return handleError(res, err, 'Could not load payment history.');
  }
}

module.exports = {
  getPricing,
  createOrder,
  verifyOrder,
  getHistory,
};
