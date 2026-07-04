const { randomUUID } = require('crypto');
const { query, execute } = require('../config/mysql');

function toIso(val) {
  if (!val) return val;
  if (val instanceof Date) return val.toISOString();
  return val;
}

function parseJson(val) {
  if (val == null) return val;
  if (typeof val === 'string') {
    try {
      return JSON.parse(val);
    } catch {
      return val;
    }
  }
  return val;
}

function normalizeProfile(row) {
  if (!row) return null;
  return {
    ...row,
    is_banned: !!row.is_banned,
    medical_conditions: parseJson(row.medical_conditions),
    allergies: parseJson(row.allergies),
    health_qr_expires_at: toIso(row.health_qr_expires_at),
    created_at: toIso(row.created_at),
    last_active: toIso(row.last_active),
    plan_started_at: toIso(row.plan_started_at),
    plan_expires_at: toIso(row.plan_expires_at),
  };
}

async function getHealthQrFieldsByUserId(userId) {
  const rows = await query(
    `SELECT health_qr_token, health_qr_expires_at
     FROM profiles WHERE id = ? LIMIT 1`,
    [userId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    health_qr_token: row.health_qr_token,
    health_qr_expires_at: toIso(row.health_qr_expires_at),
  };
}

async function updateHealthQrToken(userId, token, expiresAt) {
  const result = await execute(
    `UPDATE profiles
     SET health_qr_token = ?, health_qr_expires_at = ?
     WHERE id = ?`,
    [token, new Date(expiresAt), userId],
  );
  if (result.affectedRows === 0) {
    const err = new Error('Profile not found');
    err.code = 'PROFILE_NOT_FOUND';
    throw err;
  }
}

async function generateHealthCardToken(userId) {
  const token = randomUUID();
  const expiresAt = new Date();
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);
  const expiresIso = expiresAt.toISOString();

  await updateHealthQrToken(userId, token, expiresIso);
  return { token, expiresAt: expiresIso };
}

async function getOrCreateHealthQrToken(userId) {
  const fields = await getHealthQrFieldsByUserId(userId);
  let token = fields?.health_qr_token;
  let expiresAt = fields?.health_qr_expires_at;

  const expired = expiresAt && new Date(expiresAt) < new Date();
  if (!token || expired) {
    return generateHealthCardToken(userId);
  }

  return { token, expiresAt };
}

async function findProfileByHealthQrToken(token) {
  const rows = await query(
    'SELECT * FROM profiles WHERE health_qr_token = ? LIMIT 1',
    [token],
  );
  return normalizeProfile(rows[0]);
}

async function listActiveMedicinesForHealthCard(userId) {
  return query(
    `SELECT name, dosage, dosage_unit, time, schedule_time, frequency
     FROM medicines
     WHERE user_id = ? AND is_active = 1
     ORDER BY created_at ASC
     LIMIT 20`,
    [userId],
  );
}

const FREQUENCY_LABELS = {
  once: 'Daily',
  twice: 'Twice Daily',
  thrice: 'Three Times Daily',
  four_times: 'Four Times Daily',
  as_needed: 'As Needed',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

function resolveMedicineTime(m) {
  if (m.time) return m.time;
  if (m.schedule_time === 'Morning') return '8:00 AM';
  if (m.schedule_time === 'Afternoon') return '12:00 PM';
  if (m.schedule_time === 'Night' || m.schedule_time === 'Evening') return '8:00 PM';
  return '';
}

/** Builds the deterministic health-card ID shown on both the webpage and the PDF. */
function buildHealthCardId(profileId) {
  const raw = String(profileId || '').replace(/-/g, '').toUpperCase();
  return `TBIT-${raw.slice(0, 4)}-${raw.slice(4, 5)}`;
}

/** "Generated" date shown on both the webpage and the PDF — single canonical format. */
function formatGeneratedDate(date = new Date()) {
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
}

async function getPrimaryEmergencyContact(userId) {
  const rows = await query(
    `SELECT name, phone, role
     FROM emergency_contacts
     WHERE user_id = ?
     ORDER BY created_at ASC
     LIMIT 1`,
    [userId],
  );
  return rows[0] ?? null;
}

async function enrichProfileForHealthCard(profile) {
  const userId = profile.id;
  if (!userId) return profile;

  const meds = await listActiveMedicinesForHealthCard(userId);
  if (meds.length > 0) {
    profile.medications = meds.map((m) => ({
      name: m.name,
      dosage: [m.dosage, m.dosage_unit].filter(Boolean).join(' '),
      frequency_label: FREQUENCY_LABELS[m.frequency] ?? m.frequency ?? 'Daily',
      time: resolveMedicineTime(m),
    }));
  }

  if (!profile.emergency_name && !profile.emergency_phone) {
    const ec = await getPrimaryEmergencyContact(userId);
    if (ec) {
      profile.emergency_name = ec.name;
      profile.emergency_phone = ec.phone;
      profile.emergency_relation = ec.role || profile.emergency_relation;
    }
  }

  return profile;
}

module.exports = {
  generateHealthCardToken,
  getOrCreateHealthQrToken,
  findProfileByHealthQrToken,
  enrichProfileForHealthCard,
  buildHealthCardId,
  formatGeneratedDate,
};
