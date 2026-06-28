/**
 * @openapi
 * tags:
 *   - name: Mood Media
 *     description: Mood Lift media tracks and favorites
 *
 * /api/mood-media/favorites:
 *   get:
 *     tags: [Mood Media]
 *     summary: List favorite tracks
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Favorite tracks
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 tracks:
 *                   type: array
 *                   items:
 *                     type: object
 *                     additionalProperties: true
 *   post:
 *     tags: [Mood Media]
 *     summary: Add track to favorites
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [track_id]
 *             properties:
 *               track_id:
 *                 type: string
 *               trackId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Favorite added
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 favorite:
 *                   type: object
 *                   additionalProperties: true
 *
 * /api/mood-media/favorites/{trackId}:
 *   delete:
 *     tags: [Mood Media]
 *     summary: Remove track from favorites
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: trackId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Favorite removed
 *       404:
 *         description: Favorite not found
 *
 * /api/mood-media/{category}:
 *   get:
 *     tags: [Mood Media]
 *     summary: List tracks by category
 *     description: Public endpoint. Valid categories — bhajans, meditation, jokes_fun, nature_sounds.
 *     parameters:
 *       - in: path
 *         name: category
 *         required: true
 *         schema:
 *           type: string
 *           enum: [bhajans, meditation, jokes_fun, nature_sounds]
 *     responses:
 *       200:
 *         description: Tracks in category
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 tracks:
 *                   type: array
 *                   items:
 *                     type: object
 *                     additionalProperties: true
 *       400:
 *         description: Invalid category
 */

module.exports = {};
