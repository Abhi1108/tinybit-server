const { randomUUID } = require('crypto');
const { query, execute } = require('../config/mysql');

function getUtcYearMonth() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function getNextMonthResetDateIso() {
  const now = new Date();
  const nextMonthFirst = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0));
  return nextMonthFirst.toISOString();
}

function isProfilePremium(profile) {
  if (!profile) return false;
  if (profile.role !== 'guardian') return true; // Elders do not require plans
  const expiresAt = profile.plan_expires_at ? new Date(profile.plan_expires_at) : null;
  const isActive = ['active', 'trial'].includes(profile.plan_status);
  return Boolean(isActive && expiresAt && expiresAt.getTime() > Date.now());
}

async function getScanUsageThisMonth(guardianId, isPremium = false) {
  const yearMonth = getUtcYearMonth();
  const rows = await query(
    'SELECT COUNT(*) AS cnt FROM report_scan_usage WHERE guardian_id = ? AND year_month = ?',
    [guardianId, yearMonth],
  );
  const used = Number(rows[0]?.cnt || 0);
  const limit = isPremium ? null : 1;
  const remaining = isPremium ? null : Math.max(0, 1 - used);

  return {
    year_month: yearMonth,
    used,
    limit,
    remaining,
    resets_at: getNextMonthResetDateIso(),
  };
}

async function canUploadReportScan(guardianId, profile) {
  const isPremium = isProfilePremium(profile);
  if (isPremium) {
    return { allowed: true, is_premium: true, used: 0, limit: null };
  }

  const usage = await getScanUsageThisMonth(guardianId, false);
  if (usage.used >= 1) {
    return {
      allowed: false,
      is_premium: false,
      code: 'SCAN_QUOTA_EXCEEDED',
      message: 'Free plan limit reached (1 report scan per month). Upgrade to TinyBit Premium for unlimited scans.',
      used: usage.used,
      limit: 1,
      resets_at: usage.resets_at,
    };
  }

  return {
    allowed: true,
    is_premium: false,
    used: usage.used,
    limit: 1,
    resets_at: usage.resets_at,
  };
}

async function recordReportScanUsage(guardianId, elderId, fileName = null) {
  const id = randomUUID();
  const yearMonth = getUtcYearMonth();
  await execute(
    `INSERT INTO report_scan_usage (id, guardian_id, elder_id, year_month, file_name, created_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))`,
    [id, guardianId, elderId, yearMonth, fileName || null],
  );
  return { id, guardian_id: guardianId, elder_id: elderId, year_month: yearMonth };
}

module.exports = {
  isProfilePremium,
  getScanUsageThisMonth,
  canUploadReportScan,
  recordReportScanUsage,
  getUtcYearMonth,
};
