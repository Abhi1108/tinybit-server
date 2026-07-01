/**
 * @openapi
 * tags:
 *   - name: Mood Media
 *     description: Mood Lift media tracks and favorites
 *   - name: Admin Mood Media
 *     description: Admin CRUD for the Mood Lift media catalog (bearer is the admin session token from POST /admin/api/login)
 *
 * components:
 *   schemas:
 *     MoodMediaTrack:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         category:
 *           type: string
 *           enum: [bhajans, meditation, jokes_fun, nature_sounds]
 *         media_type:
 *           type: string
 *           enum: [audio, video, youtube]
 *           default: audio
 *           description: How the track is played back — audio (S3 HTTPS url), video (S3 HTTPS url), or youtube (external link/id)
 *         title:
 *           type: string
 *         subtitle:
 *           type: string
 *           nullable: true
 *         duration_seconds:
 *           type: number
 *           nullable: true
 *         duration_label:
 *           type: string
 *           nullable: true
 *         icon_name:
 *           type: string
 *           nullable: true
 *         icon_url:
 *           type: string
 *           nullable: true
 *         audio_url:
 *           type: string
 *           nullable: true
 *           description: HTTPS S3 url. Required when media_type is audio, otherwise null.
 *         media_url:
 *           type: string
 *           nullable: true
 *           description: HTTPS S3 url when media_type is video, or a YouTube URL/11-char video id when media_type is youtube. Null when media_type is audio.
 *         sort_order:
 *           type: number
 *         is_active:
 *           type: boolean
 *         created_at:
 *           type: string
 *           format: date-time
 *         updated_at:
 *           type: string
 *           format: date-time
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
 *                     $ref: '#/components/schemas/MoodMediaTrack'
 *       400:
 *         description: Invalid category
 *
 * /admin/api/mood-media:
 *   get:
 *     tags: [Admin Mood Media]
 *     summary: List mood media tracks (admin)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *           enum: [bhajans, meditation, jokes_fun, nature_sounds]
 *       - in: query
 *         name: active
 *         schema:
 *           type: string
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of tracks
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
 *                     $ref: '#/components/schemas/MoodMediaTrack'
 *   post:
 *     tags: [Admin Mood Media]
 *     summary: Create a mood media track (admin)
 *     description: >
 *       media_type defaults to audio if omitted. audio_url is required (HTTPS) when media_type is
 *       audio. media_url is required when media_type is video (HTTPS S3 url, upload via
 *       POST /admin/api/storage/presign-upload first) or youtube (a youtube.com/watch?v=..., youtu.be/...
 *       url, or a bare 11-character video id).
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [category, title]
 *             properties:
 *               category:
 *                 type: string
 *                 enum: [bhajans, meditation, jokes_fun, nature_sounds]
 *               media_type:
 *                 type: string
 *                 enum: [audio, video, youtube]
 *                 default: audio
 *               title:
 *                 type: string
 *               subtitle:
 *                 type: string
 *               duration_seconds:
 *                 type: number
 *               duration_label:
 *                 type: string
 *               icon_name:
 *                 type: string
 *               icon_url:
 *                 type: string
 *               audio_url:
 *                 type: string
 *                 description: Required (HTTPS) when media_type is audio
 *               media_url:
 *                 type: string
 *                 description: Required when media_type is video (HTTPS) or youtube (url or 11-char id)
 *               sort_order:
 *                 type: number
 *               is_active:
 *                 type: boolean
 *     responses:
 *       201:
 *         description: Track created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 track:
 *                   $ref: '#/components/schemas/MoodMediaTrack'
 *       400:
 *         description: Validation error (invalid category/media_type, or missing/invalid audio_url or media_url for the given media_type)
 *
 * /admin/api/mood-media/{id}:
 *   get:
 *     tags: [Admin Mood Media]
 *     summary: Get a mood media track by id (admin)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Track
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 track:
 *                   $ref: '#/components/schemas/MoodMediaTrack'
 *       404:
 *         description: Track not found
 *   patch:
 *     tags: [Admin Mood Media]
 *     summary: Update a mood media track (admin)
 *     description: >
 *       Partial update. Validation of audio_url/media_url is applied against the effective
 *       media_type (the value in this request if provided, otherwise the existing row's value).
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               category:
 *                 type: string
 *                 enum: [bhajans, meditation, jokes_fun, nature_sounds]
 *               media_type:
 *                 type: string
 *                 enum: [audio, video, youtube]
 *               title:
 *                 type: string
 *               subtitle:
 *                 type: string
 *               duration_seconds:
 *                 type: number
 *               duration_label:
 *                 type: string
 *               icon_name:
 *                 type: string
 *               icon_url:
 *                 type: string
 *               audio_url:
 *                 type: string
 *               media_url:
 *                 type: string
 *               sort_order:
 *                 type: number
 *               is_active:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Track updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 track:
 *                   $ref: '#/components/schemas/MoodMediaTrack'
 *       400:
 *         description: Validation error
 *       404:
 *         description: Track not found
 *   delete:
 *     tags: [Admin Mood Media]
 *     summary: Delete a mood media track (admin)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Track deleted
 *       404:
 *         description: Track not found
 */

module.exports = {};
