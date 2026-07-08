const crypto = require('crypto');
const path = require('path');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const {
  getBucket,
  getRegion,
  isStorageConfigured,
  buildPublicUrl,
} = require('../config/storage');

const VALID_PURPOSES = new Set(['health-vault', 'journal', 'profile', 'catalog', 'calorie-tracker', 'family-message']);

const PRESIGN_UPLOAD_TTL_SECONDS = 15 * 60;
const PRESIGN_DOWNLOAD_TTL_SECONDS = 15 * 60;

const EXT_MIME = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  pdf: 'application/pdf',
  m4a: 'audio/m4a',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  wav: 'audio/wav',
  aac: 'audio/aac',
};

let s3Client = null;

function storageNotConfiguredError() {
  const err = new Error('S3 storage is not configured. Set S3_BUCKET in server environment.');
  err.code = 'STORAGE_NOT_CONFIGURED';
  return err;
}

function assertStorageConfigured() {
  if (!isStorageConfigured()) {
    throw storageNotConfiguredError();
  }
}

function getS3Client() {
  assertStorageConfigured();
  if (!s3Client) {
    s3Client = new S3Client({ region: getRegion() });
  }
  return s3Client;
}

function sanitizeFilename(name) {
  const base = path.basename(String(name || 'file').trim()) || 'file';
  const cleaned = base.replace(/[^\w.\-() ]+/g, '_').replace(/\s+/g, '_');
  return cleaned.slice(0, 120) || 'file';
}

function extensionFromFilename(filename) {
  const ext = path.extname(filename).replace(/^\./, '').toLowerCase();
  return ext || 'bin';
}

function guessContentType(filename, contentType) {
  const explicit = String(contentType || '').trim();
  if (explicit) return explicit;
  const ext = extensionFromFilename(filename);
  return EXT_MIME[ext] || 'application/octet-stream';
}

function validatePurpose(purpose) {
  const value = String(purpose || '').trim();
  if (!VALID_PURPOSES.has(value)) {
    const err = new Error(`Invalid purpose. Must be one of: ${[...VALID_PURPOSES].join(', ')}`);
    err.code = 'INVALID_PURPOSE';
    throw err;
  }
  return value;
}

function buildObjectKey(purpose, userId, filename) {
  const validPurpose = validatePurpose(purpose);
  const safeUserId = String(userId || '').trim();
  if (!safeUserId) {
    const err = new Error('User id is required.');
    err.code = 'INVALID_USER';
    throw err;
  }

  const safeName = sanitizeFilename(filename);
  const ext = extensionFromFilename(safeName);
  const uuid = crypto.randomUUID();
  return `${validPurpose}/${safeUserId}/${uuid}.${ext}`;
}

function assertKeyReadable(key, userId) {
  const objectKey = String(key || '').trim();
  const safeUserId = String(userId || '').trim();
  if (!objectKey || !safeUserId) {
    const err = new Error('Object key and user id are required.');
    err.code = 'INVALID_KEY';
    throw err;
  }

  const segments = objectKey.split('/');
  if (segments.length < 3) {
    const err = new Error('Invalid object key.');
    err.code = 'INVALID_KEY';
    throw err;
  }

  const [purpose, ownerId] = segments;
  if (!VALID_PURPOSES.has(purpose)) {
    const err = new Error('Invalid object key.');
    err.code = 'INVALID_KEY';
    throw err;
  }

  if (purpose === 'catalog') {
    return objectKey;
  }

  if (ownerId !== safeUserId) {
    const err = new Error('You do not have access to this object.');
    err.code = 'FORBIDDEN_KEY';
    throw err;
  }

  return objectKey;
}

function assertKeyOwnedByUser(key, userId) {
  return assertKeyReadable(key, userId);
}

async function createPresignedUpload({ purpose, userId, filename, contentType }) {
  assertStorageConfigured();

  const key = buildObjectKey(purpose, userId, filename);
  const resolvedContentType = guessContentType(filename, contentType);
  const client = getS3Client();

  const command = new PutObjectCommand({
    Bucket: getBucket(),
    Key: key,
    ContentType: resolvedContentType,
  });

  const uploadUrl = await getSignedUrl(client, command, {
    expiresIn: PRESIGN_UPLOAD_TTL_SECONDS,
  });

  return {
    uploadUrl,
    key,
    fileUrl: buildPublicUrl(key),
    contentType: resolvedContentType,
    expiresIn: PRESIGN_UPLOAD_TTL_SECONDS,
  };
}

async function createPresignedDownload({ key, userId }) {
  assertStorageConfigured();

  const objectKey = assertKeyReadable(key, userId);
  const client = getS3Client();

  const command = new GetObjectCommand({
    Bucket: getBucket(),
    Key: objectKey,
  });

  const downloadUrl = await getSignedUrl(client, command, {
    expiresIn: PRESIGN_DOWNLOAD_TTL_SECONDS,
  });

  return {
    downloadUrl,
    key: objectKey,
    expiresIn: PRESIGN_DOWNLOAD_TTL_SECONDS,
  };
}

async function deleteObject(key, userId) {
  assertStorageConfigured();

  const objectKey = assertKeyOwnedByUser(key, userId);
  const client = getS3Client();

  await client.send(new DeleteObjectCommand({
    Bucket: getBucket(),
    Key: objectKey,
  }));

  return { key: objectKey };
}

/** Extract the S3 object key from a stored virtual-host/CDN URL, or null if unparseable. */
function extractObjectKey(url) {
  try {
    const key = new URL(String(url || '')).pathname.replace(/^\//, '');
    return key ? decodeURIComponent(key) : null;
  } catch {
    return null;
  }
}

/**
 * Best-effort delete of a stored media URL — resolves the S3 key, validates it looks
 * like one of ours, and deletes it. Never throws: a failed/skipped S3 cleanup should
 * never block the caller's own DB delete. Returns true only if an object was actually
 * deleted. `actorId` just needs to be a truthy id — required by the ownership check,
 * but bypassed entirely for `catalog/...` keys (admin-owned, not user-owned).
 */
async function deleteObjectByUrl(url, actorId) {
  if (!url || !isStorageConfigured()) return false;

  const key = extractObjectKey(url);
  const segments = key ? key.split('/') : [];
  if (segments.length < 3 || !VALID_PURPOSES.has(segments[0])) return false;

  try {
    await deleteObject(key, actorId);
    return true;
  } catch (err) {
    console.warn('[storage] deleteObjectByUrl failed:', err.message);
    return false;
  }
}

/** Download an object's bytes and return them base64-encoded, for feeding to Gemini inlineData. */
async function getObjectBase64(key) {
  assertStorageConfigured();

  const client = getS3Client();
  const response = await client.send(new GetObjectCommand({
    Bucket: getBucket(),
    Key: key,
  }));

  const chunks = [];
  for await (const chunk of response.Body) {
    chunks.push(chunk);
  }

  return {
    base64: Buffer.concat(chunks).toString('base64'),
    contentType: response.ContentType || null,
  };
}

module.exports = {
  VALID_PURPOSES,
  sanitizeFilename,
  buildObjectKey,
  assertKeyOwnedByUser,
  assertKeyReadable,
  createPresignedUpload,
  createPresignedDownload,
  deleteObject,
  deleteObjectByUrl,
  extractObjectKey,
  getObjectBase64,
  guessContentType,
  storageNotConfiguredError,
};
