/**
 * @openapi
 * tags:
 *   - name: SOS
 *     description: Emergency SOS and emergency contacts
 *
 * /api/sos/trigger:
 *   post:
 *     tags: [SOS]
 *     summary: Log SOS event
 *     description: Logs an SOS alert. Device initiates call separately.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: SOS logged
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *
 * /api/sos/emergency-contacts:
 *   get:
 *     tags: [SOS]
 *     summary: List emergency contacts
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Emergency contacts
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 contacts:
 *                   type: array
 *                   items:
 *                     type: object
 *                     additionalProperties: true
 *   post:
 *     tags: [SOS]
 *     summary: Create emergency contact
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
 *               role:
 *                 type: string
 *               phone:
 *                 type: string
 *               color:
 *                 type: string
 *                 example: '#F0F4FF'
 *     responses:
 *       200:
 *         description: Contact created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 contact:
 *                   type: object
 *                   additionalProperties: true
 *
 * /api/sos/emergency-contacts/{id}:
 *   patch:
 *     tags: [SOS]
 *     summary: Update emergency contact
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
 *             properties:
 *               name:
 *                 type: string
 *               role:
 *                 type: string
 *               phone:
 *                 type: string
 *               color:
 *                 type: string
 *     responses:
 *       200:
 *         description: Contact updated
 *       404:
 *         description: Contact not found
 *   delete:
 *     tags: [SOS]
 *     summary: Delete emergency contact
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
 *         description: Contact deleted
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       404:
 *         description: Contact not found
 */

module.exports = {};
