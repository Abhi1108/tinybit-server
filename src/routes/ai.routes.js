const express = require('express');
const router = express.Router();

const { requireJwtAuth } = require('../middleware/jwtAuth.middleware');
const { requireFeature } = require('../middleware/planEntitlement.middleware');
const {
  getChatHistory,
  clearChatHistory,
  chat,
  transcribe,
  analyzeReport,
  analyzeFood,
  suggestClothing,
  wellnessSummary,
  healthForecast,
  healthForecastMulti,
  suggestMeal,
  suggestCalorieGoal,
} = require('../controllers/ai.controller');

// Sathi AI core
router.get('/chat',             requireJwtAuth, getChatHistory);
router.post('/chat',            requireJwtAuth, chat);
router.delete('/chat',          requireJwtAuth, clearChatHistory);
router.post('/transcribe',      requireJwtAuth, transcribe);

// Health document analysis
router.post('/analyze-report',  requireJwtAuth, analyzeReport);

// New AI features
router.post('/analyze-food',    requireJwtAuth, analyzeFood);       // Calorie calculator
router.post('/suggest-clothing',requireJwtAuth, suggestClothing);   // Weather AI suggestions
router.post('/wellness-summary',requireJwtAuth, wellnessSummary);   // Wellness log AI summary
// Health Forecasting: Premium only
router.post('/health-forecast',       requireJwtAuth, requireFeature('health_forecasting'), healthForecast);       // Single record AI insights
router.post('/health-forecast-multi', requireJwtAuth, requireFeature('health_forecasting'), healthForecastMulti);  // Multi-record trend analysis
router.post('/suggest-meal',    requireJwtAuth, suggestMeal);       // Calorie Tracker "Eat Next" AI suggestions
router.post('/suggest-calorie-goal', requireJwtAuth, suggestCalorieGoal); // Calorie Tracker "My Goals" AI suggestion

module.exports = router;
