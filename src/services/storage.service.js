// src/services/storage.service.js
/**
 * Storage service facade
 * 
 * Automatically selects storage implementation based on STORAGE_TYPE env var:
 * 
 * STORAGE_TYPE=filesystem → Local filesystem storage (development)
 * STORAGE_TYPE=s3        → AWS S3 storage (production)
 * 
 * Both implementations export the same API:
 * - createPresignedUpload(params)
 * - createPresignedDownload(params)
 * - deleteFile(key, userId)
 * - getFileStream(key, userId)
 * 
 * This allows the rest of the codebase to work without knowing
 * which storage backend is being used.
 */

const storageType = process.env.STORAGE_TYPE || 'filesystem';

console.log(`[Storage] Using storage type: ${storageType}`);

if (storageType === 's3') {
  // Production: AWS S3
  module.exports = require('./storage-s3.service');
} else {
  // Development: Local filesystem
  module.exports = require('./storage-filesystem.service');
}
