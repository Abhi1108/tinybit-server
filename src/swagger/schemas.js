/**
 * @openapi
 * components:
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *       description: TinyBit access token from POST /api/auth/login, /phone, /google, or /register
 *
 *   schemas:
 *     SuccessResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *
 *     ErrorResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: false
 *         message:
 *           type: string
 *
 *     DeprecatedOtpResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: false
 *         message:
 *           type: string
 *           example: Twilio OTP was removed. Update the app and sign in with Firebase phone auth.
 *         hint:
 *           type: string
 *           example: Install a recent TinyBit build. OTP is sent by Firebase on the device, then exchanged at POST /api/auth/phone.
 *
 *     Session:
 *       type: object
 *       properties:
 *         access_token:
 *           type: string
 *         refresh_token:
 *           type: string
 *         expires_in:
 *           type: integer
 *         token_type:
 *           type: string
 *           example: bearer
 *         user:
 *           type: object
 *           properties:
 *             id:
 *               type: string
 *               format: uuid
 *             email:
 *               type: string
 *
 *     ChatMessage:
 *       type: object
 *       required: [role, content]
 *       properties:
 *         role:
 *           type: string
 *           enum: [user, assistant]
 *         content:
 *           type: string
 *
 *     HealthReading:
 *       type: object
 *       properties:
 *         type:
 *           type: string
 *           example: blood_pressure
 *         value:
 *           type: string
 *         unit:
 *           type: string
 *         logged_at:
 *           type: string
 *           format: date-time
 */

module.exports = {};
