const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' }));

// ── Health check first — no deps, responds instantly ─────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'TinyBit API is running' });
});

// ── Start listening immediately so healthcheck can always get a response ──────
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 TinyBit Server running on port ${PORT}`);
  console.log(`✅ Node: ${process.version}`);
  console.log(`✅ Environment: ${process.env.NODE_ENV ?? 'development'}`);

  // Warn about missing optional vars (don't crash — let routes handle it)
  if (!process.env.SUPABASE_URL)            console.warn('⚠️  SUPABASE_URL not set');
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) console.warn('⚠️  SUPABASE_SERVICE_ROLE_KEY not set');
  if (!process.env.OPENAI_API_KEY)          console.warn('⚠️  OPENAI_API_KEY not set');
  if (!process.env.GEMINI_API_KEY)          console.warn('⚠️  GEMINI_API_KEY not set');
  if (!process.env.TWILIO_ACCOUNT_SID)        console.warn('⚠️  TWILIO_ACCOUNT_SID not set — OTP_DEV_MODE active');
  if (!process.env.OTP_TOKEN_SECRET)          console.warn('⚠️  OTP_TOKEN_SECRET not set — using fallback secret');
});

// ── Routes — each mounted independently so one crash can't silence the rest ──
function mountRoute(path, routeFile) {
  try {
    app.use(path, require(routeFile));
    console.log(`✅ Route mounted: ${path}`);
  } catch (err) {
    console.error(`❌ Failed to mount ${path}: ${err.message}`);
    console.error(err.stack);
  }
}

mountRoute('/api/auth',        './routes/auth.routes');
mountRoute('/api/ai',          './routes/ai.routes');
mountRoute('/api/guardian',    './routes/guardian.routes');
mountRoute('/api/health-card', './routes/health-card.routes');
mountRoute('/admin',           './routes/admin.routes');

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

module.exports = app;
