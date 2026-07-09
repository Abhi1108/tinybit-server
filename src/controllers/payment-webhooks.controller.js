const razorpayService = require('../services/razorpay.service');
const webhooksService = require('../services/payment-webhooks.mysql');

/** POST /api/payments/webhook — no JWT; authenticated via HMAC signature instead. */
async function handleWebhook(req, res) {
  const signature = req.headers['x-razorpay-signature'];
  const eventId = req.headers['x-razorpay-event-id'];

  if (!req.rawBody) {
    console.error('[payment-webhooks] missing raw body — check express.json verify wiring in index.js');
    return res.status(500).json({ success: false, message: 'Server misconfiguration.' });
  }

  let valid;
  try {
    valid = razorpayService.verifyWebhookSignature({ rawBody: req.rawBody, signature });
  } catch (err) {
    console.error('[payment-webhooks] signature verification error:', err.message);
    return res.status(500).json({ success: false, message: 'Webhook not configured.' });
  }

  if (!valid) {
    return res.status(400).json({ success: false, message: 'Invalid signature.' });
  }

  if (!eventId) {
    return res.status(400).json({ success: false, message: 'Missing X-Razorpay-Event-Id header.' });
  }

  const body = req.body;
  try {
    await webhooksService.handleWebhookEvent({ eventId, eventType: body.event, body });
    return res.json({ success: true });
  } catch (err) {
    console.error('[payment-webhooks] handler error:', err);
    // Razorpay retries on non-2xx — surface as 500 so it retries a genuine processing failure.
    return res.status(500).json({ success: false, message: 'Webhook processing failed.' });
  }
}

module.exports = { handleWebhook };
