// src/services/storage-filesystem.service.js
/**
 * Filesystem-based storage service for local development
 * 
 * This implementation stores files in ./uploads/ directory
 * Useful for local testing without AWS S3
 * 
 * For production, use storage-s3.service.js instead
 * Switch via STORAGE_TYPE environment variable in .env
 * 
 * API Contract (same as S3):
 * - createPresignedUpload() → { key, uploadUrl, fileUrl }
 * - createPresignedDownload() → download URL
 * - deleteFile()
 * - getFileStream()
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UPLOADS_DIR = path.join(process.cwd(), 'uploads');
const BASE_URL = process.env.STORAGE_BASE_URL || 'http://localhost:5000/api';

const VALID_PURPOSES = new Set([
  'health-vault',
  'journal',
  'profile',
  'catalog',
  'calorie-tracker'
]);

/**
 * Ensure uploads directory exists
 * Called on server startup
 */
function ensureUploadsDir() {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    console.log(`[Storage] Created uploads directory: ${UPLOADS_DIR}`);
  }
}

/**
 * Build storage key: {purpose}/{userId}/{uuid}.{ext}
 * Example: health-vault/user-123/abc-def-ghi.pdf
 */
function buildObjectKey(purpose, userId, filename) {
  const ext = path.extname(filename) || '.bin';
  const uuid = crypto.randomUUID();
  return `${purpose}/${userId}/${uuid}${ext}`;
}

/**
 * Build file URL from storage key
 * Returns: ${BASE_URL}/files/health-vault/user-123/uuid.pdf
 */
function buildFileUrl(key) {
  return `${BASE_URL}/storage/files/${key}`;
}

/**
 * Get physical filesystem path for a storage key
 */
function getPhysicalPath(key) {
  return path.join(UPLOADS_DIR, key);
}

/**
 * Validate that user owns this file
 * Prevents user A from accessing user B's files
 */
function assertKeyReadable(key, userId) {
  const segments = key.split('/');
  
  if (segments.length < 3) {
    const err = new Error('Invalid file key');
    err.code = 'INVALID_KEY';
    throw err;
  }

  const [purpose] = segments;

  if (!VALID_PURPOSES.has(purpose)) {
    const err = new Error('Invalid purpose');
    err.code = 'INVALID_PURPOSE';
    throw err;
  }

  // Catalog files are admin-owned, publicly readable
  if (purpose === 'catalog') {
    return key;
  }

  // User files: verify ownership
  const ownerId = segments[1];
  if (ownerId !== userId) {
    const err = new Error('You do not own this file');
    err.code = 'FORBIDDEN_KEY';
    err.statusCode = 403;
    throw err;
  }

  return key;
}

/**
 * Create presigned upload URL
 * 
 * Returns: { key, uploadUrl, fileUrl }
 */
async function createPresignedUpload({ purpose, userId, filename, contentType }) {
  const purposeVal = String(purpose || '').trim();
  
  if (!VALID_PURPOSES.has(purposeVal)) {
    const err = new Error(
      `Invalid purpose. Must be one of: ${[...VALID_PURPOSES].join(', ')}`
    );
    err.code = 'INVALID_PURPOSE';
    throw err;
  }

  const key = buildObjectKey(purposeVal, userId, filename);
  const fileUrl = buildFileUrl(key);

  return {
    key,
    uploadUrl: buildFileUrl(key),
    fileUrl
  };
}

/**
 * Create presigned download URL
 * For filesystem, just return the direct file URL
 */
async function createPresignedDownload({ key, userId }) {
  assertKeyReadable(key, userId);
  return {
    downloadUrl: buildFileUrl(key),
    key,
    expiresIn: 900  // Same as S3
  };
}

/**
 * Delete file from storage
 */
function deleteFile(key, userId) {
  assertKeyReadable(key, userId);
  const filePath = getPhysicalPath(key);
  
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

/**
 * Get readable stream for file download
 */
function getFileStream(key, userId) {
  assertKeyReadable(key, userId);

  const filePath = getPhysicalPath(key);

  if (!fs.existsSync(filePath)) {
    const err = new Error('File not found');
    err.code = 'ENOENT';
    throw err;
  }

  return fs.createReadStream(filePath);
}

/**
 * Extract the storage object key from a stored file URL, or null if unparseable.
 * Filesystem URLs look like `${BASE_URL}/storage/files/{key}`, so we strip the
 * `/storage/files/` prefix to recover the key. Falls back to the leading-slash
 * strip (S3 virtual-host style) so keys stored by the S3 backend still resolve.
 */
function extractObjectKey(url) {
  try {
    const pathname = new URL(String(url || '')).pathname;
    const marker = '/storage/files/';
    const idx = pathname.indexOf(marker);
    const raw = idx >= 0
      ? pathname.slice(idx + marker.length)
      : pathname.replace(/^\//, '');
    return raw ? decodeURIComponent(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Read an object's bytes and return them base64-encoded, for feeding to Gemini
 * inlineData. Mirrors the S3 backend's getObjectBase64 contract.
 */
async function getObjectBase64(key) {
  const filePath = getPhysicalPath(key);

  if (!fs.existsSync(filePath)) {
    const err = new Error('File not found');
    err.code = 'ENOENT';
    throw err;
  }

  const buffer = await fs.promises.readFile(filePath);
  return {
    base64: buffer.toString('base64'),
    contentType: null,
  };
}

module.exports = {
  ensureUploadsDir,
  buildObjectKey,
  buildFileUrl,
  assertKeyReadable,
  getPhysicalPath,
  createPresignedUpload,
  createPresignedDownload,
  deleteFile,
  getFileStream,
  extractObjectKey,
  getObjectBase64
};
