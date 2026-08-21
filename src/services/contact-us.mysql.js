const { randomUUID } = require('crypto');
const { execute } = require('../config/mysql');

/** Insert a contact form submission (also used as the n8n health-report ping log). */
async function createMessage({ name, email, subject, message }) {
  const id = randomUUID();
  await execute(
    `INSERT INTO contact_us_messages (id, name, email, subject, message)
     VALUES (?, ?, ?, ?, ?)`,
    [id, name || null, email || null, subject || null, message],
  );
  return { id };
}

module.exports = { createMessage };
