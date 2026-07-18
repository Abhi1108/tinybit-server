const medicinesService = require('../services/medicines.service');
const medicineLogsService = require('../services/medicine-logs.service');
const { notifyGuardiansOfElder, shouldSendActionNotification } = require('../services/notifications.service');
const { NOTIFICATION_TYPES } = require('../constants/notification-types');

const MEDICINE_CHANGE_COPY = {
  added:   { title: 'New Medicine Added', body: "A new medicine has been added to the user's schedule.", type: NOTIFICATION_TYPES.MEDICINE_ADDED },
  updated: { title: 'Medicine Updated',   body: "The user's medicine schedule has been updated.", type: NOTIFICATION_TYPES.MEDICINE_UPDATED },
  removed: { title: 'Medicine Removed',   body: "A medicine has been removed from the user's schedule.", type: NOTIFICATION_TYPES.MEDICINE_REMOVED },
};

async function notifyGuardiansOfMedicineChange(elderId, action) {
  try {
    // Debounced (plan Section 17.3) — a retried/double-tapped save would otherwise re-fire
    // this for the same edit; a genuinely separate add/edit minutes later still notifies.
    if (!(await shouldSendActionNotification(elderId, `medicine_${action}`))) return;
    const { title, body, type } = MEDICINE_CHANGE_COPY[action];
    await notifyGuardiansOfElder(elderId, {
      type,
      title,
      body,
      data: { type, elderId },
    });
  } catch (err) {
    console.error('notifyGuardiansOfMedicineChange error:', err);
  }
}

/** "8:00 AM" / "2:30 PM" -> 'Morning' | 'Afternoon' | 'Night'. Defaults to 'Morning' if unparseable. */
function doseTimeBucket(timeStr) {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(timeStr ?? '').trim());
  if (!match) return 'Morning';
  let hour = Number(match[1]) % 12;
  if (match[3].toUpperCase() === 'PM') hour += 12;
  if (hour < 12) return 'Morning';
  if (hour < 17) return 'Afternoon';
  return 'Night';
}

async function notifyGuardiansOfDoseCompleted(elderId, medicineId) {
  try {
    const medicine = await medicinesService.getById(elderId, medicineId);
    if (!medicine) return;
    const bucket = doseTimeBucket(medicine.time);
    await notifyGuardiansOfElder(elderId, {
      type: NOTIFICATION_TYPES.MEDICINE_DOSE_COMPLETED,
      title: `${bucket} Dose Completed`,
      body: 'The user has successfully completed their ' + bucket.toLowerCase() + ' medicine.',
      data: { type: NOTIFICATION_TYPES.MEDICINE_DOSE_COMPLETED, elderId },
    });
  } catch (err) {
    console.error('notifyGuardiansOfDoseCompleted error:', err);
  }
}

/** Mirrors notifyGuardiansOfDoseCompleted for the reverse action — a guardian who was already
 * told "dose completed" otherwise has no way of learning it was undone (e.g. the elder
 * corrected an accidental tap). Only fires when a log row was actually deleted (`reverted`),
 * never for an untake toggle on a dose that wasn't logged in the first place. */
async function notifyGuardiansOfDoseReverted(elderId, medicineId) {
  try {
    const medicine = await medicinesService.getById(elderId, medicineId);
    if (!medicine) return;
    const bucket = doseTimeBucket(medicine.time);
    await notifyGuardiansOfElder(elderId, {
      type: 'medicine_dose_reverted',
      title: `${bucket} Dose Marked Not Taken`,
      body: 'The user has marked their ' + bucket.toLowerCase() + ' medicine as not taken.',
      data: { type: 'medicine_dose_reverted', elderId },
    });
  } catch (err) {
    console.error('notifyGuardiansOfDoseReverted error:', err);
  }
}

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
    await notifyGuardiansOfMedicineChange(userId, 'added');

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

    // A patch touching only `stock` isn't a schedule change — the client sends one of these per
    // sibling dose-slot to mirror a shared bottle's stock count after a toggle on one slot
    // (MedicineSelfView.tsx's toggleTaken), which used to trigger a spurious "medicine schedule
    // has been updated" push alongside the real "Dose Completed" one for the same action.
    const isStockOnlyPatch = Object.keys(patch).length === 1 && Object.prototype.hasOwnProperty.call(patch, 'stock');
    if (!isStockOnlyPatch) {
      await notifyGuardiansOfMedicineChange(userId, 'updated');
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

    await notifyGuardiansOfMedicineChange(userId, 'removed');
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

    const scope = String(req.query.scope ?? '').toLowerCase();

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
    if (isTableMissing(err)) {
      return res.status(501).json({ success: false, message: 'medicine_logs table is not deployed.' });
    }
    return res.status(500).json({
      success: false,
      message: err.message || 'Could not load medicine logs.',
    });
  }
}

/** POST /api/medicines/logs/toggle — { medicine_id, taken, from?, to? (ISO instants bounding the caller's local day) } */
async function toggleMedicineLog(req, res) {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const body = readBody(req);
    const medicineId = String(body.medicine_id ?? '').trim();
    const taken = body.taken === true || body.taken === 'true';
    // The client knows its own local day (any timezone); only fall back to the
    // server's day when an older client doesn't send explicit bounds.
    const dayBounds = body.from && body.to
      ? { start: new Date(body.from), end: new Date(body.to) }
      : undefined;

    if (!medicineId) {
      return res.status(400).json({ success: false, message: 'medicine_id is required.' });
    }

    const log = await medicineLogsService.setTakenForDay(userId, medicineId, taken, dayBounds);
    // `alreadyLogged` distinguishes a genuinely new dose-taking event from a repeat
    // toggle/retry that found the dose already logged (setTakenForDay returns the same row
    // shape either way, and previously nothing here told them apart — a repeat request used
    // to re-fire this notification for no new event).
    if (taken && !log?.alreadyLogged) {
      await notifyGuardiansOfDoseCompleted(userId, medicineId);
    }
    if (!taken && log?.reverted) {
      await notifyGuardiansOfDoseReverted(userId, medicineId);
    }

    return res.json({ success: true, log });
  } catch (err) {
    console.error('[medicines] logs toggle', err);
    if (isTableMissing(err)) {
      return res.status(501).json({ success: false, message: 'medicine_logs table is not deployed.' });
    }
    const status = err.statusCode || 500;
    return res.status(status).json({
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
