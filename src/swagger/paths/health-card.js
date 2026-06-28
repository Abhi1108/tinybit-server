/**
 * @openapi
 * tags:
 *   - name: Health Card
 *     description: Emergency health QR card generation and public scan
 *
 * /api/health-card/generate:
 *   post:
 *     tags: [Health Card]
 *     summary: Generate or refresh health QR token
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Token and scan URL
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
 *                     token:
 *                       type: string
 *                     scanUrl:
 *                       type: string
 *                       format: uri
 *                     expiresAt:
 *                       type: string
 *                       format: date-time
 *
 * /api/health-card/qr:
 *   get:
 *     tags: [Health Card]
 *     summary: Get QR code as base64 PNG
 *     description: Auto-generates token if needed.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: QR data URL and scan URL
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
 *                     qrDataUrl:
 *                       type: string
 *                     scanUrl:
 *                       type: string
 *                     expiresAt:
 *                       type: string
 *                       format: date-time
 *                     token:
 *                       type: string
 *
 * /api/health-card/{token}:
 *   get:
 *     tags: [Health Card]
 *     summary: Public health card scan (HTML or JSON)
 *     description: No authentication. Returns HTML emergency card by default; add `?format=json` for JSON.
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [json]
 *     responses:
 *       200:
 *         description: Health card data (HTML or JSON)
 *         content:
 *           text/html:
 *             schema:
 *               type: string
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   additionalProperties: true
 *       404:
 *         description: Token not found
 *       410:
 *         description: Token expired
 */

module.exports = {};
