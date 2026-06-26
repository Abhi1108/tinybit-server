const { supabaseClient } = require('../config/supabase');

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

function supabaseErrorMessage(error, fallback) {
  if (!error) return fallback;
  if (typeof error.message === 'string' && error.message.trim()) return error.message.trim();
  if (typeof error.details === 'string' && error.details.trim()) return error.details.trim();
  if (typeof error.hint === 'string' && error.hint.trim()) return error.hint.trim();
  return fallback;
}

async function ensureGuardianProfile(guardianId, guardianName, email) {
  const { data: existing } = await supabaseClient
    .from('profiles')
    .select('id')
    .eq('id', guardianId)
    .maybeSingle();

  if (existing?.id) return;

  const { error } = await supabaseClient.from('profiles').insert({
    id: guardianId,
    email: email ?? null,
    full_name: guardianName || email || 'Family member',
    role: 'guardian',
    plan_type: 'free',
    plan_status: 'active',
    plan_currency: 'INR',
    streak: 0,
  });

  if (error) {
    const err = new Error(supabaseErrorMessage(error, 'Complete your profile before inviting an elder.'));
    err.statusCode = 400;
    throw err;
  }
}

async function findProfileByEmail(elderEmail) {
  const { data, error } = await supabaseClient
    .from('profiles')
    .select('id, push_token')
    .eq('email', elderEmail)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function hasPendingInvite(guardianId, elderEmail) {
  const { data, error } = await supabaseClient
    .from('guardian_elder_links')
    .select('id')
    .eq('guardian_id', guardianId)
    .eq('elder_email', elderEmail)
    .eq('status', 'pending');

  if (error) throw error;
  return (data?.length ?? 0) > 0;
}

async function createInvitation({ guardian_id, elder_id, elder_email, parent_name, relation }) {
  const { error } = await supabaseClient.from('guardian_elder_links').insert({
    guardian_id,
    elder_id,
    elder_email,
    parent_name,
    relation,
    status: 'pending',
  });

  if (error) {
    throw new Error(supabaseErrorMessage(error, 'Failed to create invitation'));
  }
}

async function respondToInvitation(linkId, action, elderId) {
  const newStatus = action === 'accept' ? 'connected' : 'declined';

  const { error } = await supabaseClient
    .from('guardian_elder_links')
    .update({ status: newStatus, elder_id: elderId })
    .eq('id', linkId);

  if (error) throw new Error('Failed to update invitation');
  return newStatus;
}

async function getPendingInvitations(elderEmail) {
  const { data: links, error } = await supabaseClient
    .from('guardian_elder_links')
    .select('id, guardian_id, parent_name, relation, created_at')
    .eq('elder_email', elderEmail)
    .eq('status', 'pending');

  if (error) throw error;

  const enriched = await Promise.all(
    (links ?? []).map(async (link) => {
      const { data: profile } = await supabaseClient
        .from('profiles')
        .select('full_name')
        .eq('id', link.guardian_id)
        .maybeSingle();

      return { ...link, guardian_name: profile?.full_name ?? 'Unknown' };
    }),
  );

  return enriched;
}

async function savePushToken(userId, pushToken) {
  const { error } = await supabaseClient
    .from('profiles')
    .update({ push_token: pushToken })
    .eq('id', userId);

  if (error) throw error;
}

async function getConnectedLinksForGuardian(guardianId, select = 'elder_id, parent_name, relation, elder_email') {
  const { data, error } = await supabaseClient
    .from('guardian_elder_links')
    .select(select)
    .eq('guardian_id', guardianId)
    .eq('status', 'connected');

  if (error) throw error;
  return data ?? [];
}

async function getGuardianEldersDashboard(guardianId) {
  const links = await getConnectedLinksForGuardian(guardianId);
  if (links.length === 0) return [];

  const elderIds = links.map((l) => l.elder_id).filter(Boolean);
  const today = todayISO();

  const [profilesRes, checkinsRes, medsRes, logsRes] = await Promise.all([
    supabaseClient.from('profiles').select('id, full_name, age, location').in('id', elderIds),
    supabaseClient.from('daily_checkins').select('user_id, created_at')
      .gte('created_at', `${today}T00:00:00Z`)
      .lte('created_at', `${today}T23:59:59Z`)
      .in('user_id', elderIds),
    supabaseClient.from('medicines').select('id, user_id').eq('is_active', true).in('user_id', elderIds),
    supabaseClient.from('medicine_logs').select('medicine_id, user_id')
      .gte('taken_at', `${today}T00:00:00Z`)
      .lte('taken_at', `${today}T23:59:59Z`)
      .in('user_id', elderIds),
  ]);

  if (profilesRes.error) throw profilesRes.error;
  if (checkinsRes.error) throw checkinsRes.error;
  if (medsRes.error) throw medsRes.error;
  if (logsRes.error) throw logsRes.error;

  const pMap = {};
  (profilesRes.data || []).forEach((p) => { pMap[p.id] = p; });

  const checkinIds = new Set((checkinsRes.data || []).map((c) => c.user_id));
  const medsByUser = {};
  (medsRes.data || []).forEach((m) => {
    if (!medsByUser[m.user_id]) medsByUser[m.user_id] = [];
    medsByUser[m.user_id].push(m.id);
  });
  const loggedMeds = new Set((logsRes.data || []).map((l) => l.medicine_id));

  return links.map((link) => {
    const profile = pMap[link.elder_id] || null;
    const meds = medsByUser[link.elder_id] || [];
    return {
      elderId: link.elder_id,
      parentName: link.parent_name,
      relation: link.relation,
      elderEmail: link.elder_email,
      profile: profile
        ? { fullName: profile.full_name, age: profile.age, location: profile.location }
        : null,
      checkedInToday: checkinIds.has(link.elder_id),
      medicineCount: meds.length,
      medicinesDone: meds.filter((id) => loggedMeds.has(id)).length,
    };
  });
}

async function getGuardianAlerts(guardianId) {
  const links = await getConnectedLinksForGuardian(guardianId, 'elder_id, parent_name');
  if (links.length === 0) return [];

  const today = todayISO();
  const t = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  const hour = new Date().getHours();
  const generated = [];

  for (const link of links) {
    const name = link.parent_name.toUpperCase();
    const eid = link.elder_id;

    const [checkinRes, medsRes] = await Promise.all([
      supabaseClient.from('daily_checkins').select('id')
        .eq('user_id', eid)
        .gte('created_at', `${today}T00:00:00Z`)
        .lte('created_at', `${today}T23:59:59Z`)
        .maybeSingle(),
      supabaseClient.from('medicines').select('id, name').eq('user_id', eid).eq('is_active', true),
    ]);

    if (checkinRes.error) throw checkinRes.error;
    if (medsRes.error) throw medsRes.error;

    if (!checkinRes.data && hour >= 9) {
      generated.push({
        id: `checkin_${eid}`,
        tag: { text: 'Urgent', bg: '#FCEEEF', fg: '#DC2626' },
        who: name,
        title: 'Morning Check-In Not Completed',
        body: `${link.parent_name} has not completed today's check-in. Please check on them.`,
        time: `Today · ${t}`,
      });
    }

    const meds = medsRes.data || [];
    if (meds.length > 0) {
      const { data: logs, error: logsErr } = await supabaseClient
        .from('medicine_logs')
        .select('medicine_id')
        .eq('user_id', eid)
        .gte('taken_at', `${today}T00:00:00Z`)
        .lte('taken_at', `${today}T23:59:59Z`);

      if (logsErr) throw logsErr;

      const loggedIds = new Set((logs || []).map((l) => l.medicine_id));
      const missed = meds.filter((m) => !loggedIds.has(m.id));

      if (missed.length > 0) {
        const names = missed.slice(0, 2).map((m) => m.name).join(', ');
        generated.push({
          id: `med_${eid}`,
          tag: { text: 'Attention', bg: '#FFF3E0', fg: '#F59E0B' },
          who: name,
          title: `${missed.length} Medicine${missed.length > 1 ? 's' : ''} Not Taken`,
          body: `${names}${missed.length > 2 ? ` and ${missed.length - 2} more` : ''} not confirmed taken today.`,
          time: `Today · ${t}`,
        });
      } else {
        generated.push({
          id: `med_ok_${eid}`,
          tag: { text: 'Good Going', bg: '#D1FADF', fg: '#16A34A' },
          who: name,
          title: 'All Medicines Taken Today',
          body: `${link.parent_name} has confirmed all ${meds.length} medicine${meds.length > 1 ? 's' : ''} today.`,
          time: `Today · ${t}`,
        });
      }
    }
  }

  if (generated.length === 0) {
    generated.push({
      id: 'all_ok',
      tag: { text: 'Good Going', bg: '#D1FADF', fg: '#16A34A' },
      who: 'ALL',
      title: 'Everything looks good!',
      body: 'No urgent alerts right now. All family members are on track.',
      time: `Today · ${t}`,
    });
  }

  return generated;
}

async function getGuardianLocationElders(guardianId) {
  const links = await getConnectedLinksForGuardian(guardianId, 'elder_id, parent_name, relation');
  const ids = links.map((l) => l.elder_id).filter(Boolean);
  const pMap = {};

  if (ids.length > 0) {
    const { data: profiles, error } = await supabaseClient
      .from('profiles')
      .select('id, full_name, location')
      .in('id', ids);

    if (error) throw error;
    (profiles || []).forEach((p) => { pMap[p.id] = p; });
  }

  return links.map((link) => ({
    elderId: link.elder_id,
    name: pMap[link.elder_id]?.full_name || link.parent_name,
    relation: link.relation,
    location: pMap[link.elder_id]?.location || null,
  }));
}

async function getGuardianReports(guardianId) {
  const emptyMetrics = {
    medAdherence: '--',
    medTrend: '--',
    avgMood: '--',
    moodTrend: '--',
    checkinStreak: '--',
    avgSleep: '--',
  };

  const { data: links, error: linksErr } = await supabaseClient
    .from('guardian_elder_links')
    .select('elder_id, parent_name')
    .eq('guardian_id', guardianId)
    .eq('status', 'connected')
    .limit(1);

  if (linksErr) throw linksErr;
  if (!links || links.length === 0) {
    return { elderName: 'Elder', bars: [0, 0, 0, 0, 0, 0, 0], metrics: emptyMetrics };
  }

  const elderId = links[0].elder_id;
  const elderName = links[0].parent_name.split(' ')[0].toUpperCase();

  const dates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return d.toISOString().split('T')[0];
  });
  const weekStart = dates[0];

  const [moodsRes, medsRes, logsRes, checkinsRes, sleepRes] = await Promise.all([
    supabaseClient.from('mood_entries').select('created_at, mood_score').eq('user_id', elderId).gte('created_at', `${weekStart}T00:00:00Z`),
    supabaseClient.from('medicines').select('id').eq('user_id', elderId).eq('is_active', true),
    supabaseClient.from('medicine_logs').select('medicine_id').eq('user_id', elderId).gte('taken_at', `${weekStart}T00:00:00Z`),
    supabaseClient.from('daily_checkins').select('created_at').eq('user_id', elderId).gte('created_at', `${weekStart}T00:00:00Z`),
    supabaseClient.from('daily_checkins').select('sleep_hours').eq('user_id', elderId).gte('created_at', `${weekStart}T00:00:00Z`).not('sleep_hours', 'is', null),
  ]);

  if (moodsRes.error) throw moodsRes.error;
  if (medsRes.error) throw medsRes.error;
  if (logsRes.error) throw logsRes.error;
  if (checkinsRes.error) throw checkinsRes.error;
  if (sleepRes.error) throw sleepRes.error;

  const moodMap = {};
  (moodsRes.data || []).forEach((m) => { moodMap[String(m.created_at).slice(0, 10)] = m.mood_score; });
  const bars = dates.map((d) => (moodMap[d] ? moodMap[d] * 20 : 0));

  const activeMeds = medsRes.data?.length ?? 0;
  const logCount = logsRes.data?.length ?? 0;
  const maxPossible = activeMeds * 7;
  const adherence = maxPossible > 0 ? Math.round((logCount / maxPossible) * 100) : null;

  const moods = moodsRes.data || [];
  const avgMoodScore = moods.length > 0
    ? (moods.reduce((s, m) => s + m.mood_score, 0) / moods.length).toFixed(1)
    : null;

  const checkinDates = new Set((checkinsRes.data || []).map((c) => String(c.created_at).slice(0, 10)));
  let streak = 0;
  for (let i = dates.length - 1; i >= 0; i--) {
    if (checkinDates.has(dates[i])) streak++;
    else break;
  }

  const sleepRows = sleepRes.data || [];
  const avgSleep = sleepRows.length > 0
    ? (sleepRows.reduce((s, r) => s + Number(r.sleep_hours), 0) / sleepRows.length).toFixed(1)
    : null;

  return {
    elderName,
    bars,
    metrics: {
      medAdherence: adherence != null ? `${adherence}%` : '--',
      medTrend: adherence != null ? (adherence >= 80 ? '+Good' : 'Low') : '--',
      avgMood: avgMoodScore ? `${avgMoodScore}/5` : '--',
      moodTrend: avgMoodScore ? (Number(avgMoodScore) >= 3.5 ? 'Good' : 'Low') : '--',
      checkinStreak: `${streak}d`,
      avgSleep: avgSleep ? `${avgSleep}h` : '--',
    },
  };
}

async function getConnectedGuardians(elderId) {
  const { data: links, error: linksErr } = await supabaseClient
    .from('guardian_elder_links')
    .select('guardian_id, relation')
    .eq('elder_id', elderId)
    .eq('status', 'connected');

  if (linksErr) throw linksErr;
  if (!links || links.length === 0) return [];

  const guardianIds = links.map((link) => link.guardian_id).filter(Boolean);
  const { data: profiles, error: profErr } = await supabaseClient
    .from('profiles')
    .select('id, full_name, location, mobile')
    .in('id', guardianIds);

  if (profErr) throw profErr;

  const profileMap = {};
  (profiles || []).forEach((profile) => { profileMap[profile.id] = profile; });

  return links.map((link) => ({
    id: link.guardian_id,
    name: profileMap[link.guardian_id]?.full_name ?? 'Guardian',
    relation: link.relation,
    location: profileMap[link.guardian_id]?.location ?? null,
    phone: profileMap[link.guardian_id]?.mobile ?? null,
  }));
}

module.exports = {
  ensureGuardianProfile,
  findProfileByEmail,
  hasPendingInvite,
  createInvitation,
  respondToInvitation,
  getPendingInvitations,
  savePushToken,
  getGuardianEldersDashboard,
  getGuardianAlerts,
  getGuardianLocationElders,
  getGuardianReports,
  getConnectedGuardians,
};
