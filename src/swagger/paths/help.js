/**
 * @openapi
 * tags:
 *   - name: Help & Guide
 *     description: Tutorial videos and FAQ content (admin-managed catalog)
 *
 * /api/help/tutorials:
 *   get:
 *     tags: [Help & Guide]
 *     summary: List active tutorials
 *     parameters:
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *           description: Optional snake_case category slug (dynamic; not a fixed enum)
 *     responses:
 *       200:
 *         description: Active tutorials
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 tutorials:
 *                   type: array
 *                   items:
 *                     type: object
 *                     additionalProperties: true
 *
 * /api/help/faqs:
 *   get:
 *     tags: [Help & Guide]
 *     summary: List active FAQs
 *     responses:
 *       200:
 *         description: Active FAQs
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 faqs:
 *                   type: array
 *                   items:
 *                     type: object
 *                     additionalProperties: true
 */

module.exports = {};
