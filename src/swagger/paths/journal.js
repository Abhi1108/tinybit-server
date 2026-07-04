/**
 * @openapi
 * tags:
 *   - name: Journal
 *     description: Memory journal entries
 *
 * /api/journal:
 *   get:
 *     tags: [Journal]
 *     summary: List journal entries
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Journal entries
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 entries:
 *                   type: array
 *                   items:
 *                     type: object
 *                     additionalProperties: true
 *   post:
 *     tags: [Journal]
 *     summary: Create journal entry
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [type]
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [Written, Voice]
 *               content:
 *                 type: string
 *               prompt:
 *                 type: string
 *               audio_uri:
 *                 type: string
 *                 description: URL, data URI, or base64 audio
 *     responses:
 *       200:
 *         description: Entry created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 entry:
 *                   type: object
 *                   additionalProperties: true
 *       400:
 *         description: Invalid type or missing content
 *
 * /api/journal/count:
 *   get:
 *     tags: [Journal]
 *     summary: Count journal entries
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Entry count
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 count:
 *                   type: integer
 */

module.exports = {};
