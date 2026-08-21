/**
 * @openapi
 * tags:
 *   - name: Payments
 *     description: Guardian payments (Razorpay) — manual renewal, no auto-recurring
 *
 * /api/payments/pricing:
 *   get:
 *     tags: [Payments]
 *     summary: Get current pricing tier + entitlement for the caller (guardian only)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Pricing summary
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 country_code:
 *                   type: string
 *                 elder_count:
 *                   type: integer
 *                 current_tier:
 *                   type: object
 *                 next_tier:
 *                   type: object
 *                   nullable: true
 *                 plan_status:
 *                   type: string
 *                 plan_expires_at:
 *                   type: string
 *                   nullable: true
 *                 plan_elder_count:
 *                   type: integer
 *                   nullable: true
 *                 plan_amount:
 *                   type: number
 *                   nullable: true
 *                 plan_currency:
 *                   type: string
 *       403:
 *         description: Caller is not a guardian
 *       503:
 *         description: No pricing configured for this country (admin has not added a payment_pricing_tiers row)
 *
 * /api/payments/orders:
 *   post:
 *     tags: [Payments]
 *     summary: Create a renewal Order (first payment or post-expiry renewal) at the full tier price
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Order created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 order:
 *                   type: object
 *                 razorpay_key_id:
 *                   type: string
 *                   nullable: true
 *
 * /api/payments/orders/{id}/verify:
 *   post:
 *     tags: [Payments]
 *     summary: Verify a completed checkout and apply its plan effects (fast client-confirmation path; the webhook is the authoritative backstop)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: payment_orders.id (not the Razorpay order id)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [razorpay_payment_id, razorpay_order_id, razorpay_signature]
 *             properties:
 *               razorpay_payment_id:
 *                 type: string
 *               razorpay_order_id:
 *                 type: string
 *               razorpay_signature:
 *                 type: string
 *     responses:
 *       200:
 *         description: Verified and applied
 *       400:
 *         description: Missing fields, order/razorpay id mismatch, or signature verification failed
 *       404:
 *         description: Order not found
 *
 * /api/payments/history:
 *   get:
 *     tags: [Payments]
 *     summary: List the caller's own past orders + payment status
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Order history
 *
 * /api/payments/webhook:
 *   post:
 *     tags: [Payments]
 *     summary: Razorpay webhook receiver (server-to-server; not for mobile clients)
 *     description: >
 *       Authenticated via the `X-Razorpay-Signature` header (HMAC-SHA256 over the raw request
 *       body with RAZORPAY_WEBHOOK_SECRET) instead of a JWT. Handles `payment.captured`,
 *       `payment.failed`, and `refund.processed`; idempotent per `X-Razorpay-Event-Id`.
 *     responses:
 *       200:
 *         description: Processed (or already-seen event, deduped)
 *       400:
 *         description: Invalid or missing signature
 */

module.exports = {};
