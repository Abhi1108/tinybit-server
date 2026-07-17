const {
  findCheckInByUserAndDate,
  upsertDailyCheckIn,
  insertMoodEntry,
} = require('../services/daily-checkins.service');
const { insertHealthReadings, listByUser } = require('../services/health-readings.service');
const medicineLogsService = require('../services/medicine-logs.service');
const familyMessagesService = require('../services/family-messages.service');
const { notifyGuardiansOfElder, shouldSendActionNotification } = require('../services/notifications.service');
const { resolveDate, addDays } = require('../utils/date');
const { resolveTodayForUser } = require('../services/timezone.service');

function isTableMissing(error) {
  return (
    error?.code === '42P01'
    || error?.code === 'PGRST205'
    || error?.code === 'ER_NO_SUCH_TABLE'
    || error?.errno === 1146
  );
}

function todayDateStr(userId) {
  return resolveTodayForUser(userId);
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
  return req.auth?.userId ?? null;
}

/** GET /api/wellness/daily-checkin/today */
async function getTodayCheckIn(req, res) {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const date = String(req.query.date ?? await todayDateStr(userId)).trim() || await todayDateStr(userId);
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
      source,
      mood_note: moodNote,
      ...fields
    } = body;

    if (!fields.mood) {
      return res.status(400).json({ success: false, message: 'Please select your mood.' });
    }

    const upsertFields = {
      ...fields,
      check_in_date: String(fields.check_in_date ?? await todayDateStr(userId)).trim() || await todayDateStr(userId),
    };

    if ('sleep_quality' in upsertFields) {
      upsertFields.sleep_quality = normalizeSleepQuality(upsertFields.sleep_quality);
    }

    const checkIn = await upsertDailyCheckIn(userId, upsertFields);

    const isMoodLift = source === 'mood_lift';
    if (isMoodLift) {
      try {
        await insertMoodEntry(userId, {
          mood: upsertFields.mood,
          moodScore: upsertFields.mood_score,
          note: moodNote ?? null,
        });
      } catch (moodEntryErr) {
        console.warn('[wellness/daily-checkin] mood_entries insert failed:', moodEntryErr.message);
      }
    }

    try {
      // Debounced (plan Section 17.3) — upsertDailyCheckIn succeeds on every call (it's an
      // upsert, not a plain insert), so unlike a unique-constrained insert, a retried/
      // double-tapped submit would otherwise notify guardians twice for one real check-in.
      const notifType = isMoodLift ? 'mood_lift_completed' : 'daily_checkin';
      if (await shouldSendActionNotification(userId, notifType)) {
        await notifyGuardiansOfElder(userId, {
          type: notifType,
          title: isMoodLift ? 'Mood Lift' : 'Check-In Completed',
          body: isMoodLift
            ? "The user has completed today's Mood Lift activity."
            : "The user has completed today's wellness check-in.",
          data: {
            type: notifType,
            elderId: userId,
            mood: upsertFields.mood,
          },
        });
      }
    } catch (notifyErr) {
      console.warn('[wellness/daily-checkin] guardian notify failed:', notifyErr.message);
    }

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

    const today = resolveDate(req.query.date);
    const dateStr = addDays(today, -1);

    const checkIn = await findCheckInByUserAndDate(userId, dateStr);
    const logs = await medicineLogsService.listForDay(userId, dateStr);
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
