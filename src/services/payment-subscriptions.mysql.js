const { randomUUID } = require('crypto');
const { query, execute, withTransaction } = require('../config/mysql');
const razorpayService = require('./razorpay.service');
const pricingService = require('./payment-pricing.mysql');
const profilesService = require('./profiles.service');
const trialsService = require('./payment-trials.mysql');

function badRequest(message, code) {
  const err = new Error(message);
  err.status = 400;
  if (code) err.code = code;
  return err;
}

function notFound(message) {
  const err = new Error(message);
  err.status = 404;
  return err;
}

function toIso(val) {
  if (!val) return val;
  if (val instanceof Date) return val.toISOString();
  return val;
}

function mapSubscription(row) {
  if (!row) return null;
  return {
    id:                       row.id,
    guardian_id:              row.guardian_id,
    razorpay_subscription_id: row.razorpay_subscription_id,
    razorpay_plan_id:         row.razorpay_plan_id,
    pricing_tier_id:          row.pricing_tier_id,
    elder_count:              Number(row.elder_count),
    amount:                   Number(row.amount),
    currency:                 row.currency,
    interval:                 row.interval,
    status:                   row.status,
    trial_ends_at:            toIso(row.trial_ends_at),
    current_cycle_start:      toIso(row.current_cycle_start),
    current_cycle_end:        toIso(row.current_cycle_end),
    cancel_at_cycle_end:      Boolean(row.cancel_at_cycle_end),
    cancelled_at:             toIso(row.cancelled_at),
    ended_at:                 toIso(row.ended_at),
    notes:                    typeof row.notes === 'string' ? safeJsonParse(row.notes) : row.notes,
    created_at:               toIso(row.created_at),
    updated_at:               toIso(row.updated_at),
  };
}

function safeJsonParse(str) {
  try { return JSON.parse(str); } catch { return null; }
}

/**
 * Get or create a Razorpay Plan for a specific PricingTier.
 * If razorpay_plan_id is already stored in payment_pricing_tiers, returns it.
 * Otherwise, calls Razorpay plans.create and updates the database row.
 */
async function ensureRazorpayPlanForTier(tier) {
  if (tier.razorpay_plan_id) {
    return tier.razorpay_plan_id;
  }

  // Create monthly recurring plan on Razorpay
  const planName = `TinyBit Guardian Plan (${tier.elder_count} member${tier.elder_count > 1 ? 's' : ''})`;
  const rzpPlan = await razorpayService.createPlan({
    name: planName,
    amount: tier.amount,
    currency: tier.currency,
    period: 'monthly',
    interval: 1,
    description: `Auto-renewing monthly subscription for ${tier.elder_count} elder(s)`,
  });

  const planId = rzpPlan.id;
  await execute(
    'UPDATE payment_pricing_tiers SET razorpay_plan_id = ? WHERE id = ?',
    [planId, tier.id],
  );
  tier.razorpay_plan_id = planId;
  return planId;
}

/**
 * Start subscription with 1-month free trial (if eligible) or immediate billing.
 * Creates a Razorpay Subscription with start_at = Now + 30 days if trial eligible.
 * Prevents multiple free trials for the same user.
 */
async function createSubscriptionWithTrial(guardianId, elderCountInput) {
  const profile = await profilesService.getProfileById(guardianId);
  if (!profile) throw notFound('Guardian profile not found');
  if (profile.role !== 'guardian') {
    const err = new Error('Only guardian accounts can subscribe.');
    err.status = 403;
    throw err;
  }

  const elderCount = Math.max(1, Number(elderCountInput) || 1);
  const tier = await pricingService.getTierForCountryAndElderCount(profile.country_code, elderCount);
  if (!tier) throw pricingService.pricingNotConfiguredError();

  const planId = await ensureRazorpayPlanForTier(tier);

  // Check if guardian has previously claimed a trial or completed a payment
  const existingClaims = await query(
    'SELECT id FROM payment_trial_claims WHERE guardian_id = ? LIMIT 1',
    [guardianId],
  );
  const existingPaidSubs = await query(
    "SELECT id FROM payment_subscriptions WHERE guardian_id = ? AND status IN ('active', 'authenticated') LIMIT 1",
    [guardianId],
  );
  const existingPaidOrders = await query(
    "SELECT id FROM payment_orders WHERE guardian_id = ? AND status = 'paid' LIMIT 1",
    [guardianId],
  );

  // Check active trial offer configured by admin in payment_trial_offers
  const activeOffer = await trialsService.getEligibleOffer();
  const trialDaysConfigured = (activeOffer && Number(activeOffer.duration_days) > 0) ? Number(activeOffer.duration_days) : 0;

  const isTrialEligible = (!existingClaims || existingClaims.length === 0)
    && (!existingPaidSubs || existingPaidSubs.length === 0)
    && (!existingPaidOrders || existingPaidOrders.length === 0)
    && Boolean(activeOffer && trialDaysConfigured > 0);
  const TRIAL_DAYS = isTrialEligible ? trialDaysConfigured : 0;
  const startAtEpoch = isTrialEligible ? Math.floor(Date.now() / 1000) + (TRIAL_DAYS * 86400) : null;
  const trialEndsAt = startAtEpoch ? new Date(startAtEpoch * 1000) : null;

  // Razorpay Subscriptions create
  const rzpSub = await razorpayService.createSubscription({
    planId,
    totalCount: 120, // 10 years monthly max
    startAt: startAtEpoch,
    notes: {
      guardian_id: guardianId,
      elder_count: String(elderCount),
      tier_id: tier.id,
      trial_days: String(TRIAL_DAYS),
      is_trial: String(isTrialEligible),
      trial_offer_id: activeOffer?.id || '',
    },
    customerNotify: 1,
  });

  const subId = randomUUID();
  await execute(
    `INSERT INTO payment_subscriptions (
      id, guardian_id, razorpay_subscription_id, razorpay_plan_id, pricing_tier_id,
      elder_count, amount, currency, \`interval\`, status, trial_ends_at, current_cycle_start,
      current_cycle_end, cancel_at_cycle_end, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'monthly', 'created', ?, CURRENT_TIMESTAMP(3), ?, 1, ?)`,
    [
      subId,
      guardianId,
      rzpSub.id,
      planId,
      tier.id,
      elderCount,
      tier.amount,
      tier.currency,
      trialEndsAt,
      trialEndsAt || new Date(Date.now() + 30 * 86400000),
      JSON.stringify({ razorpay_raw: rzpSub }),
    ],
  );

  return {
    subscription_id: rzpSub.id, // 'sub_xxxx' passed to Razorpay checkout SDK
    internal_id: subId,
    amount: tier.amount,
    currency: tier.currency,
    elder_count: elderCount,
    trial_days: TRIAL_DAYS,
    trial_ends_at: trialEndsAt ? trialEndsAt.toISOString() : null,
    razorpay_key_id: process.env.RAZORPAY_KEY_ID || null,
  };
}

/**
 * Verify checkout response when user successfully authorizes their card.
 * Payload: { razorpay_payment_id, razorpay_subscription_id, razorpay_signature }
 */
async function verifySubscriptionAuth(guardianId, { razorpayPaymentId, razorpaySubscriptionId, razorpaySignature }) {
  let valid = razorpayService.verifySubscriptionSignature({
    subscriptionId: razorpaySubscriptionId,
    paymentId: razorpayPaymentId,
    signature: razorpaySignature,
  });

  if (!valid) {
    console.warn(
      `[payments] Signature verification failed for sub=${razorpaySubscriptionId}, payment=${razorpayPaymentId}. Checking status with Razorpay API...`,
    );
    try {
      const rzpSub = await razorpayService.getSubscription(razorpaySubscriptionId);
      if (rzpSub && (rzpSub.status === 'active' || rzpSub.status === 'authenticated')) {
        console.info(`[payments] Subscription ${razorpaySubscriptionId} verified via Razorpay API (status: ${rzpSub.status}).`);
        valid = true;
      }
    } catch (apiErr) {
      console.error('[payments] Razorpay API fallback verification error:', apiErr.message);
    }
  }

  if (!valid) {
    throw badRequest('Invalid payment signature.', 'INVALID_SIGNATURE');
  }

  const subRows = await query(
    'SELECT * FROM payment_subscriptions WHERE razorpay_subscription_id = ? AND guardian_id = ? LIMIT 1',
    [razorpaySubscriptionId, guardianId],
  );
  const sub = subRows[0];
  if (!sub) throw notFound('Subscription not found for this account.');

  const isTrial = Boolean(sub.trial_ends_at && new Date(sub.trial_ends_at).getTime() > Date.now());
  const trialEndsAt = sub.trial_ends_at ? new Date(sub.trial_ends_at) : new Date(Date.now() + 30 * 86400000);

  await withTransaction(async (conn) => {
    // 1. Update subscription status
    await conn.execute(
      `UPDATE payment_subscriptions
       SET status = 'active', updated_at = CURRENT_TIMESTAMP(3)
       WHERE id = ?`,
      [sub.id],
    );

    // 2. If it was a trial, record claim to prevent reuse
    if (isTrial) {
      await conn.execute(
        `INSERT IGNORE INTO payment_trial_claims (
           id, guardian_id, elder_count, pricing_tier_id, started_at, expires_at, status, offer_snapshot
         ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP(3), ?, 'active', ?)`,
        [
          randomUUID(),
          guardianId,
          sub.elder_count,
          sub.pricing_tier_id,
          trialEndsAt,
          JSON.stringify({ subscription_id: sub.razorpay_subscription_id, duration_days: 30 }),
        ],
      );
    }

    // 3. Update guardian profile to trial or active with auto_renew = 1
    await conn.execute(
      `UPDATE profiles
       SET plan_status = ?,
           plan_type = 'guardian',
           plan_started_at = CURRENT_TIMESTAMP(3),
           plan_expires_at = ?,
           plan_amount = ?,
           plan_currency = ?,
           plan_elder_count = ?,
           plan_interval = 'month',
           active_subscription_id = ?,
           auto_renew = 1,
           cancel_scheduled = 0
       WHERE id = ?`,
      [
        isTrial ? 'trial' : 'active',
        trialEndsAt,
        sub.amount,
        sub.currency,
        sub.elder_count,
        sub.id,
        guardianId,
      ],
    );
  });

  return {
    success: true,
    subscription_id: razorpaySubscriptionId,
    status: 'active',
    plan_status: isTrial ? 'trial' : 'active',
    trial_ends_at: trialEndsAt.toISOString(),
  };
}

/**
 * Cancel the current subscription.
 * `cancelAtCycleEnd`: true by default. If true, user remains on trial/active until
 * current_cycle_end / trial_ends_at, but will NOT be billed thereafter.
 */
async function cancelSubscriptionForGuardian(guardianId, { cancelImmediately = false } = {}) {
  const rows = await query(
    `SELECT * FROM payment_subscriptions
     WHERE guardian_id = ? AND status IN ('created', 'active', 'authenticated')
     ORDER BY (status = 'active') DESC, created_at DESC LIMIT 1`,
    [guardianId],
  );
  const sub = rows[0];
  if (!sub) {
    throw notFound('No active subscription found to cancel.');
  }

  // Call Razorpay API to cancel recurring mandate
  try {
    await razorpayService.cancelSubscription({
      subscriptionId: sub.razorpay_subscription_id,
      cancelAtCycleEnd: !cancelImmediately,
    });
  } catch (err) {
    console.error('[subscriptions] Razorpay cancel failed:', err.message);
  }

  const cancelAtCycleEnd = !cancelImmediately;
  const now = new Date();

  await withTransaction(async (conn) => {
    await conn.execute(
      `UPDATE payment_subscriptions
       SET status = ?,
           cancel_at_cycle_end = ?,
           cancelled_at = CURRENT_TIMESTAMP(3),
           ended_at = ?,
           updated_at = CURRENT_TIMESTAMP(3)
       WHERE id = ?`,
      [
        cancelAtCycleEnd ? 'active' : 'cancelled',
        cancelAtCycleEnd ? 1 : 0,
        cancelAtCycleEnd ? null : now,
        sub.id,
      ],
    );

    if (cancelAtCycleEnd) {
      // User keeps access until trial_ends_at / plan_expires_at
      await conn.execute(
        `UPDATE profiles
         SET auto_renew = 0, cancel_scheduled = 1
         WHERE id = ?`,
        [guardianId],
      );
    } else {
      // Immediate cancellation
      await conn.execute(
        `UPDATE profiles
         SET plan_status = 'cancelled',
             auto_renew = 0,
             cancel_scheduled = 0
         WHERE id = ?`,
        [guardianId],
      );
    }
  });

  return {
    success: true,
    subscription_id: sub.razorpay_subscription_id,
    cancel_at_cycle_end: cancelAtCycleEnd,
    access_until: sub.trial_ends_at || sub.current_cycle_end,
  };
}

/** Get active subscription info for guardian, prioritizing active status over abandoned created rows */
async function getCurrentSubscriptionForGuardian(guardianId) {
  const rows = await query(
    `SELECT ps.*, pt.amount AS tier_amount
     FROM payment_subscriptions ps
     LEFT JOIN payment_pricing_tiers pt ON ps.pricing_tier_id = pt.id
     WHERE ps.guardian_id = ?
     ORDER BY CASE ps.status WHEN 'active' THEN 1 WHEN 'authenticated' THEN 2 ELSE 3 END,
              ps.created_at DESC LIMIT 1`,
    [guardianId],
  );
  return mapSubscription(rows[0]);
}

/** Webhook: Update subscription when authenticated by Razorpay */
async function handleSubscriptionAuthenticated(entity) {
  const subId = entity.id; // 'sub_xxxx'
  await execute(
    `UPDATE payment_subscriptions
     SET status = 'active', updated_at = CURRENT_TIMESTAMP(3)
     WHERE razorpay_subscription_id = ?`,
    [subId],
  );
}

/** Webhook: Update subscription when monthly charge succeeds and record in payment_orders / payments ledger */
async function handleSubscriptionCharged({ subscription: subEntity, payment: payEntity } = {}) {
  const rzpSubId = subEntity?.id || subEntity?.subscription_id;
  if (!rzpSubId) return;

  const rows = await query(
    'SELECT * FROM payment_subscriptions WHERE razorpay_subscription_id = ? LIMIT 1',
    [rzpSubId],
  );
  const sub = rows[0];
  if (!sub) return;

  const nextMonth = new Date(Date.now() + 30 * 86400000);
  const chargeAmount = payEntity?.amount != null ? Number(payEntity.amount) / 100 : Number(sub.amount);
  const currency = payEntity?.currency || sub.currency || 'INR';
  const payId = payEntity?.id || `sub_charge_${randomUUID()}`;
  const orderId = randomUUID();
  const rzpOrderId = payEntity?.order_id || `sub_order_${rzpSubId}_${Date.now()}`;

  await withTransaction(async (conn) => {
    // 1. Advance subscription cycle
    await conn.execute(
      `UPDATE payment_subscriptions
       SET status = 'active',
           current_cycle_start = CURRENT_TIMESTAMP(3),
           current_cycle_end = ?,
           updated_at = CURRENT_TIMESTAMP(3)
       WHERE id = ?`,
      [nextMonth, sub.id],
    );

    // 2. Advance profile
    await conn.execute(
      `UPDATE profiles
       SET plan_status = 'active',
           plan_expires_at = ?,
           auto_renew = 1
       WHERE id = ?`,
      [nextMonth, sub.guardian_id],
    );

    // 3. Write into payment_orders ledger so it appears in history & admin dashboards
    await conn.execute(
      `INSERT INTO payment_orders (
         id, guardian_id, razorpay_order_id, kind, pricing_tier_id,
         elder_count_at_purchase, gross_amount, discount_amount,
         amount, tier_amount, interval_days, currency, receipt, status, notes
       ) VALUES (?, ?, ?, 'renewal', ?, ?, ?, 0, ?, ?, 30, ?, ?, 'paid', ?)`,
      [
        orderId,
        sub.guardian_id,
        rzpOrderId,
        sub.pricing_tier_id,
        sub.elder_count,
        chargeAmount,
        chargeAmount,
        chargeAmount,
        currency,
        `sub_${sub.id.slice(0, 8)}`,
        JSON.stringify({ subscription_id: rzpSubId, payment_id: payId }),
      ],
    );

    // 4. Write into payments ledger
    await conn.execute(
      `INSERT INTO payments (
         id, order_id, razorpay_payment_id, status, amount, currency,
         captured_at, raw_response
       ) VALUES (?, ?, ?, 'captured', ?, ?, CURRENT_TIMESTAMP(3), ?)`,
      [
        randomUUID(),
        orderId,
        payId,
        chargeAmount,
        currency,
        JSON.stringify(payEntity || {}),
      ],
    );
  });
}

/** Webhook: Handle subscription cancelled */
async function handleSubscriptionCancelled(entity) {
  const subId = entity.id;
  await execute(
    `UPDATE payment_subscriptions
     SET status = 'cancelled',
         cancelled_at = CURRENT_TIMESTAMP(3),
         ended_at = CURRENT_TIMESTAMP(3),
         updated_at = CURRENT_TIMESTAMP(3)
     WHERE razorpay_subscription_id = ?`,
    [subId],
  );
}

module.exports = {
  createSubscriptionWithTrial,
  verifySubscriptionAuth,
  cancelSubscriptionForGuardian,
  getCurrentSubscriptionForGuardian,
  handleSubscriptionAuthenticated,
  handleSubscriptionCharged,
  handleSubscriptionCancelled,
};
