// src/routes/storage.routes.js
/**
 * Storage routes - handles file upload/download
 * 
 * Supports multiple storage backends:
 * - Local filesystem (STORAGE_TYPE=filesystem) - for development
 * - AWS S3 (STORAGE_TYPE=s3) - for production
 * 
 * The storage service automatically chooses implementation based on .env
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { requireJwtAuth } = require('../middleware/jwtAuth.middleware');
const { presignUpload, presignDownload } = require('../controllers/storage.controller');
const storageFs = require('../services/storage-filesystem.service');

// ─────────────────────────────────────────────────────────────────────────
// Presigned URL endpoints (work for both S3 and filesystem)
// ─────────────────────────────────────────────────────────────────────────

router.post('/presign-upload', requireJwtAuth, presignUpload);
router.post('/presign-download', requireJwtAuth, presignDownload);

// ─────────────────────────────────────────────────────────────────────────
// File upload endpoint (PUT /api/files/{purpose}/{userId}/*)
// Only used when STORAGE_TYPE=filesystem
// ─────────────────────────────────────────────────────────────────────────

// File upload endpoint (PUT /api/files/{purpose}/{userId}/*)
// Works with presigned URLs (no auth needed - URL itself is authorization)
router.put('/files/:purpose/:userId/*', async (req, res) => {
  try {
    const { purpose, userId } = req.params;
    const filename = req.params[0];
    const requestUserId = req.auth?.userId;

    const key = `${purpose}/${userId}/${filename}`;

    // For presigned URLs without auth, validate key structure only
    // For authenticated requests, also validate ownership
    if (requestUserId) {
      // Auth present: full validation
      storageFs.assertKeyReadable(key, requestUserId);
    } else {
      // No auth (presigned URL): validate key format only
      const segments = key.split('/');
      if (segments.length < 3) {
        return res.status(400).json({ success: false, message: 'Invalid file key' });
      }
      // Key structure is valid - presigned URL grants access
    }

    const filePath = storageFs.getPhysicalPath(key);
    const dirPath = path.dirname(filePath);

    // Create directory structure if needed
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }

    const writeStream = fs.createWriteStream(filePath);

    // Handle client disconnect during upload
    req.on('error', (err) => {
      console.error('[storage] upload stream error:', err);
      writeStream.destroy();
      res.status(500).json({ success: false, message: 'Upload failed' });
    });

    // Handle successful upload
    writeStream.on('finish', () => {
      const fileUrl = storageFs.buildFileUrl(key);
      res.json({
        success: true,
        key,
        file_url: fileUrl
      });
    });

    // Handle write errors
    writeStream.on('error', (err) => {
      console.error('[storage] write error:', err);
      res.status(500).json({ success: false, message: 'Upload failed' });
    });

    // Pipe request body to file
    req.pipe(writeStream);
  } catch (err) {
    console.error('[storage] file upload:', err);
    if (err.code === 'FORBIDDEN_KEY') {
      return res.status(403).json({ success: false, message: err.message });
    }
    res.status(500).json({ success: false, message: err.message });
  }
});


// ─────────────────────────────────────────────────────────────────────────
// File download endpoint (GET /api/files/{purpose}/{userId}/*)
// Only used when STORAGE_TYPE=filesystem
// ─────────────────────────────────────────────────────────────────────────

// File download endpoint (GET /api/files/{purpose}/{userId}/*)
// Works with presigned URLs (no auth needed)
router.get('/files/:purpose/:userId/*', async (req, res) => {
  try {
    const { purpose, userId } = req.params;
    const filename = req.params[0];
    const requestUserId = req.auth?.userId;

    const key = `${purpose}/${userId}/${filename}`;

    // For presigned URLs without auth, validate key structure only
    if (requestUserId) {
      // Auth present: validate ownership
      if (purpose !== 'catalog' && requestUserId !== userId) {
        return res.status(403).json({ success: false, message: 'Forbidden' });
      }
      storageFs.assertKeyReadable(key, requestUserId);
    } else {
      // No auth (presigned URL): validate key format only
      const segments = key.split('/');
      if (segments.length < 3) {
        return res.status(403).json({ success: false, message: 'Invalid file key' });
      }
      // Key structure is valid - presigned URL grants access
    }

    const fileStream = storageFs.getFileStream(key, userId);

    // Set appropriate Content-Type header
    const ext = path.extname(filename).toLowerCase();
    const mimeTypes = {
      '.pdf': 'application/pdf',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.m4a': 'audio/mp4',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.mp4': 'video/mp4',
      '.webp': 'image/webp'
    };

    const contentType = mimeTypes[ext] || 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);

    // Stream file to client
    fileStream.pipe(res);

    fileStream.on('error', (err) => {
      if (err.code === 'ENOENT') {
        res.status(404).json({ success: false, message: 'File not found' });
      } else {
        res.status(500).json({ success: false, message: 'Download failed' });
      }
    });
  } catch (err) {
    console.error('[storage] file download:', err);
    if (err.code === 'FORBIDDEN_KEY') {
      return res.status(403).json({ success: false, message: err.message });
    }
    res.status(500).json({ success: false, message: err.message });
  }
});


module.exports = router;
