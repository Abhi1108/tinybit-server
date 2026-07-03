const express = require('express');
const router = express.Router();

const { requireJwtAuth } = require('../middleware/jwtAuth.middleware');
const {
  getToday,
  getGoals,
  updateGoals,
  listMeals,
  createMeal,
  deleteMeal,
} = require('../controllers/calorie-tracker.controller');

router.get('/today', requireJwtAuth, getToday);
router.get('/goals', requireJwtAuth, getGoals);
router.patch('/goals', requireJwtAuth, updateGoals);
router.get('/meals', requireJwtAuth, listMeals);
router.post('/meals', requireJwtAuth, createMeal);
router.delete('/meals/:id', requireJwtAuth, deleteMeal);

module.exports = router;
