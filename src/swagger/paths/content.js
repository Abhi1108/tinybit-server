/**
 * @openapi
 * tags:
 *   - name: Content
 *     description: Daily quiz and inspiration content
 *
 * /api/content/quiz/today:
 *   get:
 *     tags: [Content]
 *     summary: Get today's health quiz question
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Today's quiz
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 quiz:
 *                   type: object
 *                   properties:
 *                     q:
 *                       type: string
 *                     opts:
 *                       type: array
 *                       items:
 *                         type: string
 *                     ans:
 *                       type: integer
 *       404:
 *         description: No active quiz questions
 *
 * /api/content/inspiration/today:
 *   get:
 *     tags: [Content]
 *     summary: Get today's inspiration quote
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Today's inspiration
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 inspiration:
 *                   type: object
 *                   properties:
 *                     text:
 *                       type: string
 *                     author:
 *                       type: string
 *       404:
 *         description: No active inspirations
 */

module.exports = {};
