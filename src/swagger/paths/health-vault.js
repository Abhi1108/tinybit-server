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
 */

module.exports = {};
