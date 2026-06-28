/**
 * @openapi
 * tags:
 *   - name: Storage
 *     description: S3 presigned upload and download
 *
 * /api/storage/presign-upload:
 *   post:
 *     tags: [Storage]
 *     summary: Get a presigned S3 PUT URL for direct client upload
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [purpose, filename]
 *             properties:
 *               purpose:
 *                 type: string
 *                 enum: [health-vault, journal, profile, catalog]
 *               filename:
 *                 type: string
 *                 example: report.pdf
 *               content_type:
 *                 type: string
 *                 example: application/pdf
 *     responses:
 *       200:
 *         description: Presigned upload URL and stored file URL
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 uploadUrl:
 *                   type: string
 *                 key:
 *                   type: string
 *                 fileUrl:
 *                   type: string
 *                 contentType:
 *                   type: string
 *                 expiresIn:
 *                   type: integer
 *       503:
 *         description: S3 not configured
 *
 * /api/storage/presign-download:
 *   post:
 *     tags: [Storage]
 *     summary: Get a presigned S3 GET URL for a private object
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [key]
 *             properties:
 *               key:
 *                 type: string
 *                 example: health-vault/user-uuid/file-uuid.pdf
 *     responses:
 *       200:
 *         description: Presigned download URL
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 downloadUrl:
 *                   type: string
 *                 key:
 *                   type: string
 *                 expiresIn:
 *                   type: integer
 *       403:
 *         description: Key not owned by user
 *       503:
 *         description: S3 not configured
 */
