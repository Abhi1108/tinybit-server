const express = require('express');
const router = express.Router();
const { requireJwtAuth } = require('../middleware/jwtAuth.middleware');
const {
  getPricing,
  listPricingTiers,
  createOrder,
  verifyOrder,
  getHistory,
  requireDevPaymentsEnabled,
  devComplete,
} = require('../controllers/payments.controller');
const { handleWebhook } = require('../controllers/payment-webhooks.controller');

// No JWT — authenticated via Razorpay's HMAC signature instead (see controller).
// Relies on req.rawBody captured by the global express.json() verify hook in index.js.
router.post('/webhook', handleWebhook);

// Deliberately NOT behind requireActivePlan — a guardian must be able to see pricing
// and pay while unpaid/expired (CONTEXT.md Q6).
router.get('/pricing',              requireJwtAuth, getPricing);
router.get('/pricing/tiers',        requireJwtAuth, listPricingTiers);
router.post('/orders',              requireJwtAuth, createOrder);
router.post('/orders/:id/verify',   requireJwtAuth, verifyOrder);
router.get('/history',              requireJwtAuth, getHistory);

// DEV ONLY — see docs/adr/0005-dev-mode-payment-bypass.md. requireDevPaymentsEnabled runs
// BEFORE requireJwtAuth and 404s (not 403) when ALLOW_DEV_PAYMENTS isn't 'true', so the
// route's existence isn't revealed to an unauthenticated caller either. Deliberately NOT
// behind requireActivePlan — the whole point is to get the guardian TO an active plan.
router.post('/dev-complete',        requireDevPaymentsEnabled, requireJwtAuth, devComplete);

module.exports = router;
