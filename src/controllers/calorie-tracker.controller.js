const calorieTrackerService = require('../services/calorie-tracker.service');

function isTableMissing(error) {
  return (
    error?.code === '42P01'
    || error?.code === 'PGRST205'
    || error?.code === 'ER_NO_SUCH_TABLE'
    || error?.errno === 1146
  );
}

function resolveUserId(req) {
  return req.auth?.userId ?? null;
}

function handleError(res, err, fallbackMessage) {
  console.error('[calorie-tracker]', err);
  if (isTableMissing(err)) {
    return res.status(501).json({
      success: false,
      message: 'Calorie Tracker tables are not deployed. Run mysql/add_calorie_tracker.sql.',
    });
  }
  return res.status(err.statusCode || 500).json({ success: false, message: err.message || fallbackMessage });
}

/** GET /api/calorie-tracker/today?date= */
async function getToday(req, res) {
  try {
    const userId = resolveUserId(req);
    const summary = await calorieTrackerService.getTodaySummary(userId, req.query.date ?? null);
    return res.json({ success: true, data: summary });
  } catch (err) {
    return handleError(res, err, 'Could not load today\'s summary.');
  }
}

/** GET /api/calorie-tracker/goals */
async function getGoals(req, res) {
  try {
    const userId = resolveUserId(req);
    const goal = await calorieTrackerService.getGoal(userId);
    return res.json({ success: true, data: goal });
  } catch (err) {
    return handleError(res, err, 'Could not load goals.');
  }
}

/** PATCH /api/calorie-tracker/goals */
async function updateGoals(req, res) {
  try {
    const userId = resolveUserId(req);
    const goal = await calorieTrackerService.updateGoal(userId, req.body ?? {});
    return res.json({ success: true, data: goal });
  } catch (err) {
    return handleError(res, err, 'Could not update goals.');
  }
}

/** GET /api/calorie-tracker/meals?date=YYYY-MM-DD */
async function listMeals(req, res) {
  try {
    const userId = resolveUserId(req);
    const { date } = req.query ?? {};
    const meals = await calorieTrackerService.listMeals(userId, { date });
    return res.json({ success: true, data: { meals } });
  } catch (err) {
    return handleError(res, err, 'Could not load meals.');
  }
}

/** POST /api/calorie-tracker/meals */
async function createMeal(req, res) {
  try {
    const userId = resolveUserId(req);
    const meal = await calorieTrackerService.createMeal(userId, req.body ?? {});
    return res.json({ success: true, data: meal });
  } catch (err) {
    return handleError(res, err, 'Could not log meal.');
  }
}

/** DELETE /api/calorie-tracker/meals/:id */
async function deleteMeal(req, res) {
  try {
    const userId = resolveUserId(req);
    const deleted = await calorieTrackerService.deleteMeal(userId, req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Meal entry not found.' });
    }
    return res.json({ success: true });
  } catch (err) {
    return handleError(res, err, 'Could not delete meal.');
  }
}

module.exports = {
  getToday,
  getGoals,
  updateGoals,
  listMeals,
  createMeal,
  deleteMeal,
};
