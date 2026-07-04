/**
 * @openapi
 * tags:
 *   - name: Health
 *     description: Server and database health check
 *
 * /api/health:
 *   get:
 *     tags: [Health]
 *     summary: API health check
 *     description: Returns server status and MySQL connectivity ping. No authentication required.
 *     responses:
 *       200:
 *         description: Server is running
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 *                 message:
 *                   type: string
 *                   example: TinyBit API is running
 *                 db:
 *                   type: string
 *                   example: mysql
 *                 dbOk:
 *                   type: boolean
 */

module.exports = {};
