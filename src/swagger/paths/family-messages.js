/**
 * @openapi
 * tags:
 *   - name: Family Messages
 *     description: Family messaging between linked users
 *
 * /api/family/messages:
 *   post:
 *     tags: [Family Messages]
 *     summary: Send family message
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [receiver_id, message]
 *             properties:
 *               receiver_id:
 *                 type: string
 *                 format: uuid
 *               message:
 *                 type: string
 *     responses:
 *       200:
 *         description: Message sent
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: object
 *                   additionalProperties: true
 *
 * /api/family/messages/latest:
 *   get:
 *     tags: [Family Messages]
 *     summary: Get latest received message
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Latest message (may be null)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: object
 *                   nullable: true
 *                   additionalProperties: true
 *
 * /api/family/messages/count:
 *   get:
 *     tags: [Family Messages]
 *     summary: Count messages received on a date
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: date
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Message count
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 count:
 *                   type: integer
 *       400:
 *         description: date query param required (YYYY-MM-DD)
 */

module.exports = {};
