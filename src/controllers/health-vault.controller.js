const healthRecordsService = require('../services/health-records.service');
const savedDoctorsService = require('../services/saved-doctors.service');
const healthInsightsService = require('../services/health-insights.service');
const storageService = require('../services/storage.service');
const { notifyGuardiansOfElder } = require('../services/notifications.service');
const { NOTIFICATION_TYPES } = require('../constants/notification-types');

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
  return req.auth?.userId ?? null;
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

/** GET /api/health-vault/records?category=&date_range= */
async function listRecords(req, res) {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { category, date_range: dateRange } = req.query ?? {};
    const records = await healthRecordsService.listByUser(userId, { category, dateRange });

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

    try {
      await notifyGuardiansOfElder(userId, {
        type: NOTIFICATION_TYPES.REPORT_UPLOADED,
        title: 'Report Uploaded',
        body: 'The user has uploaded a new health report.',
        data: { type: NOTIFICATION_TYPES.REPORT_UPLOADED, elderId: userId },
      });
    } catch (notifyErr) {
      console.warn('[health-vault/create] guardian notify failed:', notifyErr.message);
    }

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

/** PATCH /api/health-vault/records/:id */
async function updateRecord(req, res) {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const body = readBody(req);
    const patch = {};

    if (body.title !== undefined) {
      const title = String(body.title).trim();
      if (!title) {
        return res.status(400).json({ success: false, message: 'Record title cannot be empty.' });
      }
      patch.title = title;
    }

    if (body.category !== undefined) {
      const category = String(body.category).trim();
      if (!category) {
        return res.status(400).json({ success: false, message: 'Record category cannot be empty.' });
      }
      patch.category = category;
    }

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ success: false, message: 'Nothing to update.' });
    }

    const updated = await healthRecordsService.updateById(userId, req.params.id, patch);
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Health record not found.' });
    }

    return res.json({ success: true, record: updated });
  } catch (err) {
    console.error('[health-vault] update', err);
    if (isTableMissing(err)) {
      return res.status(501).json({ success: false, message: 'health_records table is not deployed.' });
    }
    if (err?.code === 'ER_CHECK_CONSTRAINT_VIOLATED' || err?.errno === 3819) {
      return res.status(400).json({ success: false, message: 'Invalid health record category.' });
    }
    return res.status(500).json({ success: false, message: err.message || 'Could not update health record.' });
  }
}

/** Downloads a saved record's file from S3 and returns it base64-encoded, or null if unavailable. */
async function loadRecordBase64(record) {
  if (!record.uri) return null;
  const key = storageService.extractObjectKey(record.uri);
  if (!key) return null;
  const { base64 } = await storageService.getObjectBase64(key);
  return base64;
}

/** POST /api/health-vault/records/:id/insights?refresh=true */
async function getInsights(req, res) {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const record = await healthRecordsService.getById(userId, req.params.id);
    if (!record) {
      return res.status(404).json({ success: false, message: 'Health record not found.' });
    }

    const forceRefresh = String(req.query?.refresh || '').toLowerCase() === 'true';
    if (!forceRefresh && record.ai_insights) {
      return res.json({ success: true, data: record.ai_insights, cached: true, computed_at: record.ai_insights_at });
    }

    const base64 = await loadRecordBase64(record);
    if (!base64) {
      return res.status(400).json({ success: false, message: 'This record has no stored file to analyze.' });
    }

    const insights = await healthInsightsService.runHealthForecast({
      base64,
      mimeType: record.mime_type || 'image/jpeg',
      category: record.category,
      title: record.title,
    });

    const updated = await healthRecordsService.saveInsights(userId, record.id, insights);
    return res.json({
      success: true,
      data: insights,
      cached: false,
      computed_at: updated?.ai_insights_at ?? null,
    });
  } catch (err) {
    console.error('[health-vault] insights', err);
    return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Could not analyze this record.' });
  }
}

/** POST /api/health-vault/compare — body: { recordIds: string[] } (2+) */
async function compareRecords(req, res) {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { recordIds } = readBody(req);
    if (!Array.isArray(recordIds) || recordIds.length < 2) {
      return res.status(400).json({ success: false, message: 'Select at least 2 records to compare.' });
    }

    const records = [];
    for (const id of recordIds) {
      const record = await healthRecordsService.getById(userId, id);
      if (!record) {
        return res.status(404).json({ success: false, message: `Health record ${id} not found.` });
      }
      records.push(record);
    }

    const documents = [];
    for (const record of records) {
      let base64 = null;
      try {
        base64 = await loadRecordBase64(record);
      } catch (err) {
        console.warn(`[health-vault] compare: failed to load record ${record.id}`, err.message);
      }
      if (!base64) continue;
      documents.push({
        base64,
        mimeType: record.mime_type || 'image/jpeg',
        category:  record.category,
        title:     record.title,
        date:      record.date,
      });
    }

    const insights = await healthInsightsService.runMultiHealthForecast(documents);
    return res.json({ success: true, data: insights });
  } catch (err) {
    console.error('[health-vault] compare', err);
    return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Could not compare these records.' });
  }
}

/** GET /api/health-vault/doctors */
async function listDoctors(req, res) {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const doctors = await savedDoctorsService.listByUser(userId);
    return res.json({ success: true, doctors });
  } catch (err) {
    console.error('[health-vault] listDoctors', err);
    if (isTableMissing(err)) {
      return res.status(501).json({ success: false, message: 'saved_doctors table is not deployed.' });
    }
    return res.status(500).json({ success: false, message: err.message || 'Could not load your doctors.' });
  }
}

/** POST /api/health-vault/doctors */
async function createDoctor(req, res) {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const body = readBody(req);
    const doctor = await savedDoctorsService.create(userId, { name: body.name, phone: body.phone });
    return res.json({ success: true, doctor });
  } catch (err) {
    console.error('[health-vault] createDoctor', err);
    if (isTableMissing(err)) {
      return res.status(501).json({ success: false, message: 'saved_doctors table is not deployed.' });
    }
    return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Could not add doctor.' });
  }
}

/** DELETE /api/health-vault/doctors/:id */
async function deleteDoctor(req, res) {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const deleted = await savedDoctorsService.deleteById(userId, req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Doctor not found.' });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('[health-vault] deleteDoctor', err);
    return res.status(500).json({ success: false, message: err.message || 'Could not delete doctor.' });
  }
}

module.exports = {
  normalizeCreatePayload,
  loadRecordBase64,
  listRecords,
  createRecord,
  updateRecord,
  deleteRecord,
  getInsights,
  compareRecords,
  listDoctors,
  createDoctor,
  deleteDoctor,
};
