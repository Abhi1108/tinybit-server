const { randomUUID } = require('crypto');
const { supabaseClient } = require('../config/supabase');

async function getHealthQrFieldsByUserId(userId) {
  const { data, error } = await supabaseClient
    .from('profiles')
    .select('health_qr_token, health_qr_expires_at')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function updateHealthQrToken(userId, token, expiresAt) {
  const { error } = await supabaseClient
    .from('profiles')
    .update({ health_qr_token: token, health_qr_expires_at: expiresAt })
    .eq('id', userId);

  if (error) throw error;
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
  const { data, error } = await supabaseClient
    .from('profiles')
    .select('*')
    .eq('health_qr_token', token)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function listActiveMedicinesForHealthCard(userId) {
  const { data, error } = await supabaseClient
    .from('medicines')
    .select('name, dosage, dosage_unit, time, schedule_time, frequency')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(20);

  if (error) throw error;
  return data ?? [];
}

async function getPrimaryEmergencyContact(userId) {
  const { data, error } = await supabaseClient
    .from('emergency_contacts')
    .select('name, phone, role')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function enrichProfileForHealthCard(profile) {
  const userId = profile.id;
  if (!userId) return profile;

  const meds = await listActiveMedicinesForHealthCard(userId);
  if (meds.length > 0) {
    profile.medications = meds.map((m) => ({
      name: m.name,
      dosage: [m.dosage, m.dosage_unit].filter(Boolean).join(' '),
      timing: m.time || m.schedule_time || m.frequency || '',
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
};
