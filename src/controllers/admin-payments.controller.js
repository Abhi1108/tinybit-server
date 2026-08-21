const pricingService = require('../services/payment-pricing.mysql');
const paymentsService = require('../services/payments.mysql');
const refundsService = require('../services/payment-refunds.mysql');
const auditService = require('../services/admin-audit.mysql');
const promotionsService = require('../services/payment-promotions-admin.mysql');

function handleError(res, err) {
  return res.status(err.status || 500).json({ success: false, error: err.message });
}

function audit(req, action, targetType, targetId, details) {
  return auditService.recordSafe({
    actor: req.admin?.username ?? 'unknown',
    action,
    targetType,
    targetId,
    details,
    ip: req.ip,
  });
}

// ── Pricing tiers ───────────────────────────────────────────────────────────

const getPricingTiers = async (req, res) => {
  try {
    const tiers = await pricingService.listPricingTiers({
      countryCode: req.query.country_code,
      active: req.query.active,
    });
    return res.json({ success: true, tiers });
  } catch (err) {
    return handleError(res, err);
  }
};

const getPricingTier = async (req, res) => {
  try {
    const tier = await pricingService.getPricingTierById(req.params.id);
    if (!tier) return res.status(404).json({ success: false, error: 'Pricing tier not found' });
    return res.json({ success: true, tier });
  } catch (err) {
    return handleError(res, err);
  }
};

const createPricingTier = async (req, res) => {
  try {
    const tier = await pricingService.createPricingTier(req.body);
    await audit(req, 'pricing_tier.create', 'payment_pricing_tier', tier.id, {
      country_code: tier.country_code,
      elder_count: tier.elder_count,
      amount: tier.amount,
      currency: tier.currency,
    });
    return res.status(201).json({ success: true, tier });
  } catch (err) {
    return handleError(res, err);
  }
};

const updatePricingTier = async (req, res) => {
  try {
    const tier = await pricingService.updatePricingTier(req.params.id, req.body ?? {});
    await audit(req, 'pricing_tier.update', 'payment_pricing_tier', req.params.id, { fields: Object.keys(req.body ?? {}) });
    return res.json({ success: true, tier });
  } catch (err) {
    return handleError(res, err);
  }
};

const deletePricingTier = async (req, res) => {
  try {
    await pricingService.deletePricingTier(req.params.id);
    await audit(req, 'pricing_tier.delete', 'payment_pricing_tier', req.params.id);
    return res.json({ success: true });
  } catch (err) {
    return handleError(res, err);
  }
};

const getTrialOffers = async (req, res) => { try { return res.json({ success: true, offers: await promotionsService.listTrialOffers() }); } catch (err) { return handleError(res, err); } };
const createTrialOffer = async (req, res) => { try { const offer = await promotionsService.saveTrialOffer(req.body ?? {}); await audit(req, 'trial_offer.create', 'payment_trial_offer', offer.id); return res.status(201).json({ success: true, offer }); } catch (err) { return handleError(res, err); } };
const updateTrialOffer = async (req, res) => { try { const offer = await promotionsService.saveTrialOffer(req.body ?? {}, req.params.id); await audit(req, 'trial_offer.update', 'payment_trial_offer', offer.id); return res.json({ success: true, offer }); } catch (err) { return handleError(res, err); } };
const getCoupons = async (req, res) => { try { return res.json({ success: true, coupons: await promotionsService.listCoupons() }); } catch (err) { return handleError(res, err); } };
const createCoupon = async (req, res) => { try { const coupon = await promotionsService.saveCoupon(req.body ?? {}); await audit(req, 'coupon.create', 'payment_coupon', coupon.id); return res.status(201).json({ success: true, coupon }); } catch (err) { return handleError(res, err); } };
const updateCoupon = async (req, res) => { try { const coupon = await promotionsService.saveCoupon(req.body ?? {}, req.params.id); await audit(req, 'coupon.update', 'payment_coupon', coupon.id); return res.json({ success: true, coupon }); } catch (err) { return handleError(res, err); } };
const archiveCoupon = async (req, res) => { try { await promotionsService.archiveCoupon(req.params.id); await audit(req, 'coupon.archive', 'payment_coupon', req.params.id); return res.json({ success: true }); } catch (err) { return handleError(res, err); } };

// ── Orders / payments (history + refund) ───────────────────────────────────

const getOrders = async (req, res) => {
  try {
    const orders = await paymentsService.listAllOrders({
      guardianId: req.query.guardian_id,
      page: req.query.page,
      limit: req.query.limit,
    });
    return res.json({ success: true, orders });
  } catch (err) {
    return handleError(res, err);
  }
};

const getOrder = async (req, res) => {
  try {
    const order = await paymentsService.getOrderById(req.params.id);
    if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
    return res.json({ success: true, order });
  } catch (err) {
    return handleError(res, err);
  }
};

// POST /admin/api/payments/:id/refund — body: { amount?, speed?, reason? }. :id is a payments.id.
const refundPayment = async (req, res) => {
  try {
    const { amount, speed, reason } = req.body ?? {};
    const refund = await refundsService.createRefund({
      paymentId: req.params.id,
      amount,
      speed,
      reason,
      adminUsername: req.admin?.username,
    });
    await audit(req, 'payment.refund', 'payment_refund', refund.id, {
      payment_id: req.params.id,
      amount: refund.amount,
      currency: refund.currency,
      speed: refund.speed,
    });
    return res.status(201).json({ success: true, refund });
  } catch (err) {
    return handleError(res, err);
  }
};

module.exports = {
  getPricingTiers,
  getPricingTier,
  createPricingTier,
  updatePricingTier,
  deletePricingTier,
  getTrialOffers, createTrialOffer, updateTrialOffer,
  getCoupons, createCoupon, updateCoupon, archiveCoupon,
  getOrders,
  getOrder,
  refundPayment,
};
