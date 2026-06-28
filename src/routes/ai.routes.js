const express = require('express');
const router = express.Router();

const { requireJwtAuth } = require('../middleware/jwtAuth.middleware');
const {
  getChatHistory,
  chat,
  transcribe,
  tts,
  analyzeReport,
  analyzeFood,
  suggestClothing,
  wellnessSummary,
  healthForecast,
  healthForecastMulti,
} = require('../controllers/ai.controller');

// Sathi AI core
router.get('/chat',             requireJwtAuth, getChatHistory);
router.post('/chat',            requireJwtAuth, chat);
router.post('/transcribe',      requireJwtAuth, transcribe);
router.post('/tts',             requireJwtAuth, tts);

// Health document analysis
router.post('/analyze-report',  requireJwtAuth, analyzeReport);

// New AI features
router.post('/analyze-food',    requireJwtAuth, analyzeFood);       // Calorie calculator
router.post('/suggest-clothing',requireJwtAuth, suggestClothing);   // Weather AI suggestions
router.post('/wellness-summary',requireJwtAuth, wellnessSummary);   // Wellness log AI summary
router.post('/health-forecast',       requireJwtAuth, healthForecast);       // Single record AI insights
router.post('/health-forecast-multi', requireJwtAuth, healthForecastMulti);  // Multi-record trend analysis

module.exports = router;
