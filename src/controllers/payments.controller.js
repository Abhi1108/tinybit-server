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

/** GET /api/payments/pricing/tiers — all selectable tiers for the mobile Plan Selection screen. */
async function listPricingTiers(req, res) {
  try {
    const result = await paymentsService.listTiersForGuardian(req.auth.userId);
    return res.json({ success: true, ...result });
  } catch (err) {
    return handleError(res, err, 'Could not load pricing tiers.');
  }
}

/** POST /api/payments/orders — always a renewal order (first payment or post-expiry renewal). */
async function createOrder(req, res) {
  try {
    const order = await paymentsService.createRenewalOrder(req.auth.userId, req.body?.coupon_code);
    return res.status(201).json({
      success: true,
      order,
      razorpay_key_id: process.env.RAZORPAY_KEY_ID || null,
    });
  } catch (err) {
    return handleError(res, err, 'Could not create order.');
  }
}

async function startTrial(req, res) {
  try {
    const trial = await paymentsService.startTrialForGuardian(req.auth.userId);
    return res.status(201).json({ success: true, trial });
  } catch (err) { return handleError(res, err, 'Could not start trial.'); }
}

async function validateCoupon(req, res) {
  try {
    const result = await paymentsService.previewCouponForGuardian(req.auth.userId, req.body?.coupon_code);
    return res.json({ success: true, ...result });
  } catch (err) { return handleError(res, err, 'Could not validate coupon.'); }
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

/**
 * Route-level gate for /dev-complete (ADR 0005) — must run BEFORE requireJwtAuth so an
 * unauthenticated caller gets the same 404 as everyone else when ALLOW_DEV_PAYMENTS isn't
 * 'true', rather than a 401 that would reveal the route exists.
 */
function requireDevPaymentsEnabled(req, res, next) {
  if (process.env.ALLOW_DEV_PAYMENTS !== 'true') {
    return res.status(404).json({ success: false, message: 'Not found' });
  }
  return next();
}

/**
 * POST /api/payments/dev-complete — DEV ONLY (ADR 0005). Gated behind ALLOW_DEV_PAYMENTS by
 * requireDevPaymentsEnabled above; simulates a successful renewal payment so the guardian
 * onboarding flow is testable before real Razorpay checkout ships on mobile.
 * Body: { elder_count }.
 */
async function devComplete(req, res) {
  try {
    const elderCount = Number(req.body?.elder_count);
    if (!Number.isInteger(elderCount) || elderCount < 1) {
      return res.status(400).json({ success: false, message: 'elder_count must be an integer >= 1' });
    }

    const { order, plan } = await paymentsService.devCompletePayment(req.auth.userId, elderCount);
    return res.json({ success: true, order, plan });
  } catch (err) {
    return handleError(res, err, 'Could not complete dev payment.');
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
  startTrial,
  validateCoupon,
  listPricingTiers,
  createOrder,
  verifyOrder,
  getHistory,
  requireDevPaymentsEnabled,
  devComplete,
};
