const storageService = require('../services/storage.service');

function readBody(req) {
  return req.body ?? {};
}

function resolveUserId(req) {
  return req.auth?.userId ?? req.supabase?.userId ?? null;
}

function mapStorageError(err, res) {
  if (err?.code === 'STORAGE_NOT_CONFIGURED') {
    return res.status(503).json({ success: false, message: err.message });
  }
  if (err?.code === 'INVALID_PURPOSE' || err?.code === 'INVALID_KEY') {
    return res.status(400).json({ success: false, message: err.message });
  }
  if (err?.code === 'FORBIDDEN_KEY') {
    return res.status(403).json({ success: false, message: err.message });
  }
  return null;
}

/** POST /api/storage/presign-upload */
async function presignUpload(req, res) {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const body = readBody(req);
    const purpose = body.purpose;
    const filename = body.filename ?? body.file_name ?? body.fileName;
    const contentType = body.content_type ?? body.contentType ?? body.mime_type ?? body.mimeType;

    if (!filename || !String(filename).trim()) {
      return res.status(400).json({ success: false, message: 'filename is required.' });
    }

    const result = await storageService.createPresignedUpload({
      purpose,
      userId,
      filename: String(filename).trim(),
      contentType,
    });

    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('[storage] presign-upload', err);
    const mapped = mapStorageError(err, res);
    if (mapped) return mapped;
    return res.status(500).json({
      success: false,
      message: err.message || 'Could not create upload URL.',
    });
  }
}

/** POST /api/storage/presign-download */
async function presignDownload(req, res) {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const body = readBody(req);
    const key = body.key ?? req.query?.key;

    if (!key || !String(key).trim()) {
      return res.status(400).json({ success: false, message: 'key is required.' });
    }

    const result = await storageService.createPresignedDownload({
      key: String(key).trim(),
      userId,
    });

    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('[storage] presign-download', err);
    const mapped = mapStorageError(err, res);
    if (mapped) return mapped;
    return res.status(500).json({
      success: false,
      message: err.message || 'Could not create download URL.',
    });
  }
}

module.exports = {
  presignUpload,
  presignDownload,
};
