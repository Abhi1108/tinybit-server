const { randomUUID } = require('crypto');
const { query, execute } = require('../config/mysql');

const DEFAULT_GOAL = { daily_calories: 2000, protein_g: 60, carbs_g: 250, fat_g: 65 };
const MEAL_TYPES = new Set(['breakfast', 'lunch', 'dinner', 'snack']);

function parseJson(value) {
  if (value == null) return value;
  if (Array.isArray(value) || typeof value === 'object') return value;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

function toIsoString(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function mapGoalRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    daily_calories: Number(row.daily_calories),
    protein_g: Number(row.protein_g),
    carbs_g: Number(row.carbs_g),
    fat_g: Number(row.fat_g),
    updated_at: toIsoString(row.updated_at),
  };
}

function mapMealRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    meal_type: row.meal_type,
    food_items: parseJson(row.food_items) ?? [],
    calories: Number(row.calories),
    protein_g: row.protein_g != null ? Number(row.protein_g) : null,
    carbs_g: row.carbs_g != null ? Number(row.carbs_g) : null,
    fat_g: row.fat_g != null ? Number(row.fat_g) : null,
    fiber_g: row.fiber_g != null ? Number(row.fiber_g) : null,
    sugar_g: row.sugar_g != null ? Number(row.sugar_g) : null,
    sodium_mg: row.sodium_mg != null ? Number(row.sodium_mg) : null,
    vitamins: parseJson(row.vitamins) ?? [],
    minerals: parseJson(row.minerals) ?? [],
    health_score: row.health_score != null ? Number(row.health_score) : null,
    health_rating: row.health_rating,
    portion_size: row.portion_size,
    serving_info: row.serving_info,
    image_url: row.image_url,
    logged_at: toIsoString(row.logged_at),
  };
}

async function getGoal(userId) {
  const rows = await query('SELECT * FROM calorie_goals WHERE user_id = ? LIMIT 1', [userId]);
  if (rows.length > 0) return mapGoalRow(rows[0]);

  // No goal set yet — create the default row so future reads/writes have something to update.
  const id = randomUUID();
  await execute(
    `INSERT INTO calorie_goals (id, user_id, daily_calories, protein_g, carbs_g, fat_g)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, userId, DEFAULT_GOAL.daily_calories, DEFAULT_GOAL.protein_g, DEFAULT_GOAL.carbs_g, DEFAULT_GOAL.fat_g],
  );
  const rows2 = await query('SELECT * FROM calorie_goals WHERE id = ? LIMIT 1', [id]);
  return mapGoalRow(rows2[0]);
}

async function updateGoal(userId, patch) {
  await getGoal(userId); // ensure a row exists

  const fields = ['daily_calories', 'protein_g', 'carbs_g', 'fat_g'];
  const entries = fields
    .filter((f) => patch[f] !== undefined)
    .map((f) => [f, Number(patch[f])]);

  if (entries.length === 0) return getGoal(userId);

  const sets = entries.map(([f]) => `${f} = ?`).join(', ');
  const values = entries.map(([, v]) => v);
  await execute(`UPDATE calorie_goals SET ${sets} WHERE user_id = ?`, [...values, userId]);

  return getGoal(userId);
}

async function listMeals(userId, { date } = {}) {
  const rows = date
    ? await query(
        'SELECT * FROM meal_logs WHERE user_id = ? AND logged_date = ? ORDER BY logged_at ASC',
        [userId, date],
      )
    : await query(
        'SELECT * FROM meal_logs WHERE user_id = ? ORDER BY logged_at DESC LIMIT 100',
        [userId],
      );
  return rows.map(mapMealRow);
}

async function createMeal(userId, payload) {
  const mealType = String(payload.meal_type || '').toLowerCase();
  if (!MEAL_TYPES.has(mealType)) {
    const err = new Error(`meal_type must be one of: ${[...MEAL_TYPES].join(', ')}`);
    err.statusCode = 400;
    throw err;
  }

  const id = randomUUID();
  await execute(
    `INSERT INTO meal_logs (
       id, user_id, meal_type, food_items, calories, protein_g, carbs_g, fat_g,
       fiber_g, sugar_g, sodium_mg, vitamins, minerals, health_score, health_rating,
       portion_size, serving_info, image_url
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      userId,
      mealType,
      JSON.stringify(payload.food_items ?? []),
      Number(payload.calories) || 0,
      payload.protein_g ?? null,
      payload.carbs_g ?? null,
      payload.fat_g ?? null,
      payload.fiber_g ?? null,
      payload.sugar_g ?? null,
      payload.sodium_mg ?? null,
      JSON.stringify(payload.vitamins ?? []),
      JSON.stringify(payload.minerals ?? []),
      payload.health_score ?? null,
      payload.health_rating ?? null,
      payload.portion_size ?? null,
      payload.serving_info ?? null,
      payload.image_url ?? null,
    ],
  );

  const rows = await query('SELECT * FROM meal_logs WHERE id = ? LIMIT 1', [id]);
  return mapMealRow(rows[0]);
}

async function deleteMeal(userId, mealId) {
  const result = await execute('DELETE FROM meal_logs WHERE id = ? AND user_id = ?', [mealId, userId]);
  return result.affectedRows > 0;
}

async function getTodaySummary(userId) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const [goal, meals] = await Promise.all([
    getGoal(userId),
    listMeals(userId, { date: todayStr }),
  ]);

  const totals = meals.reduce(
    (acc, m) => ({
      calories: acc.calories + (m.calories || 0),
      protein_g: acc.protein_g + (m.protein_g || 0),
      carbs_g: acc.carbs_g + (m.carbs_g || 0),
      fat_g: acc.fat_g + (m.fat_g || 0),
    }),
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
  );

  return {
    goal,
    totals,
    remaining_calories: Math.max(0, goal.daily_calories - totals.calories),
    meal_count: meals.length,
    meals,
  };
}

module.exports = {
  getGoal,
  updateGoal,
  listMeals,
  createMeal,
  deleteMeal,
  getTodaySummary,
};
