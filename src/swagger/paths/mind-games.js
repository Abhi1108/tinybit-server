/**
 * @openapi
 * tags:
 *   - name: Mind Games
 *     description: Cognitive game scores and leaderboard
 *
 * /api/mind-games/scores:
 *   post:
 *     tags: [Mind Games]
 *     summary: Submit game score
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [game_type, score]
 *             properties:
 *               game_type:
 *                 type: string
 *               gameType:
 *                 type: string
 *               score:
 *                 type: number
 *               duration_seconds:
 *                 type: number
 *                 description: Seconds spent playing this round; used to compute the playTime stat
 *                 default: 0
 *     responses:
 *       200:
 *         description: Score saved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 score:
 *                   type: object
 *                   additionalProperties: true
 *
 * /api/mind-games/stats:
 *   get:
 *     tags: [Mind Games]
 *     summary: Get user mind games stats
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User stats
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 stats:
 *                   type: object
 *                   additionalProperties: true
 *
 * /api/mind-games/leaderboard:
 *   get:
 *     tags: [Mind Games]
 *     summary: Get leaderboard
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 5
 *     responses:
 *       200:
 *         description: Leaderboard entries
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 leaderboard:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       userId:
 *                         type: string
 *                       name:
 *                         type: string
 *                       initial:
 *                         type: string
 *                       sub:
 *                         type: string
 *                       score:
 *                         type: number
 *                       avatarBg:
 *                         type: string
 */

module.exports = {};
