const profilesService = require('./profiles.service');
const medicinesService = require('./medicines.service');
const medicineLogsService = require('./medicine-logs.service');
const dailyCheckinsService = require('./daily-checkins.service');
const appointmentsService = require('./appointments.service');
const emergencyContactsService = require('./emergency-contacts.service');
const healthRecordsService = require('./health-records.service');
const mindGamesService = require('./mind-games.service');
const { FREQUENCY_LABELS, resolveMedicineTime, formatConditionLabels } = require('../utils/health-labels');
const { resolveTodayForUser } = require('./timezone.service');

function formatMedicineLine(m, takenToday) {
  const dose = [m.dosage, m.dosage_unit].filter(Boolean).join(' ');
  const freq = FREQUENCY_LABELS[m.frequency] ?? m.frequency ?? 'Daily';
  const time = resolveMedicineTime(m);
  const status = takenToday ? 'taken today' : 'NOT taken yet today';
  return `- ${m.name}${dose ? ` (${dose})` : ''} — ${freq}${time ? ` at ${time}` : ''} — ${status}`;
}

function formatCheckInLine(checkIn, latestMoodEntry) {
  if (!checkIn && !latestMoodEntry) return 'Today\'s check-in: not logged yet.';
  const parts = [];

  let parsedNotes = null;
  if (checkIn?.notes) {
    try {
      parsedNotes = typeof checkIn.notes === 'string' ? JSON.parse(checkIn.notes) : checkIn.notes;
    } catch {
      // not JSON
    }
  }

  const effectiveMood = latestMoodEntry?.mood || checkIn?.mood;
  if (effectiveMood) parts.push(`mood: ${effectiveMood}`);

  if (typeof parsedNotes?.healthScore === 'number') {
    parts.push(`today's health score: ${parsedNotes.healthScore}/100`);
  }
  if (parsedNotes?.moodNote) {
    parts.push(`mood note: "${parsedNotes.moodNote}"`);
  } else if (latestMoodEntry?.note) {
    parts.push(`mood note: "${latestMoodEntry.note}"`);
  }

  if (checkIn?.sleep_quality) parts.push(`sleep: ${checkIn.sleep_quality}`);
  if (checkIn?.pain_reported) {
    const level = checkIn.pain_level ? ` (${checkIn.pain_level})` : '';
    parts.push(`reported pain${level}`);
  } else if (checkIn) {
    parts.push('no pain reported');
  }
  if (checkIn?.energy_level) parts.push(`energy: ${checkIn.energy_level}`);
  if (checkIn?.water_glasses != null) parts.push(`water: ${checkIn.water_glasses} glasses`);

  const dateLabel = checkIn?.check_in_date ? ` (${checkIn.check_in_date})` : '';
  return `Health Check-in${dateLabel}: ${parts.length > 0 ? parts.join(', ') : 'logged, no details'}.`;
}

function formatHealthReportsLine(records) {
  if (!Array.isArray(records) || records.length === 0) {
    return 'Health Vault Reports: None uploaded yet.';
  }
  const lines = [`Health Vault Reports (${records.length} report${records.length > 1 ? 's' : ''} on file):`];
  for (const r of records.slice(0, 5)) {
    const meta = [r.category, r.date, r.doctor_name].filter(Boolean).join(' · ');
    let insightsSummary = '';
    if (r.ai_insights) {
      try {
        const insights = typeof r.ai_insights === 'string' ? JSON.parse(r.ai_insights) : r.ai_insights;
        if (insights.summary) insightsSummary = ` — ${insights.summary}`;
        else if (insights.overview) insightsSummary = ` — ${insights.overview}`;
      } catch {
        // ignore
      }
    }
    lines.push(`- ${r.title}${meta ? ` (${meta})` : ''}${insightsSummary}`);
  }
  return lines.join('\n');
}

function formatMindGamesLine(gameStats) {
  if (!gameStats || !gameStats.totalGames) {
    return 'Mind Games: None played recently.';
  }
  const mins = Math.round((gameStats.totalDurationSeconds || 0) / 60);
  const timeStr = mins > 0 ? `, ~${mins} minutes total playtime` : '';
  return `Mind Games: ${gameStats.totalGames} game${gameStats.totalGames > 1 ? 's' : ''} recorded${timeStr}. Games and scores are tracked in the app.`;
}

function formatAppointmentLine(appointments) {
  const upcoming = (appointments || [])
    .filter((a) => a.status === 'upcoming')
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  if (upcoming.length === 0) return 'Next appointment: none scheduled.';

  const next = upcoming[0];
  const who = next.doctor_name || 'Doctor';
  const specialty = next.specialty ? ` (${next.specialty})` : '';
  const when = [next.date, next.time].filter(Boolean).join(' ') || 'date to be confirmed';
  return `Next appointment: ${who}${specialty} on ${when}.`;
}

/**
 * Builds Sathi's per-turn user context server-side, so the model always sees
 * live data rather than whatever the client happened to have cached.
 */
async function buildSathiContext(userId) {
  const today = await resolveTodayForUser(userId);

  const [
    profile,
    medicines,
    todayLogs,
    todayCheckIn,
    latestCheckIn,
    latestMood,
    appointments,
    contacts,
    healthRecords,
    gameStats,
  ] = await Promise.all([
    profilesService.getProfileById(userId),
    medicinesService.listByUser(userId, { activeOnly: true }),
    medicineLogsService.listForDay(userId, today),
    dailyCheckinsService.findCheckInByUserAndDate(userId, today),
    dailyCheckinsService.findLatestCheckIn(userId).catch(() => null),
    dailyCheckinsService.findLatestMoodEntry(userId).catch(() => null),
    appointmentsService.listByUser(userId),
    emergencyContactsService.listByUserId(userId),
    healthRecordsService.listByUser(userId).catch(() => []),
    mindGamesService.getUserStats(userId).catch(() => null),
  ]);

  const activeCheckIn = todayCheckIn || latestCheckIn;

  const lines = [];

  lines.push(`Name: ${profile?.full_name || 'Friend'}`);
  lines.push(`Role: ${profile?.role || 'unknown'}`);
  if (profile?.age) lines.push(`Age: ${profile.age}`);
  if (profile?.biological_sex) lines.push(`Sex: ${profile.biological_sex}`);
  if (profile?.blood_group) lines.push(`Blood Group: ${profile.blood_group}`);

  const conditions = formatConditionLabels(profile?.medical_conditions, profile?.other_condition);
  lines.push(`Medical Conditions: ${conditions.length > 0 ? conditions.join(', ') : 'none provided'}`);

  const allergies = Array.isArray(profile?.allergies) ? profile.allergies : [];
  if (allergies.length > 0) lines.push(`Allergies: ${allergies.join(', ')}`);

  let emergencyName = profile?.emergency_name;
  let emergencyPhone = profile?.emergency_phone;
  if (!emergencyName && !emergencyPhone && contacts.length > 0) {
    emergencyName = contacts[0].name;
    emergencyPhone = contacts[0].phone;
  }
  lines.push(`Emergency Contact: ${emergencyName ? `${emergencyName}${emergencyPhone ? ` (${emergencyPhone})` : ''}` : 'not set'}`);

  if (medicines.length === 0) {
    lines.push('Medicines: none on file.');
  } else {
    const takenIds = new Set(todayLogs.map((l) => l.medicine_id));
    lines.push('Today\'s Medicines:');
    for (const m of medicines) {
      lines.push(formatMedicineLine(m, takenIds.has(m.id)));
    }
  }

  lines.push(formatCheckInLine(activeCheckIn, latestMood));
  lines.push(formatHealthReportsLine(healthRecords));
  lines.push(formatMindGamesLine(gameStats));
  lines.push(formatAppointmentLine(appointments));

  return lines.join('\n');
}

module.exports = { buildSathiContext };
