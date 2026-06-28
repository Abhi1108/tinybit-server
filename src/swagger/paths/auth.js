/**
 * @openapi
 * tags:
 *   - name: Auth
 *     description: Authentication, sessions, profile, and user settings
 *
 * /api/auth/otp/send:
 *   post:
 *     tags: [Auth]
 *     summary: Send OTP (deprecated)
 *     deprecated: true
 *     description: |
 *       **Removed — returns HTTP 410 Gone.** Twilio OTP was removed.
 *       Use Firebase phone auth on the device, then exchange the Firebase ID token at `POST /api/auth/phone`.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: Legacy OTP request body (no longer processed)
 *     responses:
 *       410:
 *         description: Endpoint permanently removed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DeprecatedOtpResponse'
 *
 * /api/auth/otp/verify:
 *   post:
 *     tags: [Auth]
 *     summary: Verify OTP (deprecated)
 *     deprecated: true
 *     description: |
 *       **Removed — returns HTTP 410 Gone.** Use Firebase phone auth + `POST /api/auth/phone`.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       410:
 *         description: Endpoint permanently removed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DeprecatedOtpResponse'
 *
 * /api/auth/otp/complete:
 *   post:
 *     tags: [Auth]
 *     summary: Complete OTP signup (deprecated)
 *     deprecated: true
 *     description: |
 *       **Removed — returns HTTP 410 Gone.** Use Firebase phone auth + `POST /api/auth/phone`.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       410:
 *         description: Endpoint permanently removed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DeprecatedOtpResponse'
 *
 * /api/auth/google/status:
 *   get:
 *     tags: [Auth]
 *     summary: Firebase Admin configuration status
 *     description: Checks Firebase Admin setup for Google/phone auth. No secrets returned.
 *     responses:
 *       200:
 *         description: Firebase status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 configured:
 *                   type: boolean
 *                 projectId:
 *                   type: string
 *                 expectedProjectId:
 *                   type: string
 *                 projectMatchesApp:
 *                   type: boolean
 *                 phoneAuth:
 *                   type: string
 *                   example: firebase-on-device
 *                 hint:
 *                   type: string
 *
 * /api/auth/google:
 *   post:
 *     tags: [Auth]
 *     summary: Google sign-in via Firebase ID token
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [idToken]
 *             properties:
 *               idToken:
 *                 type: string
 *                 description: Firebase Google ID token from the mobile app
 *     responses:
 *       200:
 *         description: Session issued
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 isNewUser:
 *                   type: boolean
 *                 session:
 *                   $ref: '#/components/schemas/Session'
 *       400:
 *         description: Missing or invalid idToken
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Token verification failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *
 * /api/auth/phone:
 *   post:
 *     tags: [Auth]
 *     summary: Phone sign-in via Firebase ID token
 *     description: Exchange a Firebase phone-auth ID token for a TinyBit JWT session.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [idToken]
 *             properties:
 *               idToken:
 *                 type: string
 *                 description: Firebase phone ID token (must include phone_number claim)
 *     responses:
 *       200:
 *         description: Session issued
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 isNewUser:
 *                   type: boolean
 *                 session:
 *                   $ref: '#/components/schemas/Session'
 *       400:
 *         description: Missing idToken or phone_number claim
 *       401:
 *         description: Token verification failed
 *
 * /api/auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Password login
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [verificationToken, password]
 *             properties:
 *               verificationToken:
 *                 type: string
 *                 description: Short-lived token from Firebase phone verification flow
 *               password:
 *                 type: string
 *                 format: password
 *     responses:
 *       200:
 *         description: Session issued
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 session:
 *                   $ref: '#/components/schemas/Session'
 *       401:
 *         description: Invalid credentials
 *
 * /api/auth/register:
 *   post:
 *     tags: [Auth]
 *     summary: Register new account
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [verificationToken, password, fullName]
 *             properties:
 *               verificationToken:
 *                 type: string
 *               password:
 *                 type: string
 *                 format: password
 *                 minLength: 8
 *               fullName:
 *                 type: string
 *     responses:
 *       200:
 *         description: Account created and session issued
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 session:
 *                   $ref: '#/components/schemas/Session'
 *       409:
 *         description: Account already exists
 *
 * /api/auth/refresh:
 *   post:
 *     tags: [Auth]
 *     summary: Refresh access token
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refresh_token]
 *             properties:
 *               refresh_token:
 *                 type: string
 *     responses:
 *       200:
 *         description: New session
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 session:
 *                   $ref: '#/components/schemas/Session'
 *       401:
 *         description: Refresh token invalid or expired
 *
 * /api/auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: Revoke refresh token
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refresh_token]
 *             properties:
 *               refresh_token:
 *                 type: string
 *     responses:
 *       200:
 *         description: Logged out
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                   example: Logged out
 *
 * /api/auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: Get current user and profile
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User and profile data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 user:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       format: uuid
 *                     email:
 *                       type: string
 *                 profile:
 *                   type: object
 *                   additionalProperties: true
 *       401:
 *         description: Missing or invalid token
 *
 * /api/auth/profile:
 *   patch:
 *     tags: [Auth]
 *     summary: Update user profile
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               role:
 *                 type: string
 *               first_name:
 *                 type: string
 *               last_name:
 *                 type: string
 *               full_name:
 *                 type: string
 *               mobile:
 *                 type: string
 *               location:
 *                 type: string
 *               preferred_language:
 *                 type: string
 *               biological_sex:
 *                 type: string
 *               height:
 *                 type: number
 *               height_unit:
 *                 type: string
 *               weight:
 *                 type: number
 *               weight_unit:
 *                 type: string
 *               date_of_birth:
 *                 type: string
 *                 format: date
 *               blood_group:
 *                 type: string
 *               medical_conditions:
 *                 type: array
 *                 items:
 *                   type: string
 *               emergency_name:
 *                 type: string
 *               emergency_phone:
 *                 type: string
 *               emergency_relation:
 *                 type: string
 *               profile_image:
 *                 type: string
 *     responses:
 *       200:
 *         description: Profile saved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 profile:
 *                   type: object
 *                   additionalProperties: true
 *       400:
 *         description: No fields to update
 *       401:
 *         description: Unauthorized
 *
 * /api/auth/settings:
 *   get:
 *     tags: [Auth]
 *     summary: Get user settings
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User settings
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 settings:
 *                   type: object
 *                   properties:
 *                     voice_navigation:
 *                       type: boolean
 *                     vibration_alerts:
 *                       type: boolean
 *                     fall_detection:
 *                       type: boolean
 *                     night_mode:
 *                       type: boolean
 *                     font_scale:
 *                       type: number
 *                     language:
 *                       type: string
 *       401:
 *         description: Unauthorized
 *   patch:
 *     tags: [Auth]
 *     summary: Update user settings
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               voice_navigation:
 *                 type: boolean
 *               vibration_alerts:
 *                 type: boolean
 *               fall_detection:
 *                 type: boolean
 *               night_mode:
 *                 type: boolean
 *               font_scale:
 *                 type: number
 *               language:
 *                 type: string
 *     responses:
 *       200:
 *         description: Settings saved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 settings:
 *                   type: object
 *                   additionalProperties: true
 *       400:
 *         description: No settings to update
 *       401:
 *         description: Unauthorized
 */

module.exports = {};
