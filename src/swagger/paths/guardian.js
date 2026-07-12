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
 *   post:
 *     tags: [Guardian]
 *     summary: Create shadow elder profile (ADR 0004) — guardian creates a real, immediately-claimable elder account directly, no invite/accept step
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [first_name, email, mobile, mobile_country, relation]
 *             properties:
 *               first_name:
 *                 type: string
 *               last_name:
 *                 type: string
 *               email:
 *                 type: string
 *                 format: email
 *               mobile:
 *                 type: string
 *               mobile_country:
 *                 type: string
 *                 description: Phone dial code, e.g. "+91"
 *               relation:
 *                 type: string
 *                 description: Guardian's relation to the elder (e.g. "Son"), not the elder's relation to the guardian
 *               location:
 *                 type: string
 *                 description: Country name from the guardian's country-picker selection for the elder
 *               country:
 *                 type: string
 *                 description: Same country name as location. If omitted, the server mirrors location's value automatically.
 *               country_code:
 *                 type: string
 *                 description: ISO country code (e.g. "IN") from the same picker selection. No fallback derivation — stays null if omitted.
 *               date_of_birth:
 *                 type: string
 *                 format: date
 *               blood_group:
 *                 type: string
 *               biological_sex:
 *                 type: string
 *                 enum: [male, female, other]
 *               preferred_language:
 *                 type: string
 *               height:
 *                 type: number
 *               height_unit:
 *                 type: string
 *                 enum: [ft, cm]
 *               weight:
 *                 type: number
 *               weight_unit:
 *                 type: string
 *                 enum: [kg, lbs]
 *               medical_conditions:
 *                 type: array
 *                 items:
 *                   type: string
 *               other_condition:
 *                 type: string
 *               allergies:
 *                 type: array
 *                 items:
 *                   type: string
 *               doctor_name:
 *                 type: string
 *               doctor_contact:
 *                 type: string
 *     description: >
 *       emergency_name / emergency_phone / emergency_relation are NOT accepted from the
 *       client — the server derives them from the guardian's own profile and relation.
 *     responses:
 *       200:
 *         description: Elder profile created and linked
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 elder:
 *                   type: object
 *                   description: Full stored elder profile, including server-derived emergency_* fields
 *                   properties:
 *                     id:
 *                       type: string
 *                     first_name:
 *                       type: string
 *                     last_name:
 *                       type: string
 *                     email:
 *                       type: string
 *                     mobile:
 *                       type: string
 *                     relation:
 *                       type: string
 *                     location:
 *                       type: string
 *                       nullable: true
 *                     country:
 *                       type: string
 *                       nullable: true
 *                     country_code:
 *                       type: string
 *                       nullable: true
 *                     date_of_birth:
 *                       type: string
 *                       nullable: true
 *                     blood_group:
 *                       type: string
 *                       nullable: true
 *                     biological_sex:
 *                       type: string
 *                       nullable: true
 *                     preferred_language:
 *                       type: string
 *                       nullable: true
 *                     height:
 *                       type: number
 *                       nullable: true
 *                     height_unit:
 *                       type: string
 *                       nullable: true
 *                     weight:
 *                       type: number
 *                       nullable: true
 *                     weight_unit:
 *                       type: string
 *                       nullable: true
 *                     medical_conditions:
 *                       type: array
 *                       nullable: true
 *                       items:
 *                         type: string
 *                     other_condition:
 *                       type: string
 *                       nullable: true
 *                     allergies:
 *                       type: array
 *                       nullable: true
 *                       items:
 *                         type: string
 *                     doctor_name:
 *                       type: string
 *                       nullable: true
 *                     doctor_contact:
 *                       type: string
 *                       nullable: true
 *                     emergency_name:
 *                       type: string
 *                       nullable: true
 *                     emergency_phone:
 *                       type: string
 *                       nullable: true
 *                     emergency_relation:
 *                       type: string
 *                       nullable: true
 *       400:
 *         description: Missing required fields or invalid mobile number
 *       402:
 *         description: Adding this elder crosses into a higher pricing tier — payment required (code UPGRADE_REQUIRED)
 *       409:
 *         description: Phone or email already registered to another account (code PHONE_TAKEN / EMAIL_TAKEN)
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
