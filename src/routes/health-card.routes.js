const express = require('express');
const router = express.Router();

const { requireJwtAuth } = require('../middleware/jwtAuth.middleware');
const { generateHealthCardToken, getHealthCard, getHealthCardQR } = require('../controllers/health-card.controller');

// Generate / refresh the user's health QR token (auth required)
router.post('/generate', requireJwtAuth, generateHealthCardToken);

// Fetch QR as base64 PNG — auto-generates token if needed (auth required)
router.get('/qr', requireJwtAuth, getHealthCardQR);

// Public scan endpoint — returns HTML emergency card (or JSON with ?format=json)
// NOTE: must be last so /qr is matched before /:token
router.get('/:token', getHealthCard);

module.exports = router;
