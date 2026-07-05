/**
 * @openapi
 * tags:
 *   - name: Streak
 *     description: Daily activity streak stats
 *
 * /api/streak/summary:
 *   get:
 *     tags: [Streak]
 *     summary: Get the caller's streak stats and recent activity history
 *     description: >
 *       activeDates covers from the later of (start of current month, 6 days ago)
 *       through today — enough to render both "This Week" and "This Month" views.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Streak summary
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
 *                     current:
 *                       type: integer
 *                     best:
 *                       type: integer
 *                     totalDays:
 *                       type: integer
 *                     activeDates:
 *                       type: array
 *                       items:
 *                         type: string
 *                         format: date
 */

module.exports = {};
