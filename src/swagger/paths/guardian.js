/**
 * @openapi
 * tags:
 *   - name: Guardian
 *     description: Guardian–elder linking, invitations, and dashboard
 *
 * /api/guardian/invite:
 *   post:
 *     tags: [Guardian]
 *     summary: Invite elder as guardian
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [parent_name, relation, elder_email]
 *             properties:
 *               guardian_name:
 *                 type: string
 *               parent_name:
 *                 type: string
 *               relation:
 *                 type: string
 *               elder_email:
 *                 type: string
 *                 format: email
 *     responses:
 *       200:
 *         description: Invitation sent
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 elder_found:
 *                   type: boolean
 *       409:
 *         description: Pending invitation already exists
 *
 * /api/guardian/respond:
 *   post:
 *     tags: [Guardian]
 *     summary: Accept or decline guardian invitation
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [link_id, action]
 *             properties:
 *               link_id:
 *                 type: string
 *               action:
 *                 type: string
 *                 enum: [accept, decline]
 *     responses:
 *       200:
 *         description: Invitation responded
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 status:
 *                   type: string
 *
 * /api/guardian/pending-invitations:
 *   get:
 *     tags: [Guardian]
 *     summary: List pending invitations for elder
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Pending invitations
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 invitations:
 *                   type: array
 *                   items:
 *                     type: object
 *                     additionalProperties: true
 *
 * /api/guardian/sent-invitations:
 *   get:
 *     tags: [Guardian]
 *     summary: List invitations sent by guardian
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Sent invitations
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 invitations:
 *                   type: array
 *                   items:
 *                     type: object
 *                     additionalProperties: true
 *
 * /api/guardian/connected-guardians:
 *   get:
 *     tags: [Guardian]
 *     summary: List guardians connected to elder
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Connected guardians
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     additionalProperties: true
 *
 * /api/guardian/save-push-token:
 *   post:
 *     tags: [Guardian]
 *     summary: Save Expo push token for notifications
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [push_token]
 *             properties:
 *               push_token:
 *                 type: string
 *     responses:
 *       200:
 *         description: Token saved
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *
 * /api/guardian/elders:
 *   get:
 *     tags: [Guardian]
 *     summary: Guardian dashboard — linked elders
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Elder dashboard data
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
 *
 * /api/guardian/alerts:
 *   get:
 *     tags: [Guardian]
 *     summary: Guardian alerts for linked elders
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Alerts list
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
 *
 * /api/guardian/location:
 *   get:
 *     tags: [Guardian]
 *     summary: Elder locations and safe zones
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Location data
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
 *                     elders:
 *                       type: array
 *                       items:
 *                         type: object
 *                         additionalProperties: true
 *                     safeZones:
 *                       type: array
 *                       items:
 *                         type: object
 *                         additionalProperties: true
 *
 * /api/guardian/reports:
 *   get:
 *     tags: [Guardian]
 *     summary: Guardian health reports
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [weekly, monthly, yearly]
 *     responses:
 *       200:
 *         description: Report data
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
 */

module.exports = {};
