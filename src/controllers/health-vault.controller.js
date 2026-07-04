const healthRecordsService = require('../services/health-records.service');

function isTableMissing(error) {
  return (
    error?.code === '42P01'
    || error?.code === 'PGRST205'
    || error?.code === 'ER_NO_SUCH_TABLE'
    || error?.errno === 1146
  );
}

function readBody(req) {
  return req.body ?? {};
}

function resolveUserId(req) {
  return req.auth?.userId ?? req.supabase?.userId ?? null;
}

function formatRecordDate() {
  return new Date().toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function resolveFileUri(body, fields) {
  const remoteUrl = body.file_url ?? body.fileUrl ?? fields.uri ?? null;
  if (remoteUrl != null && /^https?:\/\//i.test(String(remoteUrl).trim())) {
    return String(remoteUrl).trim();
  }
  return null;
}

function normalizeCreatePayload(body) {
  const {
    user_id: _ignoredUserId,
    id: _ignoredId,
    created_at: _ignoredCreatedAt,
    file_url: _fileUrlSnake,
    fileUrl: _fileUrlCamel,
    mime_type: mimeTypeSnake,
    mimeType: mimeTypeCamel,
    ...fields
  } = body;

  const mime_type = mimeTypeSnake ?? mimeTypeCamel ?? fields.mime_type ?? null;
  const uri = resolveFileUri(body, fields);

  const timestamp = fields.timestamp != null
    ? Number(fields.timestamp)
    : Date.now();

  const size = fields.size ?? '0 MB';

  return {
    title: String(fields.title ?? 'Health Record').trim() || 'Health Record',
    date: String(fields.date ?? formatRecordDate()).trim() || formatRecordDate(),
    timestamp,
    size: String(size),
    type: String(fields.type ?? 'Report').trim() || 'Report',
    category: String(fields.category ?? 'Reports').trim() || 'Reports',
    icon_name: fields.icon_name,
    badge_bg: fields.badge_bg,
    badge_color: fields.badge_color,
    uri,
    mime_type,
    ai_read: fields.ai_read,
  };
}

/** GET /api/health-vault/records */
async function listRecords(req, res) {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const records = await healthRecordsService.listByUser(userId);

    return res.json({ success: true, records });
  } catch (err) {
    console.error('[health-vault] list', err);
    if (isTableMissing(err)) {
      return res.status(501).json({
        success: false,
        message: 'health_records table is not deployed.',
      });
    }
    return res.status(500).json({
      success: false,
      message: err.message || 'Could not load health records.',
    });
  }
}

/** POST /api/health-vault/records */
async function createRecord(req, res) {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const body = readBody(req);
    const payload = normalizeCreatePayload(body);

    if (!payload.title) {
      return res.status(400).json({ success: false, message: 'Record title is required.' });
    }

    if (!payload.uri || !/^https?:\/\//i.test(payload.uri)) {
      return res.status(400).json({
        success: false,
        message: 'file_url is required. Upload the file via POST /api/storage/presign-upload first.',
      });
    }

    const record = await healthRecordsService.create(userId, payload);

    return res.json({ success: true, record });
  } catch (err) {
    console.error('[health-vault] create', err);
    if (isTableMissing(err)) {
      return res.status(501).json({
        success: false,
        message: 'health_records table is not deployed.',
      });
    }
    if (err?.code === 'ER_CHECK_CONSTRAINT_VIOLATED' || err?.errno === 3819) {
      return res.status(400).json({
        success: false,
        message: 'Invalid health record category.',
      });
    }
    return res.status(500).json({
      success: false,
      message: err.message || 'Could not save health record.',
    });
  }
}

/** DELETE /api/health-vault/records/:id */
async function deleteRecord(req, res) {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const deleted = await healthRecordsService.deleteById(userId, req.params.id);

    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Health record not found.' });
    }

    return res.json({ success: true, id: deleted.id });
  } catch (err) {
    console.error('[health-vault] delete', err);
    if (isTableMissing(err)) {
      return res.status(501).json({
        success: false,
        message: 'health_records table is not deployed.',
      });
    }
    return res.status(500).json({
      success: false,
      message: err.message || 'Could not delete health record.',
    });
  }
}

module.exports = {
  listRecords,
  createRecord,
  deleteRecord,
};
