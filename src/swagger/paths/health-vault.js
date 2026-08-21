/**
 * @openapi
 * tags:
 *   - name: Health Vault
 *     description: Health record document storage
 *
 * /api/health-vault/records:
 *   get:
 *     tags: [Health Vault]
 *     summary: List health vault records
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Filter by category (e.g. Reports, Prescription, X-Rays, Blood Tests)
 *       - in: query
 *         name: date_range
 *         schema:
 *           type: string
 *           enum: [today, this_week, this_month, all_time]
 *     responses:
 *       200:
 *         description: Health records
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 records:
 *                   type: array
 *                   items:
 *                     type: object
 *                     additionalProperties: true
 *   post:
 *     tags: [Health Vault]
 *     summary: Create health vault record
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               date:
 *                 type: string
 *               type:
 *                 type: string
 *                 example: Report
 *               category:
 *                 type: string
 *                 example: Reports
 *               base64:
 *                 type: string
 *                 description: File content as base64
 *               mime_type:
 *                 type: string
 *               mimeType:
 *                 type: string
 *               size:
 *                 type: string
 *               icon_name:
 *                 type: string
 *               badge_bg:
 *                 type: string
 *               badge_color:
 *                 type: string
 *     responses:
 *       200:
 *         description: Record created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 record:
 *                   type: object
 *                   additionalProperties: true
 *
 * /api/health-vault/records/{id}:
 *   patch:
 *     tags: [Health Vault]
 *     summary: Edit a health vault record's title/category
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               category:
 *                 type: string
 *     responses:
 *       200:
 *         description: Record updated
 *       404:
 *         description: Record not found
 *   delete:
 *     tags: [Health Vault]
 *     summary: Delete health vault record
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
 *         description: Record deleted
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
 *         description: Record not found
 *
 * /api/health-vault/records/{id}/insights:
 *   post:
 *     tags: [Health Vault]
 *     summary: Get (or compute) AI health insights for a single record
 *     description: >
 *       Returns cached insights if already computed for this record, unless
 *       `refresh=true` is passed to force recomputation.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: refresh
 *         schema:
 *           type: boolean
 *     responses:
 *       200:
 *         description: AI insights (status, metrics, risk factors, recommendations, follow-up)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   additionalProperties: true
 *                 cached:
 *                   type: boolean
 *                 computed_at:
 *                   type: string
 *       404:
 *         description: Record not found
 *
 * /api/health-vault/compare:
 *   post:
 *     tags: [Health Vault]
 *     summary: Cross-analyse 2+ saved records in a single AI call
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               recordIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                 minItems: 2
 *     responses:
 *       200:
 *         description: Multi-report AI insights
 *       400:
 *         description: Fewer than 2 record ids provided
 *       404:
 *         description: One or more records not found
 *
 * /api/health-vault/doctors:
 *   get:
 *     tags: [Health Vault]
 *     summary: List the caller's saved "My Doctors" contacts
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Saved doctors
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 doctors:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       name:
 *                         type: string
 *                       phone:
 *                         type: string
 *                       created_at:
 *                         type: string
 *   post:
 *     tags: [Health Vault]
 *     summary: Add a saved doctor contact
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, phone]
 *             properties:
 *               name:
 *                 type: string
 *               phone:
 *                 type: string
 *     responses:
 *       200:
 *         description: Doctor added
 *       400:
 *         description: Missing name or phone
 *
 * /api/health-vault/doctors/{id}:
 *   delete:
 *     tags: [Health Vault]
 *     summary: Remove a saved doctor contact
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
 *         description: Doctor deleted
 *       404:
 *         description: Doctor not found
 */

module.exports = {};
