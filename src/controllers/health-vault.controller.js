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

function formatFileSize(bytes) {
  if (!bytes || bytes <= 0) return '0 MB';
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function buildDataUri(base64, mimeType) {
  const clean = String(base64).replace(/^data:[^;]+;base64,/, '');
  const mime = String(mimeType || 'application/octet-stream').trim();
  return `data:${mime};base64,${clean}`;
}

function normalizeCreatePayload(body) {
  const {
    user_id: _ignoredUserId,
    id: _ignoredId,
    created_at: _ignoredCreatedAt,
    base64,
    mime_type: mimeTypeSnake,
    mimeType: mimeTypeCamel,
    ...fields
  } = body;

  const mime_type = mimeTypeSnake ?? mimeTypeCamel ?? fields.mime_type ?? null;
  let uri = fields.uri ?? null;

  if (base64) {
    uri = buildDataUri(base64, mime_type);
  }

  const timestamp = fields.timestamp != null
    ? Number(fields.timestamp)
    : Date.now();

  const size = fields.size
    ?? (base64 ? formatFileSize(Math.floor(String(base64).length * 0.75)) : '0 MB');

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
