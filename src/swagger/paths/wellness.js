/**
 * @openapi
 * tags:
 *   - name: Wellness
 *     description: Daily check-ins, health metrics, and summaries
 *
 * /api/wellness/daily-checkin/today:
 *   get:
 *     tags: [Wellness]
 *     summary: Get today's daily check-in
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: date
 *         schema:
 *           type: string
 *           format: date
 *         description: Defaults to today (YYYY-MM-DD)
 *     responses:
 *       200:
 *         description: Check-in for date
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 checkIn:
 *                   type: object
 *                   nullable: true
 *                   additionalProperties: true
 *
 * /api/wellness/daily-checkin:
 *   post:
 *     tags: [Wellness]
 *     summary: Upsert daily check-in
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [mood]
 *             properties:
 *               mood:
 *                 type: string
 *               check_in_date:
 *                 type: string
 *                 format: date
 *               sleep_quality:
 *                 oneOf:
 *                   - type: integer
 *                   - type: string
 *                     enum: [excellent, good, poor]
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Check-in saved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 checkIn:
 *                   type: object
 *                   additionalProperties: true
 *       400:
 *         description: Mood required
 *
 * /api/wellness/health-metrics:
 *   get:
 *     tags: [Wellness]
 *     summary: List health metric readings
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *     responses:
 *       200:
 *         description: Health readings
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 readings:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/HealthReading'
 *   post:
 *     tags: [Wellness]
 *     summary: Insert health metric readings
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               readings:
 *                 type: array
 *                 items:
 *                   $ref: '#/components/schemas/HealthReading'
 *     responses:
 *       200:
 *         description: Readings inserted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 inserted:
 *                   type: integer
 *
 * /api/wellness/yesterday-summary:
 *   get:
 *     tags: [Wellness]
 *     summary: Yesterday's wellness summary
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Summary bundle
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 summary:
 *                   type: object
 *                   properties:
 *                     checkIn:
 *                       type: object
 *                       nullable: true
 *                     medicineLogs:
 *                       type: array
 *                       items:
 *                         type: object
 *                         additionalProperties: true
 *                     familyMessageCount:
 *                       type: integer
 *                     date:
 *                       type: string
 *                       format: date
 */

module.exports = {};
