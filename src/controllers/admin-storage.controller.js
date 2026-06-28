const storageService = require('../services/storage.service');

function mapStorageError(err, res) {
  if (err?.code === 'STORAGE_NOT_CONFIGURED') {
    return res.status(503).json({ success: false, error: err.message });
  }
  if (err?.code === 'INVALID_KEY') {
    return res.status(400).json({ success: false, error: err.message });
  }
  return null;
}

/** POST /admin/api/storage/presign-upload — catalog media for doctors / mood tracks */
async function presignCatalogUpload(req, res) {
  try {
    const body = req.body ?? {};
    const filename = body.filename ?? body.file_name ?? body.fileName;
    const contentType = body.content_type ?? body.contentType ?? body.mime_type ?? body.mimeType;

    if (!filename || !String(filename).trim()) {
      return res.status(400).json({ success: false, error: 'filename is required.' });
    }

    const result = await storageService.createPresignedUpload({
      purpose: 'catalog',
      userId: 'admin',
      filename: String(filename).trim(),
      contentType,
    });

    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('[admin/storage] presign-upload', err);
    const mapped = mapStorageError(err, res);
    if (mapped) return mapped;
    return res.status(500).json({
      success: false,
      error: err.message || 'Could not create upload URL.',
    });
  }
}

module.exports = {
  presignCatalogUpload,
};
