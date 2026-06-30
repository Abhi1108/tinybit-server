/**
 * @openapi
 * tags:
 *   - name: Care Events
 *     description: Care calendar events
 *
 * /api/care-events:
 *   get:
 *     tags: [Care Events]
 *     summary: List care calendar events
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Care events
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 careEvents:
 *                   type: array
 *                   items:
 *                     type: object
 *                     additionalProperties: true
 *   post:
 *     tags: [Care Events]
 *     summary: Create care calendar event
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, date, month, year, timestamp]
 *             properties:
 *               title:
 *                 type: string
 *               sub:
 *                 type: string
 *               time:
 *                 type: string
 *               type:
 *                 type: string
 *                 enum: [Doctor, Family, Therapy, Activity, Medicine, Wellness]
 *               color:
 *                 type: string
 *               emoji:
 *                 type: string
 *               date:
 *                 type: integer
 *               month:
 *                 type: string
 *               year:
 *                 type: integer
 *               timestamp:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Created care event
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 careEvent:
 *                   type: object
 *                   additionalProperties: true
 *       400:
 *         description: Missing fields or invalid event type
 *
 * /api/care-events/{id}:
 *   patch:
 *     tags: [Care Events]
 *     summary: Update care calendar event
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Care event ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               sub:
 *                 type: string
 *               time:
 *                 type: string
 *               type:
 *                 type: string
 *                 enum: [Doctor, Family, Therapy, Activity, Medicine, Wellness]
 *               color:
 *                 type: string
 *               emoji:
 *                 type: string
 *               date:
 *                 type: integer
 *               month:
 *                 type: string
 *               year:
 *                 type: integer
 *               timestamp:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Updated care event
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 careEvent:
 *                   type: object
 *                   additionalProperties: true
 *       400:
 *         description: Invalid event type
 *       404:
 *         description: Care event not found
 *   delete:
 *     tags: [Care Events]
 *     summary: Delete care calendar event
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Care event ID
 *     responses:
 *       200:
 *         description: Care event deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *       404:
 *         description: Care event not found
 */

module.exports = {};
