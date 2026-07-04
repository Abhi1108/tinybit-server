/**
 * @openapi
 * tags:
 *   - name: Location
 *     description: Elder location sharing
 *
 * /api/location:
 *   get:
 *     tags: [Location]
 *     summary: Get own location record
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
 *                 location:
 *                   type: object
 *                   nullable: true
 *                   additionalProperties: true
 *   put:
 *     tags: [Location]
 *     summary: Upsert elder location
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [latitude, longitude]
 *             properties:
 *               latitude:
 *                 type: number
 *               longitude:
 *                 type: number
 *               accuracy:
 *                 type: number
 *               address:
 *                 type: string
 *               is_sharing:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Location saved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 location:
 *                   type: object
 *                   additionalProperties: true
 *       400:
 *         description: latitude and longitude required
 */

module.exports = {};
