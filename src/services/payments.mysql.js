const { randomUUID } = require('crypto');
const { query, execute } = require('../config/mysql');
const profilesService = require('./profiles.service');
const pricingService = require('./payment-pricing.mysql');
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

function mapOrder(row) {
  if (!row) return null;
  return {
    ...row,
    amount:                  Number(row.amount),
    tier_amount:             Number(row.tier_amount),
    interval_days:           Number(row.interval_days),
    elder_count_at_purchase: Number(row.elder_count_at_purchase),
    previous_tier_amount:    row.previous_tier_amount == null ? null : Number(row.previous_tier_amount),
    previous_elder_count:    row.previous_elder_count == null ? null : Number(row.previous_elder_count),
    notes:                   typeof row.notes === 'string' ? safeJsonParse(row.notes) : row.notes,
    created_at:              toIso(row.created_at),
    updated_at:              toIso(row.updated_at),
  };
}

function mapPayment(row) {
  if (!row) return null;
  return {
    ...row,
    amount:       Number(row.amount),
    raw_response: typeof row.raw_response === 'string' ? safeJsonParse(row.raw_response) : row.raw_response,
    captured_at:  toIso(row.captured_at),
    created_at:   toIso(row.created_at),
    updated_at:   toIso(row.updated_at),
  };
}

function safeJsonParse(str) {
  try { return JSON.parse(str); } catch { return null; }
}

/** elder_count for pricing/gating purposes = pending + connected links (CONTEXT.md Q10). */
async function getElderCountForGuardian(guardianId) {
  const rows = await query(
    `SELECT COUNT(*) AS cnt FROM guardian_elder_links
     WHERE guardian_id = ? AND status IN ('pending', 'connected')`,
    [guardianId],
  );
  return Number(rows[0]?.cnt ?? 0);
}

async function requireGuardianProfile(guardianId) {
  const profile = await profilesService.getProfileById(guardianId);
  if (!profile) throw notFound('Guardian profile', guardianId);
  if (profile.role !== 'guardian') {
    const err = new Error('Only guardian accounts can access payments.');
    err.status = 403;
    throw err;
  }
  return profile;
}

/** Pricing + current entitlement summary for the mobile "what do I pay" screen. */
async function getPricingSummaryForGuardian(guardianId) {
  const profile = await requireGuardianProfile(guardianId);
  const elderCount = await getElderCountForGuardian(guardianId);
  const effectiveCount = Math.max(elderCount, 1);

  const currentTier = await pricingService.getTierForCountryAndElderCount(profile.country_code, effectiveCount);
  const nextTier = await pricingService.getNextTier(profile.country_code, effectiveCount);

  return {
    country_code:     pricingService.normalizeCountryCode(profile.country_code),
    elder_count:      elderCount,
    current_tier:     currentTier,
    next_tier:        nextTier,
    plan_status:      profile.plan_status,
    plan_expires_at:  toIso(profile.plan_expires_at),
    plan_elder_count: profile.plan_elder_count,
    plan_amount:      profile.plan_amount == null ? null : Number(profile.plan_amount),
    plan_currency:    profile.plan_currency,
  };
}

/** All selectable pricing tiers for the guardian's country — mobile Plan Selection screen. */
async function listTiersForGuardian(guardianId) {
  const profile = await requireGuardianProfile(guardianId);
  const countryCode = pricingService.normalizeCountryCode(profile.country_code);

  let tiers = await pricingService.listPricingTiers({ countryCode, active: true });
  if (!tiers.length && countryCode !== pricingService.DEFAULT_COUNTRY) {
    tiers = await pricingService.listPricingTiers({ countryCode: pricingService.DEFAULT_COUNTRY, active: true });
  }

  return { country_code: countryCode, tiers };
}

async function getOrderById(id) {
  const rows = await query('SELECT * FROM payment_orders WHERE id = ? LIMIT 1', [id]);
  return mapOrder(rows[0] ?? null);
}

async function insertOrder({
  guardianId, kind, tier, chargeAmount, elderCount, previousTierAmount, previousElderCount, notes,
}) {
  const id = randomUUID();
  const receipt = `${kind}_${id}`.slice(0, 64);

  const rzpOrder = await razorpayService.createOrder({
    amount:   chargeAmount,
    currency: tier.currency,
    receipt,
    notes:    { guardian_id: guardianId, kind, elder_count: elderCount, ...(notes || {}) },
  });

  await execute(
    `INSERT INTO payment_orders
       (id, guardian_id, razorpay_order_id, kind, pricing_tier_id, elder_count_at_purchase,
        amount, tier_amount, interval_days, currency, previous_tier_amount, previous_elder_count,
        receipt, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'created')`,
    [
      id, guardianId, rzpOrder.id, kind, tier.id, elderCount,
      chargeAmount, tier.amount, tier.interval_days, tier.currency,
      previousTierAmount, previousElderCount, receipt,
    ],
  );

  return getOrderById(id);
}

/**
 * Renewal order — full tier price for the guardian's current elder_count (floor 1, so a
 * guardian with zero linked elders can still make their first payment). Used for both a
 * brand-new guardian's first-ever payment and a normal post-expiry renewal.
 */
async function createRenewalOrder(guardianId) {
  const profile = await requireGuardianProfile(guardianId);
  const elderCount = Math.max(await getElderCountForGuardian(guardianId), 1);
  const tier = await pricingService.getTierForCountryAndElderCount(profile.country_code, elderCount);

  return insertOrder({
    guardianId,
    kind: 'renewal',
    tier,
    chargeAmount: tier.amount,
    elderCount,
    previousTierAmount: null,
    previousElderCount: null,
  });
}

/**
 * Upgrade order for crossing into a higher elder-count tier mid-cycle (ADR 0003).
 * Charges a flat delta against what was actually paid last (profiles.plan_amount) —
 * not a fresh lookup of the old tier's current price, since that may have since changed.
 * If the guardian has no existing active paid plan, this is really their first payment,
 * so it's recorded as a 'renewal' at the full new-tier price instead of a delta.
 *
 * Returns { order, appliedImmediately } — appliedImmediately is true (order is null) when
 * the computed charge is <= 0 (e.g. admin lowered prices since the last payment), since
 * Razorpay rejects non-positive order amounts; the tier bump is applied to profiles directly.
 */
async function createUpgradeOrder(guardianId, prospectiveElderCount) {
  const profile = await requireGuardianProfile(guardianId);
  const newTier = await pricingService.getTierForCountryAndElderCount(profile.country_code, prospectiveElderCount);

  const hasExistingPaidPlan = profile.plan_status === 'active'
    && profile.plan_amount != null
    && Number(profile.plan_elder_count) > 0;

  if (!hasExistingPaidPlan) {
    const order = await insertOrder({
      guardianId,
      kind: 'renewal',
      tier: newTier,
      chargeAmount: newTier.amount,
      elderCount: prospectiveElderCount,
      previousTierAmount: null,
      previousElderCount: null,
    });
    return { order, appliedImmediately: false };
  }

  const previousTierAmount = Number(profile.plan_amount);
  const previousElderCount = Number(profile.plan_elder_count);
  const delta = Math.round((newTier.amount - previousTierAmount) * 100) / 100;

  if (delta <= 0) {
    await applyPlanUpdate(guardianId, {
      planAmount: newTier.amount,
      planCurrency: newTier.currency,
      planElderCount: prospectiveElderCount,
      extendExpiry: false,
    });
    return { order: null, appliedImmediately: true, tier: newTier };
  }

  const order = await insertOrder({
    guardianId,
    kind: 'upgrade',
    tier: newTier,
    chargeAmount: delta,
    elderCount: prospectiveElderCount,
    previousTierAmount,
    previousElderCount,
  });
  return { order, appliedImmediately: false };
}

/** Apply a successful payment's effects to profiles.plan_*. Renewals extend expiry; upgrades don't (ADR 0003). */
async function applyPlanUpdate(guardianId, { planAmount, planCurrency, planElderCount, extendExpiry, intervalDays }) {
  if (extendExpiry) {
    await execute(
      `UPDATE profiles
       SET plan_status = 'active',
           plan_started_at = COALESCE(plan_started_at, CURRENT_TIMESTAMP(3)),
           plan_expires_at = DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? DAY),
           plan_amount = ?,
           plan_currency = ?,
           plan_elder_count = ?
       WHERE id = ?`,
      [intervalDays, planAmount, planCurrency, planElderCount, guardianId],
    );
  } else {
    await execute(
      `UPDATE profiles
       SET plan_amount = ?, plan_currency = ?, plan_elder_count = ?
       WHERE id = ?`,
      [planAmount, planCurrency, planElderCount, guardianId],
    );
  }
}

/**
 * Idempotently record a captured payment against an order and apply its plan effects.
 * Safe to call twice for the same razorpay_payment_id (client-verify path and the webhook
 * can both race to call this for the same payment) — the payments unique key + an
 * order.status check make the second call a no-op.
 */
async function recordCapturedPayment({ order, razorpayPaymentId, razorpaySignature, method, rawResponse }) {
  if (order.status === 'paid') {
    const rows = await query('SELECT * FROM payments WHERE razorpay_payment_id = ? LIMIT 1', [razorpayPaymentId]);
    return mapPayment(rows[0] ?? null);
  }

  const paymentId = randomUUID();
  try {
    await execute(
      `INSERT INTO payments
         (id, order_id, razorpay_payment_id, razorpay_signature, method, status, amount, currency, captured_at, raw_response)
       VALUES (?, ?, ?, ?, ?, 'captured', ?, ?, CURRENT_TIMESTAMP(3), ?)`,
      [
        paymentId, order.id, razorpayPaymentId, razorpaySignature ?? null, method ?? null,
        order.amount, order.currency, rawResponse ? JSON.stringify(rawResponse) : null,
      ],
    );
  } catch (err) {
    if (err?.code === 'ER_DUP_ENTRY' || err?.errno === 1062) {
      const rows = await query('SELECT * FROM payments WHERE razorpay_payment_id = ? LIMIT 1', [razorpayPaymentId]);
      return mapPayment(rows[0] ?? null);
    }
    throw err;
  }

  const result = await execute(
    `UPDATE payment_orders SET status = 'paid' WHERE id = ? AND status != 'paid'`,
    [order.id],
  );

  if (result.affectedRows > 0) {
    await applyPlanUpdate(order.guardian_id, {
      planAmount: order.tier_amount,
      planCurrency: order.currency,
      planElderCount: order.elder_count_at_purchase,
      extendExpiry: order.kind === 'renewal',
      intervalDays: order.interval_days,
    });
  }

  const rows = await query('SELECT * FROM payments WHERE id = ? LIMIT 1', [paymentId]);
  return mapPayment(rows[0] ?? null);
}

/** Client-side checkout-handoff verification path (fast confirmation; webhook is the backstop). */
async function verifyAndApplyOrder(orderId, guardianId, { razorpayPaymentId, razorpayOrderId, razorpaySignature }) {
  const order = await getOrderById(orderId);
  if (!order || order.guardian_id !== guardianId) throw notFound('Order', orderId);
  if (order.razorpay_order_id !== razorpayOrderId) {
    throw badRequest('razorpay_order_id does not match this order.', 'ORDER_MISMATCH');
  }

  if (order.status === 'paid') {
    return { order, alreadyApplied: true };
  }

  const valid = razorpayService.verifyPaymentSignature({
    orderId: razorpayOrderId,
    paymentId: razorpayPaymentId,
    signature: razorpaySignature,
  });
  if (!valid) {
    throw badRequest('Payment signature verification failed.', 'INVALID_SIGNATURE');
  }

  await recordCapturedPayment({
    order,
    razorpayPaymentId,
    razorpaySignature,
    method: null,
    rawResponse: null,
  });

  return { order: await getOrderById(orderId), alreadyApplied: false };
}

async function recordFailedPayment({ order, razorpayPaymentId, failureCode, failureReason, rawResponse }) {
  const existing = await query('SELECT id FROM payments WHERE razorpay_payment_id = ? LIMIT 1', [razorpayPaymentId]);
  if (existing[0]) return;

  await execute(
    `INSERT INTO payments
       (id, order_id, razorpay_payment_id, status, amount, currency, failure_code, failure_reason, raw_response)
     VALUES (?, ?, ?, 'failed', ?, ?, ?, ?, ?)`,
    [
      randomUUID(), order.id, razorpayPaymentId, order.amount, order.currency,
      failureCode ?? null, failureReason ?? null, rawResponse ? JSON.stringify(rawResponse) : null,
    ],
  );
}

async function getOrderByRazorpayId(razorpayOrderId) {
  const rows = await query('SELECT * FROM payment_orders WHERE razorpay_order_id = ? LIMIT 1', [razorpayOrderId]);
  return mapOrder(rows[0] ?? null);
}

/**
 * ADR 0005 — dev-mode payment bypass. Simulates a successful renewal payment for the given
 * elder_count tier without touching Razorpay: writes the exact same profiles.plan_* fields
 * `applyPlanUpdate` writes for a real verified payment, plus a `payment_orders`/`payments` row
 * pair so history/admin dashboards aren't missing rows a real payment would have produced.
 * Always a 'renewal' (extends plan_expires_at) — there is no dev-mode upgrade flow.
 * Gateway ids are prefixed `dev_order_`/`dev_payment_` so these rows are trivially identifiable
 * and truncatable once real Razorpay checkout ships on mobile (see ADR 0005 Consequences).
 * Caller (controller) is responsible for the ALLOW_DEV_PAYMENTS env gate.
 */
async function devCompletePayment(guardianId, elderCount) {
  const profile = await requireGuardianProfile(guardianId);
  const count = Math.max(1, Number(elderCount) || 1);
  const tier = await pricingService.getTierForCountryAndElderCount(profile.country_code, count);

  const orderId = randomUUID();
  const receipt = `dev_${orderId}`.slice(0, 64);
  const devRazorpayOrderId = `dev_order_${randomUUID()}`;
  const devRazorpayPaymentId = `dev_payment_${randomUUID()}`;

  await execute(
    `INSERT INTO payment_orders
       (id, guardian_id, razorpay_order_id, kind, pricing_tier_id, elder_count_at_purchase,
        amount, tier_amount, interval_days, currency, previous_tier_amount, previous_elder_count,
        receipt, status, notes)
     VALUES (?, ?, ?, 'renewal', ?, ?, ?, ?, ?, ?, NULL, NULL, ?, 'paid', ?)`,
    [
      orderId, guardianId, devRazorpayOrderId, tier.id, count,
      tier.amount, tier.amount, tier.interval_days, tier.currency, receipt,
      JSON.stringify({ dev_mock: true, guardian_id: guardianId, elder_count: count }),
    ],
  );

  const paymentId = randomUUID();
  await execute(
    `INSERT INTO payments
       (id, order_id, razorpay_payment_id, razorpay_signature, method, status, amount, currency, captured_at, raw_response)
     VALUES (?, ?, ?, NULL, 'dev_mock', 'captured', ?, ?, CURRENT_TIMESTAMP(3), ?)`,
    [
      paymentId, orderId, devRazorpayPaymentId, tier.amount, tier.currency,
      JSON.stringify({ dev_mock: true }),
    ],
  );

  await applyPlanUpdate(guardianId, {
    planAmount: tier.amount,
    planCurrency: tier.currency,
    planElderCount: count,
    extendExpiry: true,
    intervalDays: tier.interval_days,
  });

  const order = await getOrderById(orderId);
  const updatedProfile = await profilesService.getProfileById(guardianId);

  return {
    order,
    plan: {
      status:       updatedProfile.plan_status,
      expires_at:   toIso(updatedProfile.plan_expires_at),
      amount:       updatedProfile.plan_amount == null ? null : Number(updatedProfile.plan_amount),
      currency:     updatedProfile.plan_currency,
      elder_count:  updatedProfile.plan_elder_count,
    },
  };
}

async function getHistoryForGuardian(guardianId) {
  const orders = await query(
    `SELECT o.*,
            p.id AS payment_id, p.razorpay_payment_id, p.status AS payment_status,
            p.method, p.captured_at, p.failure_reason
     FROM payment_orders o
     LEFT JOIN payments p ON p.order_id = o.id
     WHERE o.guardian_id = ?
     ORDER BY o.created_at DESC`,
    [guardianId],
  );
  return orders.map((row) => ({
    ...mapOrder(row),
    payment: row.payment_id ? {
      id: row.payment_id,
      razorpay_payment_id: row.razorpay_payment_id,
      status: row.payment_status,
      method: row.method,
      captured_at: toIso(row.captured_at),
      failure_reason: row.failure_reason,
    } : null,
  }));
}

/** Admin — orders + payment across all guardians, optionally filtered by guardian_id. */
async function listAllOrders({ guardianId, page, limit } = {}) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (pageNum - 1) * limitNum;

  const clauses = [];
  const params = [];
  if (guardianId) {
    clauses.push('o.guardian_id = ?');
    params.push(guardianId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const orders = await query(
    `SELECT o.*,
            pr.full_name AS guardian_name,
            p.id AS payment_id, p.razorpay_payment_id, p.status AS payment_status,
            p.method, p.captured_at, p.failure_reason
     FROM payment_orders o
     LEFT JOIN profiles pr ON pr.id = o.guardian_id
     LEFT JOIN payments p ON p.order_id = o.id
     ${where}
     ORDER BY o.created_at DESC
     LIMIT ${limitNum} OFFSET ${offset}`,
    params,
  );

  return orders.map((row) => ({
    ...mapOrder(row),
    guardian_name: row.guardian_name || null,
    payment: row.payment_id ? {
      id: row.payment_id,
      razorpay_payment_id: row.razorpay_payment_id,
      status: row.payment_status,
      method: row.method,
      captured_at: toIso(row.captured_at),
      failure_reason: row.failure_reason,
    } : null,
  }));
}

module.exports = {
  getElderCountForGuardian,
  getPricingSummaryForGuardian,
  listTiersForGuardian,
  getOrderById,
  getOrderByRazorpayId,
  createRenewalOrder,
  createUpgradeOrder,
  verifyAndApplyOrder,
  recordCapturedPayment,
  recordFailedPayment,
  getHistoryForGuardian,
  listAllOrders,
  devCompletePayment,
};
