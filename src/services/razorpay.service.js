const crypto = require('crypto');
const Razorpay = require('razorpay');

const KEY_ID = process.env.RAZORPAY_KEY_ID;
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;

// Razorpay expects amounts in the currency's smallest unit. Most currencies are
// 2-decimal (paise, cents); a few are 0- or 3-decimal. Unlisted currencies default to 2.
const ZERO_DECIMAL_CURRENCIES = new Set(['JPY']);
const THREE_DECIMAL_CURRENCIES = new Set(['KWD', 'BHD', 'OMR']);

let client = null;

function razorpayNotConfiguredError() {
  const err = new Error('Razorpay is not configured. Set RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET in server environment.');
  err.code = 'RAZORPAY_NOT_CONFIGURED';
  return err;
}

function isRazorpayConfigured() {
  return Boolean(KEY_ID && KEY_SECRET);
}

function assertRazorpayConfigured() {
  if (!isRazorpayConfigured()) {
    throw razorpayNotConfiguredError();
  }
}

function getClient() {
  assertRazorpayConfigured();
  if (!client) {
    client = new Razorpay({ key_id: KEY_ID, key_secret: KEY_SECRET });
  }
  return client;
}

function decimalsForCurrency(currency) {
  const code = String(currency || '').toUpperCase();
  if (ZERO_DECIMAL_CURRENCIES.has(code)) return 0;
  if (THREE_DECIMAL_CURRENCIES.has(code)) return 3;
  return 2;
}

/** Convert a major-unit decimal amount (e.g. 399.00 rupees) to Razorpay's smallest-unit integer (e.g. 39900 paise). */
function toMinorUnits(amount, currency) {
  const decimals = decimalsForCurrency(currency);
  return Math.round(Number(amount) * 10 ** decimals);
}

/** Convert a Razorpay smallest-unit integer back to a major-unit decimal. */
function fromMinorUnits(amount, currency) {
  const decimals = decimalsForCurrency(currency);
  return Number(amount) / 10 ** decimals;
}

/**
 * Create a Razorpay Order. `amount` is a major-unit decimal (e.g. 399.00); converted
 * to minor units internally. `receipt` should be unique per order (we use payment_orders.id).
 */
async function createOrder({ amount, currency, receipt, notes }) {
  const rzp = getClient();
  return rzp.orders.create({
    amount: toMinorUnits(amount, currency),
    currency: String(currency || '').toUpperCase(),
    receipt,
    notes: notes || undefined,
  });
}

/**
 * Verify the checkout-handoff signature: HMAC_SHA256(order_id + "|" + payment_id, key_secret).
 * Must be checked before trusting a client-reported successful payment.
 */
function verifyPaymentSignature({ orderId, paymentId, signature }) {
  assertRazorpayConfigured();
  if (!orderId || !paymentId || !signature) return false;

  const expected = crypto
    .createHmac('sha256', KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  return timingSafeEqualHex(expected, signature);
}

/**
 * Verify a webhook's X-Razorpay-Signature header: HMAC_SHA256(raw_body, webhook_secret).
 * `rawBody` must be the exact raw request bytes/string — not a re-serialized parsed object.
 */
function verifyWebhookSignature({ rawBody, signature }) {
  if (!WEBHOOK_SECRET) {
    throw new Error('RAZORPAY_WEBHOOK_SECRET is not configured.');
  }
  if (!rawBody || !signature) return false;

  const expected = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  return timingSafeEqualHex(expected, signature);
}

function timingSafeEqualHex(expectedHex, actualHex) {
  const expected = Buffer.from(String(expectedHex), 'hex');
  const actual = Buffer.from(String(actualHex), 'hex');
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

/**
 * Create a refund for a captured payment. `amount` (major-unit decimal) is required —
 * always pass it explicitly rather than relying on Razorpay's full-refund default, so
 * `payment_refunds.amount` in our DB is never ambiguous about what was actually refunded.
 * `idempotencyKey` should be stable per logical refund attempt (we pass our payment_refunds.id).
 */
async function createRefund({ paymentId, amount, currency, speed, notes, idempotencyKey }) {
  const rzp = getClient();
  return rzp.payments.refund(paymentId, {
    amount: toMinorUnits(amount, currency),
    speed: speed === 'instant' ? 'optimum' : 'normal',
    notes: notes || undefined,
    ...(idempotencyKey ? { receipt: idempotencyKey } : {}),
  });
}

/**
 * Create a Razorpay Plan for recurring billing.
 * `period`: 'daily' | 'weekly' | 'monthly' | 'yearly'
 * `interval`: number of periods (e.g. 1 month)
 */
async function createPlan({ name, amount, currency, period = 'monthly', interval = 1, description }) {
  const rzp = getClient();
  return rzp.plans.create({
    period,
    interval,
    item: {
      name,
      amount: toMinorUnits(amount, currency),
      currency: String(currency || '').toUpperCase(),
      description: description || undefined,
    },
  });
}

/**
 * Create a Razorpay Subscription.
 * `planId`: Razorpay plan id (`plan_xxx`)
 * `totalCount`: Number of billing cycles (e.g. 120 for 10 years recurring)
 * `startAt`: Epoch timestamp in seconds when the 1st billing cycle starts. If in future,
 *            acts as the trial period!
 */
async function createSubscription({ planId, totalCount = 120, startAt, notes, customerNotify = 1 }) {
  const rzp = getClient();
  const payload = {
    plan_id: planId,
    total_count: totalCount,
    customer_notify: customerNotify,
    notes: notes || undefined,
  };
  if (startAt) {
    payload.start_at = startAt;
  }
  return rzp.subscriptions.create(payload);
}

/**
 * Verify checkout signature for a subscription authentication:
 * Razorpay official spec: HMAC_SHA256(payment_id + "|" + subscription_id, key_secret)
 */
function verifySubscriptionSignature({ subscriptionId, paymentId, signature }) {
  assertRazorpayConfigured();
  if (!subscriptionId || !paymentId || !signature) return false;

  // Razorpay official spec: payment_id + '|' + subscription_id
  const expectedPrimary = crypto
    .createHmac('sha256', KEY_SECRET)
    .update(`${paymentId}|${subscriptionId}`)
    .digest('hex');

  if (timingSafeEqualHex(expectedPrimary, signature)) {
    return true;
  }

  // Fallback in case parameter order was inverted
  const expectedAlt = crypto
    .createHmac('sha256', KEY_SECRET)
    .update(`${subscriptionId}|${paymentId}`)
    .digest('hex');

  return timingSafeEqualHex(expectedAlt, signature);
}

/**
 * Cancel a recurring subscription.
 * `cancelAtCycleEnd`: true means user retains access till current cycle / trial ends, no renewal.
 */
async function cancelSubscription({ subscriptionId, cancelAtCycleEnd = true }) {
  const rzp = getClient();
  return rzp.subscriptions.cancel(subscriptionId, Boolean(cancelAtCycleEnd));
}

/** Fetch subscription details from Razorpay */
async function getSubscription(subscriptionId) {
  const rzp = getClient();
  return rzp.subscriptions.fetch(subscriptionId);
}

/** Fetch all payment attempts for a Razorpay order */
async function fetchOrderPayments(orderId) {
  const rzp = getClient();
  return rzp.orders.fetchPayments(orderId);
}

module.exports = {
  isRazorpayConfigured,
  razorpayNotConfiguredError,
  getClient,
  toMinorUnits,
  fromMinorUnits,
  createOrder,
  verifyPaymentSignature,
  verifyWebhookSignature,
  createRefund,
  createPlan,
  createSubscription,
  verifySubscriptionSignature,
  cancelSubscription,
  getSubscription,
  fetchOrderPayments,
};

