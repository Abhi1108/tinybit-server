/**
 * @openapi
 * tags:
 *   - name: AI
 *     description: Sathi AI chat, voice, vision, and health insights
 *
 * /api/ai/chat:
 *   get:
 *     tags: [AI]
 *     summary: Get Sathi AI chat history
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Maximum number of messages to return
 *     responses:
 *       200:
 *         description: Chat history messages
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
 *                     messages:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/ChatMessage'
 *       401:
 *         description: Unauthorized
 *   post:
 *     tags: [AI]
 *     summary: Sathi AI chat
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [messages]
 *             properties:
 *               messages:
 *                 type: array
 *                 items:
 *                   $ref: '#/components/schemas/ChatMessage'
 *               context:
 *                 type: string
 *                 description: User health context injected into system prompt
 *     responses:
 *       200:
 *         description: AI response
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
 *                     content:
 *                       type: string
 *                 provider:
 *                   type: string
 *                   enum: [gemini]
 *       400:
 *         description: Invalid messages array
 *       401:
 *         description: Unauthorized
 *   delete:
 *     tags: [AI]
 *     summary: Clear Sathi AI chat history
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: History cleared
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *       401:
 *         description: Unauthorized
 *
 * /api/ai/transcribe:
 *   post:
 *     tags: [AI]
 *     summary: Transcribe audio (Gemini)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [base64]
 *             properties:
 *               base64:
 *                 type: string
 *                 description: Base64-encoded audio
 *               filename:
 *                 type: string
 *                 example: audio.m4a
 *               mimeType:
 *                 type: string
 *                 example: audio/m4a
 *     responses:
 *       200:
 *         description: Transcription result
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
 *                     text:
 *                       type: string
 *
 * /api/ai/analyze-report:
 *   post:
 *     tags: [AI]
 *     summary: Classify medical document image
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [base64]
 *             properties:
 *               base64:
 *                 type: string
 *               mimeType:
 *                 type: string
 *                 example: image/jpeg
 *     responses:
 *       200:
 *         description: Classification result
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
 *                     isReport:
 *                       type: boolean
 *                     category:
 *                       type: string
 *                       nullable: true
 *
 * /api/ai/analyze-food:
 *   post:
 *     tags: [AI]
 *     summary: Analyze food photo for nutrition
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [base64]
 *             properties:
 *               base64:
 *                 type: string
 *               mimeType:
 *                 type: string
 *     responses:
 *       200:
 *         description: Nutrition analysis
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
 *                 provider:
 *                   type: string
 *
 * /api/ai/suggest-clothing:
 *   post:
 *     tags: [AI]
 *     summary: Weather-based clothing suggestions
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               temperature:
 *                 type: number
 *               feelsLike:
 *                 type: number
 *               condition:
 *                 type: string
 *               humidity:
 *                 type: number
 *               windSpeed:
 *                 type: number
 *               uvIndex:
 *                 type: number
 *     responses:
 *       200:
 *         description: Clothing suggestions
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
 *                     summary:
 *                       type: string
 *                     items:
 *                       type: array
 *                       items:
 *                         type: string
 *                     healthTips:
 *                       type: array
 *                       items:
 *                         type: string
 *                     warning:
 *                       type: string
 *                       nullable: true
 *                     emoji:
 *                       type: string
 *       502:
 *         description: Weather recommendation AI is currently unavailable
 *
 * /api/ai/wellness-summary:
 *   post:
 *     tags: [AI]
 *     summary: AI wellness log summary
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               logs:
 *                 type: array
 *                 items:
 *                   $ref: '#/components/schemas/HealthReading'
 *               profile:
 *                 type: object
 *                 properties:
 *                   fullName:
 *                     type: string
 *                   age:
 *                     type: integer
 *     responses:
 *       200:
 *         description: Wellness summary
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
 *       502:
 *         description: Wellness summary AI is currently unavailable
 *
 * /api/ai/health-forecast:
 *   post:
 *     tags: [AI]
 *     summary: AI insights for a single health record
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               record:
 *                 type: object
 *                 additionalProperties: true
 *               profile:
 *                 type: object
 *                 additionalProperties: true
 *     responses:
 *       200:
 *         description: Health forecast insights
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
 *       502:
 *         description: Health forecast AI is currently unavailable
 *
 * /api/ai/health-forecast-multi:
 *   post:
 *     tags: [AI]
 *     summary: AI trend analysis across multiple health records
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               records:
 *                 type: array
 *                 items:
 *                   type: object
 *                   additionalProperties: true
 *               profile:
 *                 type: object
 *                 additionalProperties: true
 *     responses:
 *       200:
 *         description: Multi-record trend analysis
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
 *       502:
 *         description: Multi-record trend analysis AI is currently unavailable
 */

module.exports = {};
