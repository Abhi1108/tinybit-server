/**
 * @openapi
 * tags:
 *   - name: CalorieTracker
 *     description: Daily calorie/macro goals and logged meals
 *
 * /api/calorie-tracker/today:
 *   get:
 *     tags: [CalorieTracker]
 *     summary: Get today's intake summary (goal + totals + logged meals)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Today's summary
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     goal:
 *                       type: object
 *                       additionalProperties: true
 *                     totals:
 *                       type: object
 *                       properties:
 *                         calories: { type: number }
 *                         protein_g: { type: number }
 *                         carbs_g: { type: number }
 *                         fat_g: { type: number }
 *                     remaining_calories:
 *                       type: number
 *                     meal_count:
 *                       type: integer
 *                     meals:
 *                       type: array
 *                       items:
 *                         additionalProperties: true
 *       401:
 *         description: Unauthorized
 *
 * /api/calorie-tracker/goals:
 *   get:
 *     tags: [CalorieTracker]
 *     summary: Get the user's daily calorie/macro goal
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Goal (created with defaults on first read)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     daily_calories: { type: integer }
 *                     protein_g: { type: integer }
 *                     carbs_g: { type: integer }
 *                     fat_g: { type: integer }
 *                     diet_type: { type: string, nullable: true }
 *                     activity_level: { type: string, nullable: true }
 *       401:
 *         description: Unauthorized
 *   patch:
 *     tags: [CalorieTracker]
 *     summary: Update the user's daily calorie/macro goal
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               daily_calories: { type: integer }
 *               protein_g: { type: integer }
 *               carbs_g: { type: integer }
 *               fat_g: { type: integer }
 *               diet_type:
 *                 type: string
 *                 enum: [balanced, diabetic, heart-healthy, high-protein, vegetarian, low-sodium, weight-loss]
 *               activity_level:
 *                 type: string
 *                 enum: [sedentary, light, moderate, active, very-active]
 *     responses:
 *       200:
 *         description: Updated goal
 *       400:
 *         description: Invalid diet_type or activity_level
 *       401:
 *         description: Unauthorized
 *
 * /api/calorie-tracker/meals:
 *   get:
 *     tags: [CalorieTracker]
 *     summary: List logged meals
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: date
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter to a single day (YYYY-MM-DD). Omit for the most recent 100 entries.
 *     responses:
 *       200:
 *         description: Meal log entries
 *       401:
 *         description: Unauthorized
 *   post:
 *     tags: [CalorieTracker]
 *     summary: Log a meal (from a confirmed Scan Food analysis, or manual entry)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [meal_type, calories]
 *             properties:
 *               meal_type:
 *                 type: string
 *                 enum: [breakfast, lunch, dinner, snack]
 *               food_items:
 *                 type: array
 *                 items: { type: string }
 *               calories: { type: integer }
 *               protein_g: { type: number }
 *               carbs_g: { type: number }
 *               fat_g: { type: number }
 *               fiber_g: { type: number }
 *               sugar_g: { type: number }
 *               sodium_mg: { type: number }
 *               vitamins:
 *                 type: array
 *                 items: { type: string }
 *               minerals:
 *                 type: array
 *                 items: { type: string }
 *               health_score: { type: integer }
 *               health_rating: { type: string }
 *               portion_size: { type: string }
 *               serving_info: { type: string }
 *               image_url:
 *                 type: string
 *                 description: HTTPS S3 URL from /api/storage/presign-upload (purpose "calorie-tracker")
 *     responses:
 *       200:
 *         description: Logged meal
 *       400:
 *         description: Invalid meal_type
 *       401:
 *         description: Unauthorized
 *
 * /api/calorie-tracker/meals/{id}:
 *   delete:
 *     tags: [CalorieTracker]
 *     summary: Delete a logged meal entry
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Deleted
 *       404:
 *         description: Not found
 *       401:
 *         description: Unauthorized
 */
