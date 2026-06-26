const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({
  limit: '25mb',
  strict: true,
  type: ['application/json', 'application/*+json'],
}));

// ── Health check first — no deps, responds instantly ─────────────────────────
app.get('/api/health', async (req, res) => {
  const db = process.env.DB_DRIVER || 'mysql';
  let dbOk = false;
  if (db === 'mysql') {
    try {
      const { query } = require('./config/mysql');
      await query('SELECT 1 AS ok');
      dbOk = true;
    } catch (err) {
      console.error('[health] mysql ping failed:', err.message);
    }
  }
  res.json({
    status:  'ok',
    message: 'TinyBit API is running',
    db,
    dbOk,
  });
});

// ── Routes — static requires so Vercel bundles all route files ─────────────
app.use('/api/auth',        require('./routes/auth.routes'));
app.use('/api/ai',          require('./routes/ai.routes'));
app.use('/api/guardian',    require('./routes/guardian.routes'));
app.use('/api/sos',         require('./routes/sos.routes'));
app.use('/api/wellness',    require('./routes/wellness.routes'));
app.use('/api/medicines',   require('./routes/medicine.routes'));
app.use('/api/appointments', require('./routes/appointments.routes'));
app.use('/api/care-events', require('./routes/care-events.routes'));
app.use('/api/journal', require('./routes/journal.routes'));
app.use('/api/family/messages', require('./routes/family-messages.routes'));
app.use('/api/health-card', require('./routes/health-card.routes'));
app.use('/api/health-vault', require('./routes/health-vault.routes'));
app.use('/api/mind-games',   require('./routes/mind-games.routes'));
app.use('/api/location',    require('./routes/location.routes'));
app.use('/api/doctors',     require('./routes/doctors.routes'));
app.use('/api/content',     require('./routes/content.routes'));
app.use('/api/mood-media',  require('./routes/mood-media.routes'));
app.use('/admin',           require('./routes/admin.routes'));

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    console.error('[body] Invalid JSON on', req.method, req.path, '-', err.message);
    return res.status(400).json({
      success: false,
      message: 'Invalid JSON body. Use: {"phone":"9876543210","countryCode":"+91"}',
    });
  }

  console.error(err.stack);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

// ── Local dev only — Vercel serverless must not call listen() ────────────────
const PORT = process.env.PORT || 5000;
if (!process.env.VERCEL) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 TinyBit Server running on port ${PORT}`);
    console.log(`✅ Node: ${process.version}`);
    console.log(`✅ Environment: ${process.env.NODE_ENV ?? 'development'}`);

    console.log(`✅ DB driver: ${process.env.DB_DRIVER || 'mysql'}`);

    if (!process.env.JWT_SECRET)                  console.warn('⚠️  JWT_SECRET not set — auth endpoints will fail');
    if ((process.env.DB_DRIVER || 'mysql') === 'mysql' && !process.env.MYSQL_URL && !process.env.MYSQL_HOST) {
      console.warn('⚠️  MYSQL_URL or MYSQL_HOST not set — database queries will fail');
    }
    if (!process.env.OPENAI_API_KEY)              console.warn('⚠️  OPENAI_API_KEY not set');
    if (!process.env.GEMINI_API_KEY)              console.warn('⚠️  GEMINI_API_KEY not set');
    if (!process.env.OTP_TOKEN_SECRET)            console.warn('⚠️  OTP_TOKEN_SECRET not set — using fallback secret');
  });
}

module.exports = app;
