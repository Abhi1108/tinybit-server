const medicinesService = require('../services/medicines.service');

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

/** GET /api/medicines */
async function listMedicines(req, res) {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const activeOnly = String(req.query.active ?? 'true').toLowerCase() !== 'false';
    const medicines = await medicinesService.listByUser(userId, { activeOnly });

    return res.json({ success: true, medicines });
  } catch (err) {
    console.error('[medicines] list', err);
    if (isTableMissing(err)) {
      return res.status(501).json({
        success: false,
        message: 'medicines table is not deployed.',
      });
    }
    return res.status(500).json({
      success: false,
      message: err.message || 'Could not load medicines.',
    });
  }
}

/** GET /api/medicines/:id */
async function getMedicine(req, res) {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const medicine = await medicinesService.getById(userId, req.params.id);

    if (!medicine) {
      return res.status(404).json({ success: false, message: 'Medicine not found.' });
    }

    return res.json({ success: true, medicine });
  } catch (err) {
    console.error('[medicines] get', err);
    if (isTableMissing(err)) {
      return res.status(501).json({ success: false, message: 'medicines table is not deployed.' });
    }
    return res.status(500).json({
      success: false,
      message: err.message || 'Could not load medicine.',
    });
  }
}

/** POST /api/medicines — body: single row or { medicines: [...] } */
async function createMedicines(req, res) {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const body = readBody(req);
    const rawRows = Array.isArray(body.medicines) ? body.medicines : [body];

    if (rawRows.length === 0 || !rawRows[0]?.name?.trim()) {
      return res.status(400).json({ success: false, message: 'Medicine name is required.' });
    }

    const medicines = await medicinesService.create(userId, rawRows);

    return res.json({ success: true, medicines });
  } catch (err) {
    console.error('[medicines] create', err);
    if (isTableMissing(err)) {
      return res.status(501).json({ success: false, message: 'medicines table is not deployed.' });
    }
    return res.status(500).json({
      success: false,
      message: err.message || 'Could not save medicine.',
    });
  }
}

/** PATCH /api/medicines/:id */
async function updateMedicine(req, res) {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const body = readBody(req);
    const {
      user_id: _ignoredUserId,
      id: _ignoredId,
      created_at: _ignoredCreatedAt,
      updated_at: _ignoredUpdatedAt,
      ...patch
    } = body;

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update.' });
    }

    const medicine = await medicinesService.update(userId, req.params.id, patch);

    if (!medicine) {
      return res.status(404).json({ success: false, message: 'Medicine not found.' });
    }

    return res.json({ success: true, medicine });
  } catch (err) {
    console.error('[medicines] update', err);
    if (isTableMissing(err)) {
      return res.status(501).json({ success: false, message: 'medicines table is not deployed.' });
    }
    return res.status(500).json({
      success: false,
      message: err.message || 'Could not update medicine.',
    });
  }
}

/** DELETE /api/medicines/:id */
async function deleteMedicine(req, res) {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const deleted = await medicinesService.delete(userId, req.params.id);

    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Medicine not found.' });
    }

    return res.json({ success: true, id: deleted.id });
  } catch (err) {
    console.error('[medicines] delete', err);
    if (isTableMissing(err)) {
      return res.status(501).json({ success: false, message: 'medicines table is not deployed.' });
    }
    return res.status(500).json({
      success: false,
      message: err.message || 'Could not delete medicine.',
    });
  }
}

/** GET /api/medicines/logs — ?scope=day|week or ?from=&to= ISO */
async function listMedicineLogs(req, res) {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const medicineLogsService = require('../services/medicine-logs.service');
    const scope = String(req.query.scope ?? 'day').toLowerCase();

    let logs;
    if (scope === 'week') {
      logs = await medicineLogsService.listForWeek(userId);
    } else if (req.query.from && req.query.to) {
      logs = await medicineLogsService.listInRange(
        userId,
        new Date(String(req.query.from)),
        new Date(String(req.query.to)),
      );
    } else {
      logs = await medicineLogsService.listForDay(userId);
    }

    return res.json({ success: true, logs });
  } catch (err) {
    console.error('[medicines] logs list', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Could not load medicine logs.',
    });
  }
}

/** POST /api/medicines/logs/toggle — { medicine_id, taken, date? } */
async function toggleMedicineLog(req, res) {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const body = readBody(req);
    const medicineId = String(body.medicine_id ?? '').trim();
    const taken = Boolean(body.taken);
    const date = body.date ? new Date(String(body.date)) : new Date();

    if (!medicineId) {
      return res.status(400).json({ success: false, message: 'medicine_id is required.' });
    }

    const medicineLogsService = require('../services/medicine-logs.service');
    const result = await medicineLogsService.setTakenForDay(userId, medicineId, taken, date);

    return res.json({ success: true, log: result });
  } catch (err) {
    console.error('[medicines] logs toggle', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Could not update medicine log.',
    });
  }
}

module.exports = {
  listMedicines,
  getMedicine,
  createMedicines,
  updateMedicine,
  deleteMedicine,
  listMedicineLogs,
  toggleMedicineLog,
};
