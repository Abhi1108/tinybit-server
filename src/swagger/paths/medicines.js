/**
 * @openapi
 * tags:
 *   - name: Medicines
 *     description: Medicine CRUD and daily logs
 *
 * /api/medicines:
 *   get:
 *     tags: [Medicines]
 *     summary: List medicines
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: active
 *         schema:
 *           type: string
 *           default: 'true'
 *         description: Set to false to include inactive medicines
 *     responses:
 *       200:
 *         description: Medicine list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 medicines:
 *                   type: array
 *                   items:
 *                     type: object
 *                     additionalProperties: true
 *   post:
 *     tags: [Medicines]
 *     summary: Create medicine(s)
 *     description: Accepts a single medicine object or a medicines array wrapper.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             oneOf:
 *               - type: object
 *                 required: [name]
 *                 properties:
 *                   name:
 *                     type: string
 *                   dosage:
 *                     type: string
 *                   frequency:
 *                     type: string
 *                   schedule_time:
 *                     type: string
 *               - type: object
 *                 properties:
 *                   medicines:
 *                     type: array
 *                     items:
 *                       type: object
 *                       required: [name]
 *                       properties:
 *                         name:
 *                           type: string
 *     responses:
 *       200:
 *         description: Medicines created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 medicines:
 *                   type: array
 *                   items:
 *                     type: object
 *                     additionalProperties: true
 *
 * /api/medicines/logs:
 *   get:
 *     tags: [Medicines]
 *     summary: List medicine logs
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: scope
 *         schema:
 *           type: string
 *           enum: [day, week]
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *     responses:
 *       200:
 *         description: Medicine logs
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 logs:
 *                   type: array
 *                   items:
 *                     type: object
 *                     additionalProperties: true
 *
 * /api/medicines/logs/toggle:
 *   post:
 *     tags: [Medicines]
 *     summary: Toggle medicine taken for a day
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [medicine_id, taken]
 *             properties:
 *               medicine_id:
 *                 type: string
 *               taken:
 *                 type: boolean
 *               date:
 *                 type: string
 *                 format: date
 *                 description: Defaults to today
 *     responses:
 *       200:
 *         description: Log updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 log:
 *                   type: object
 *                   additionalProperties: true
 *
 * /api/medicines/{id}:
 *   get:
 *     tags: [Medicines]
 *     summary: Get medicine by ID
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
 *         description: Medicine detail
 *       404:
 *         description: Not found
 *   patch:
 *     tags: [Medicines]
 *     summary: Update medicine
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties: true
 *     responses:
 *       200:
 *         description: Medicine updated
 *       404:
 *         description: Not found
 *   delete:
 *     tags: [Medicines]
 *     summary: Delete medicine
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
 *         description: Medicine deleted
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 id:
 *                   type: string
 *       404:
 *         description: Not found
 */

module.exports = {};
