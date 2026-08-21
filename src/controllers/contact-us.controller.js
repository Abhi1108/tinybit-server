const contactUsService = require('../services/contact-us.mysql');

/** POST /api/contact-us — public contact form / report ping (persisted, no auth). */
async function createContactMessage(req, res) {
  try {
    const body = req.body ?? {};
    const name = String(body.name ?? '').trim();
    const email = String(body.email ?? '').trim();
    const subject = String(body.subject ?? '').trim();
    const message = String(body.message ?? '').trim();

    if (!message) {
      return res.status(400).json({ success: false, message: 'Message is required' });
    }

    const created = await contactUsService.createMessage({ name, email, subject, message });
    return res.json({ success: true, id: created.id, message: 'Received' });
  } catch (err) {
    console.error('[contact-us]', err.message || err);
    return res.status(500).json({ success: false, message: 'Could not submit message' });
  }
}

module.exports = { createContactMessage };
