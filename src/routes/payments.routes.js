const express = require('express');
const router = express.Router();
const { requireJwtAuth } = require('../middleware/jwtAuth.middleware');
const {
  getPricing,
  createOrder,
  verifyOrder,
  getHistory,
} = require('../controllers/payments.controller');
const { handleWebhook } = require('../controllers/payment-webhooks.controller');

// No JWT — authenticated via Razorpay's HMAC signature instead (see controller).
// Relies on req.rawBody captured by the global express.json() verify hook in index.js.
router.post('/webhook', handleWebhook);

// Deliberately NOT behind requireActivePlan — a guardian must be able to see pricing
// and pay while unpaid/expired (CONTEXT.md Q6).
router.get('/pricing',              requireJwtAuth, getPricing);
router.post('/orders',              requireJwtAuth, createOrder);
router.post('/orders/:id/verify',   requireJwtAuth, verifyOrder);
router.get('/history',              requireJwtAuth, getHistory);

module.exports = router;
