const {
  findCheckInByUserAndDate,
  upsertDailyCheckIn,
} = require('../services/daily-checkins.service');
const { insertHealthReadings, listByUser } = require('../services/health-readings.service');
const medicineLogsService = require('../services/medicine-logs.service');
const familyMessagesService = require('../services/family-messages.service');

function isTableMissing(error) {
  return (
    error?.code === '42P01'
    || error?.code === 'PGRST205'
    || error?.code === 'ER_NO_SUCH_TABLE'
    || error?.errno === 1146
  );
}

function todayDateStr() {
  return new Date().toISOString().split('T')[0];
}

function normalizeSleepQuality(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const map = { excellent: 3, good: 2, poor: 1 };
  if (map[value] != null) return map[value];
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readBody(req) {
  return req.body ?? {};
}

function resolveUserId(req) {
  return req.auth?.userId ?? req.supabase?.userId ?? null;
}

/** GET /api/wellness/daily-checkin/today */
async function getTodayCheckIn(req, res) {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const date = String(req.query.date ?? todayDateStr()).trim() || todayDateStr();
    const checkIn = await findCheckInByUserAndDate(userId, date);

    return res.json({ success: true, checkIn });
  } catch (err) {
    console.error('[wellness/daily-checkin] get', err);
    if (isTableMissing(err)) {
      return res.status(501).json({
        success: false,
        message: 'daily_checkins table is not deployed. Run migration 012_daily_checkins.sql.',
      });
    }
    return res.status(500).json({
      success: false,
      message: err.message || 'Could not load check-in.',
    });
  }
}

/** POST /api/wellness/daily-checkin — upsert one row per user per day */
async function upsertDailyCheckInHandler(req, res) {
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
      ...fields
    } = body;

    if (!fields.mood) {
      return res.status(400).json({ success: false, message: 'Please select your mood.' });
    }

    const upsertFields = {
      ...fields,
      check_in_date: String(fields.check_in_date ?? todayDateStr()).trim() || todayDateStr(),
    };

    if ('sleep_quality' in upsertFields) {
      upsertFields.sleep_quality = normalizeSleepQuality(upsertFields.sleep_quality);
    }

    const checkIn = await upsertDailyCheckIn(userId, upsertFields);

    return res.json({ success: true, checkIn });
  } catch (err) {
    console.error('[wellness/daily-checkin] upsert', err);
    if (isTableMissing(err)) {
      return res.status(501).json({
        success: false,
        message: 'daily_checkins table is not deployed. Run migration 012_daily_checkins.sql.',
      });
    }
    return res.status(500).json({
      success: false,
      message: err.message || 'Could not save check-in.',
    });
  }
}

/** POST /api/wellness/health-metrics — optional vitals (non-blocking on client). */
async function insertHealthMetrics(req, res) {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const readings = readBody(req).readings;
    if (!Array.isArray(readings) || readings.length === 0) {
      return res.json({ success: true, inserted: 0 });
    }

    const inserted = await insertHealthReadings(userId, readings);
    return res.json({ success: true, inserted });
  } catch (err) {
    console.error('[wellness/health-metrics] insert', err);
    if (isTableMissing(err)) {
      return res.status(501).json({
        success: false,
        message: 'health_readings table is not deployed.',
      });
    }
    return res.status(500).json({
      success: false,
      message: err.message || 'Could not save health metrics.',
    });
  }
}

/** GET /api/wellness/health-metrics */
async function getHealthMetrics(req, res) {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const limit = parseInt(String(req.query.limit ?? '50'), 10) || 50;
    const readings = await listByUser(userId, { limit });
    return res.json({ success: true, readings });
  } catch (err) {
    console.error('[wellness/health-metrics] list', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Could not load health metrics.',
    });
  }
}

/** GET /api/wellness/yesterday-summary */
async function getYesterdaySummary(req, res) {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const dateStr = yesterday.toISOString().split('T')[0];

    const checkIn = await findCheckInByUserAndDate(userId, dateStr);
    const logs = await medicineLogsService.listForDay(userId, yesterday);
    const messageCount = await familyMessagesService.countForReceiverOnDate(userId, dateStr);

    return res.json({
      success: true,
      summary: {
        checkIn,
        medicineLogs: logs,
        familyMessageCount: messageCount,
        date: dateStr,
      },
    });
  } catch (err) {
    console.error('[wellness/yesterday-summary]', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Could not load yesterday summary.',
    });
  }
}

module.exports = {
  getTodayCheckIn,
  upsertDailyCheckIn: upsertDailyCheckInHandler,
  insertHealthMetrics,
  getHealthMetrics,
  getYesterdaySummary,
};
