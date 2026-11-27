const profilesService = require('./profiles.service');
const medicinesService = require('./medicines.service');
const medicineLogsService = require('./medicine-logs.service');
const dailyCheckinsService = require('./daily-checkins.service');
const appointmentsService = require('./appointments.service');
const emergencyContactsService = require('./emergency-contacts.service');
const healthRecordsService = require('./health-records.service');
const healthReadingsService = require('./health-readings.service');
const healthInsightsService = require('./health-insights.service');
const calorieTrackerService = require('./calorie-tracker.service');
const mindGamesService = require('./mind-games.service');
const guardianService = require('./guardian.service');
const { FREQUENCY_LABELS, resolveMedicineTime, formatConditionLabels } = require('../utils/health-labels');
const { resolveTodayForUser } = require('./timezone.service');

const SLEEP_QUALITY_LABELS = { '1': 'poor', '2': 'good', '3': 'excellent', poor: 'poor', good: 'good', excellent: 'excellent' };
const PAIN_LEVEL_LABELS = { '0': 'none', '1': 'mild', '2': 'moderate', '3': 'severe', none: 'none', mild: 'mild', moderate: 'moderate', severe: 'severe' };
const GAME_TYPE_LABELS = {
  number_memory: 'Number Memory',
  word_match: 'Word Match',
  color_recall: 'Colour Recall',
  quiz: 'Story Quiz',
  reaction: 'Reaction Time',
  memory_tiles: 'Memory Tiles',
  typing_speed: 'Typing Speed',
  daily_quiz: 'Daily Quiz',
};
const ON_DEMAND_EXTRACT_TIMEOUT_MS = 15_000;

function calcAgeFromDob(dob) {
  if (!dob) return null;
  const parsed = new Date(dob);
  if (Number.isNaN(parsed.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - parsed.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - parsed.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < parsed.getUTCDate())) age -= 1;
  return age >= 0 && age <= 130 ? age : null;
}

function parseJsonSafe(raw) {
  if (!raw) return null;
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function formatMedicineLine(m, takenToday) {
  const dose = [m.dosage, m.dosage_unit].filter(Boolean).join(' ');
  const freq = FREQUENCY_LABELS[m.frequency] ?? m.frequency ?? 'Daily';
  const time = resolveMedicineTime(m);
  const status = takenToday ? 'taken today' : 'NOT taken yet today';
  return `- ${m.name}${dose ? ` (${dose})` : ''} — ${freq}${time ? ` at ${time}` : ''} — ${status}`;
}

function formatCheckInLine(checkIn, latestMoodEntry, today) {
  if (!checkIn && !latestMoodEntry) return "Today's check-in: not logged yet.";
  const parts = [];

  const parsedNotes = parseJsonSafe(checkIn?.notes);
  const isToday = checkIn?.check_in_date === today;

  const effectiveMood = latestMoodEntry?.mood || checkIn?.mood;
  if (effectiveMood) parts.push(`mood: ${effectiveMood}`);

  if (typeof parsedNotes?.healthScore === 'number') {
    parts.push(`health score: ${parsedNotes.healthScore}/100`);
  }
  if (parsedNotes?.moodNote) {
    parts.push(`mood note: "${parsedNotes.moodNote}"`);
  } else if (latestMoodEntry?.note) {
    parts.push(`mood note: "${latestMoodEntry.note}"`);
  }

  const sleepLabel = checkIn?.sleep_quality != null
    ? SLEEP_QUALITY_LABELS[String(checkIn.sleep_quality).toLowerCase()] ?? String(checkIn.sleep_quality)
    : null;
  if (sleepLabel) parts.push(`sleep quality: ${sleepLabel}`);
  if (checkIn?.sleep_hours != null) parts.push(`sleep duration: ${checkIn.sleep_hours}h`);

  if (checkIn?.pain_reported) {
    const painLabel = checkIn.pain_level != null
      ? PAIN_LEVEL_LABELS[String(checkIn.pain_level).toLowerCase()] ?? String(checkIn.pain_level)
      : '';
    parts.push(`reported pain${painLabel ? ` (${painLabel})` : ''}`);
  } else if (checkIn) {
    parts.push('no pain reported');
  }

  if (checkIn?.energy_level) parts.push(`energy: ${checkIn.energy_level}`);
  if (checkIn?.physical_activity) parts.push(`activity: ${checkIn.physical_activity}`);
  if (checkIn?.water_glasses != null) parts.push(`water: ${checkIn.water_glasses} glasses`);
  if (checkIn?.breakfast_done != null) parts.push(`breakfast: ${checkIn.breakfast_done ? 'yes' : 'no'}`);
  if (parsedNotes?.bpQuick) parts.push(`quick BP check: ${parsedNotes.bpQuick}`);
  if (parsedNotes?.sugarQuick) parts.push(`quick sugar check: ${parsedNotes.sugarQuick}`);

  const dateLabel = checkIn?.check_in_date
    ? (isToday ? 'today' : checkIn.check_in_date)
    : 'recent';
  return `Latest Health Check-in (${dateLabel}): ${parts.length > 0 ? parts.join(', ') : 'logged, no details'}.`;
}

function formatRecentTrendsLine(recentCheckIns, recentMoods) {
  const parts = [];
  if (Array.isArray(recentCheckIns) && recentCheckIns.length > 0) {
    const sleepHrs = recentCheckIns.map((c) => Number(c.sleep_hours)).filter((n) => Number.isFinite(n) && n > 0);
    const scores = recentCheckIns
      .map((c) => parseJsonSafe(c.notes)?.healthScore)
      .filter((s) => typeof s === 'number');
    const painDays = recentCheckIns.filter((c) => c.pain_reported).length;

    parts.push(`${recentCheckIns.length} check-in(s) recently`);
    if (sleepHrs.length > 0) {
      const avgSleep = (sleepHrs.reduce((a, b) => a + b, 0) / sleepHrs.length).toFixed(1);
      parts.push(`avg sleep ${avgSleep}h`);
    }
    if (scores.length > 0) {
      const avgScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
      parts.push(`avg wellness score ${avgScore}/100`);
    }
    if (painDays > 0) parts.push(`pain reported on ${painDays} day(s)`);
  }

  if (Array.isArray(recentMoods) && recentMoods.length > 0) {
    const trail = recentMoods
      .slice(0, 5)
      .map((m) => `${m.mood} (${String(m.created_at || '').slice(0, 10)})`)
      .join(', ');
    parts.push(`recent moods: ${trail}`);
  }

  return parts.length > 0 ? `Recent Wellness Trend: ${parts.join('; ')}.` : null;
}

function formatVitalsLine(readings) {
  if (!Array.isArray(readings) || readings.length === 0) {
    return 'Vitals & Health Readings: None recorded yet.';
  }
  const latestByType = new Map();
  for (const r of readings) {
    const key = r.vital_type || r.type;
    if (key && !latestByType.has(key)) {
      latestByType.set(key, r);
    }
  }
  const lines = ['Latest Vitals & Health Readings:'];
  for (const [type, r] of Array.from(latestByType.entries()).slice(0, 8)) {
    const when = String(r.recorded_at || r.created_at || '').slice(0, 10);
    lines.push(`- ${type}: ${r.value}${r.unit ? ` ${r.unit}` : ''}${when ? ` (${when})` : ''}`);
  }
  return lines.join('\n');
}

function formatNutritionLine(summary) {
  if (!summary) return 'Today\'s Nutrition: Not available.';
  const goalCal = summary.goal?.daily_calories ?? null;
  const totalCal = Math.round(summary.totals?.calories ?? 0);
  if ((summary.meal_count ?? 0) === 0) {
    return goalCal
      ? `Today's Nutrition: 0 meals logged yet (daily goal: ${goalCal} kcal).`
      : 'Today\'s Nutrition: 0 meals logged today.';
  }
  const macros = [
    `protein ${Math.round(summary.totals?.protein_g ?? 0)}g`,
    `carbs ${Math.round(summary.totals?.carbs_g ?? 0)}g`,
    `fat ${Math.round(summary.totals?.fat_g ?? 0)}g`,
  ].join(', ');
  const mealsDesc = (summary.meals || [])
    .slice(0, 5)
    .map((m) => `${m.meal_type}: ${(m.food_items || []).slice(0, 3).join(', ') || 'meal'} (${Math.round(m.calories || 0)} kcal)`)
    .join('; ');
  return `Today's Nutrition: ${summary.meal_count} meal(s), ${totalCal}${goalCal ? `/${goalCal}` : ''} kcal (${macros})${mealsDesc ? ` — ${mealsDesc}` : ''}.`;
}

/** Ensures up to 2 recent AI-readable reports without cached `ai_insights` are extracted on demand. */
async function hydratePendingReportInsights(userId, records) {
  if (!Array.isArray(records) || records.length === 0) return records;
  const pending = records
    .filter((r) => r.ai_read && !r.ai_insights && r.uri)
    .slice(0, 2);
  if (pending.length === 0) return records;

  const extractPromise = Promise.allSettled(
    pending.map(async (rec) => {
      const result = await healthInsightsService.extractAndSaveRecordInsights(userId, rec);
      rec.ai_insights = result.insights;
      rec.ai_insights_at = result.computed_at;
    }),
  );

  let timer;
  await Promise.race([
    extractPromise.finally(() => clearTimeout(timer)),
    new Promise((resolve) => {
      timer = setTimeout(resolve, ON_DEMAND_EXTRACT_TIMEOUT_MS);
    }),
  ]);
  return records;
}

function formatHealthReportsLine(records) {
  if (!Array.isArray(records) || records.length === 0) {
    return 'Health Vault Reports: None uploaded yet.';
  }
  const lines = [`Health Vault Reports (${records.length} report${records.length > 1 ? 's' : ''} on file):`];
  for (const r of records.slice(0, 5)) {
    const meta = [r.category, r.date].filter(Boolean).join(' · ');
    const insights = parseJsonSafe(r.ai_insights);
    if (!insights) {
      const note = r.ai_read
        ? 'AI analysis pending or unreadable'
        : 'AI reading disabled by user for this file';
      lines.push(`- ${r.title}${meta ? ` (${meta})` : ''} [${note}]`);
      continue;
    }

    const headerParts = [
      insights.reportType && insights.reportType !== 'Unknown' ? insights.reportType : null,
      insights.alertLevel ? `alert: ${insights.alertLevel}` : null,
    ].filter(Boolean);
    const summaryText = insights.summary || insights.overview || '';
    lines.push(`- ${r.title}${meta ? ` (${meta})` : ''}${headerParts.length ? ` [${headerParts.join(', ')}]` : ''}${summaryText ? ` — ${summaryText}` : ''}`);

    if (Array.isArray(insights.metrics) && insights.metrics.length > 0) {
      const metricList = insights.metrics
        .slice(0, 6)
        .map((m) => {
          const ref = m.normalRange ? `, normal: ${m.normalRange}` : '';
          const status = m.status ? ` [${m.status}${ref}]` : '';
          return `${m.name}: ${m.value}${status}`;
        })
        .join('; ');
      lines.push(`  Metrics: ${metricList}`);
    }
    if (Array.isArray(insights.riskFactors) && insights.riskFactors.length > 0) {
      lines.push(`  Risks: ${insights.riskFactors.slice(0, 3).join('; ')}`);
    }
    if (insights.followUp) {
      lines.push(`  Follow-up: ${insights.followUp}`);
    }
  }
  return lines.join('\n');
}

function formatMindGamesLine(gameStats) {
  if (!gameStats || !gameStats.totalGames) {
    return 'Mind Games: None played yet.';
  }
  const mins = Math.round((gameStats.totalDurationSeconds || 0) / 60);
  const timeStr = mins > 0 ? `, ~${mins} min total playtime` : '';
  const todayStr = gameStats.todayGames > 0
    ? ` Today: ${gameStats.todayGames} game(s), +${gameStats.todayScore} pts.`
    : '';
  const recentStr = Array.isArray(gameStats.recentGames) && gameStats.recentGames.length > 0
    ? ` Recent: ${gameStats.recentGames.slice(0, 3).map((g) => `${GAME_TYPE_LABELS[g.gameType] || g.gameType} (${g.score} pts)`).join(', ')}.`
    : '';
  return `Mind Games: ${gameStats.totalGames} total game(s), ${gameStats.totalScore} total pts (rank #${gameStats.rank}${timeStr}).${todayStr}${recentStr}`;
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

async function buildGuardianEldersSection(guardianId) {
  const links = await guardianService.getConnectedLinksForGuardian(guardianId).catch(() => []);
  if (!Array.isArray(links) || links.length === 0) {
    return 'Connected Elders: None connected yet.';
  }

  const results = await Promise.allSettled(
    links.slice(0, 3).map(async (link) => {
      const [dash, records] = await Promise.all([
        guardianService.getElderDashboardForGuardian(guardianId, link.elder_id),
        healthRecordsService.listByUser(link.elder_id).catch(() => []),
      ]);
      const name = dash?.profile?.fullName || link.parent_name || 'Elder';
      const rel = link.relation ? ` (${link.relation})` : '';
      const meds = dash?.medicines || [];
      const taken = meds.filter((m) => m.takenToday).length;
      const medsText = meds.length > 0 ? `${taken}/${meds.length} medicines taken today` : 'no medicines set';
      const checkinText = dash?.checkedInToday
        ? `checked in today${dash.mood ? ` (mood: ${dash.mood})` : ''}`
        : 'not checked in today';
      const gamesText = `mind games ${dash?.mindGamesScore ?? 0} total pts${dash?.mindGamesPlayedToday ? ` (+${dash.mindGamesTodayScore} today)` : ''}`;
      const locText = dash?.location?.isSharing
        ? `sharing location${dash.location.address ? ` (${dash.location.address})` : ''}`
        : 'location sharing off';
      const reportCount = Array.isArray(records) ? records.length : 0;
      return `- ${name}${rel}: ${medsText}; ${checkinText}; ${gamesText}; ${locText}; ${reportCount} health report(s) on file.`;
    }),
  );

  const lines = ['Connected Elders Summary:'];
  for (const res of results) {
    if (res.status === 'fulfilled') lines.push(res.value);
  }
  return lines.length > 1 ? lines.join('\n') : 'Connected Elders: Unavailable right now.';
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
    recentCheckIns,
    recentMoods,
    appointments,
    contacts,
    healthRecords,
    healthReadings,
    nutritionSummary,
    gameStats,
  ] = await Promise.all([
    profilesService.getProfileById(userId),
    medicinesService.listByUser(userId, { activeOnly: true }),
    medicineLogsService.listForDay(userId, today),
    dailyCheckinsService.findCheckInByUserAndDate(userId, today),
    dailyCheckinsService.listRecentCheckIns(userId, 7).catch(() => []),
    dailyCheckinsService.listRecentMoodEntries(userId, 7).catch(() => []),
    appointmentsService.listByUser(userId),
    emergencyContactsService.listByUserId(userId),
    healthRecordsService.listByUser(userId).catch(() => []),
    healthReadingsService.listByUser(userId, { limit: 25 }).catch(() => []),
    calorieTrackerService.getTodaySummary(userId, today).catch(() => null),
    mindGamesService.getUserStats(userId).catch(() => null),
  ]);

  await hydratePendingReportInsights(userId, healthRecords).catch(() => {});

  const activeCheckIn = todayCheckIn || recentCheckIns[0] || null;
  const latestMood = recentMoods[0] || null;
  const age = profile?.age || calcAgeFromDob(profile?.date_of_birth);

  const lines = [];

  lines.push(`Name: ${profile?.full_name || 'Friend'}`);
  lines.push(`Role: ${profile?.role || 'unknown'}`);
  if (age != null) lines.push(`Age: ${age}`);
  if (profile?.biological_sex) lines.push(`Sex: ${profile.biological_sex}`);
  if (profile?.blood_group) lines.push(`Blood Group: ${profile.blood_group}`);
  if (profile?.location) lines.push(`Location: ${profile.location}`);
  if (profile?.streak != null) lines.push(`Wellness Streak: ${profile.streak} day(s)`);

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

  lines.push(formatCheckInLine(activeCheckIn, latestMood, today));
  const trendLine = formatRecentTrendsLine(recentCheckIns, recentMoods);
  if (trendLine) lines.push(trendLine);

  lines.push(formatVitalsLine(healthReadings));
  lines.push(formatNutritionLine(nutritionSummary));
  lines.push(formatHealthReportsLine(healthRecords));
  lines.push(formatMindGamesLine(gameStats));
  lines.push(formatAppointmentLine(appointments));

  if (profile?.role === 'guardian') {
    lines.push(await buildGuardianEldersSection(userId));
  }

  return lines.join('\n');
}

module.exports = { buildSathiContext };
