const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

async function supabaseAdmin(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(options.headers ?? {}),
    },
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, data: text ? JSON.parse(text) : null };
}

// POST /api/guardian/invite
// Body: { guardian_id, guardian_name, parent_name, relation, elder_email }
const inviteParent = async (req, res) => {
  const { guardian_id, guardian_name, parent_name, relation, elder_email } = req.body;

  if (!guardian_id || !parent_name || !relation || !elder_email) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  try {
    // Look up the elder's profile by email to get their id and push token
    const elderRes = await supabaseAdmin(
      `/profiles?email=eq.${encodeURIComponent(elder_email)}&select=id,push_token`,
    );

    const elderProfile = elderRes.data?.[0] ?? null;
    const elder_id = elderProfile?.id ?? null;
    const push_token = elderProfile?.push_token ?? null;

    // Check for an existing pending invite from this guardian to this email
    const existingRes = await supabaseAdmin(
      `/guardian_elder_links?guardian_id=eq.${guardian_id}&elder_email=eq.${encodeURIComponent(elder_email)}&status=eq.pending`,
    );
    if (existingRes.data?.length > 0) {
      return res.status(409).json({ success: false, message: 'A pending invitation already exists for this email' });
    }

    // Insert the link record
    const insertRes = await supabaseAdmin('/guardian_elder_links', {
      method: 'POST',
      body: JSON.stringify({
        guardian_id,
        elder_id,
        elder_email,
        parent_name,
        relation,
        status: 'pending',
      }),
    });

    if (!insertRes.ok) {
      throw new Error(insertRes.data?.message ?? 'Failed to create invitation');
    }

    // Send push notification if elder has a token
    if (push_token) {
      await sendPushNotification(push_token, guardian_name, relation);
    }

    return res.json({
      success: true,
      message: elder_id
        ? 'Invitation sent and elder account linked.'
        : 'Invitation created. Elder will be linked when they sign up.',
      elder_found: !!elder_id,
    });
  } catch (err) {
    console.error('inviteParent error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/guardian/respond
// Body: { link_id, action: 'accept' | 'decline' }
// Called by elder to accept or decline a connection
const respondToInvitation = async (req, res) => {
  const { link_id, action } = req.body;
  const elder_id = req.supabase?.userId;

  if (!link_id || !['accept', 'decline'].includes(action)) {
    return res.status(400).json({ success: false, message: 'Invalid request' });
  }

  const newStatus = action === 'accept' ? 'connected' : 'declined';

  try {
    const updateRes = await supabaseAdmin(
      `/guardian_elder_links?id=eq.${link_id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus, elder_id }),
      },
    );

    if (!updateRes.ok) throw new Error('Failed to update invitation');

    return res.json({ success: true, status: newStatus });
  } catch (err) {
    console.error('respondToInvitation error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/guardian/pending-invitations
// Returns pending invitations for the authenticated elder
const getPendingInvitations = async (req, res) => {
  const elder_email = req.supabase?.email;
  if (!elder_email) return res.status(401).json({ success: false, message: 'Unauthorized' });

  try {
    const result = await supabaseAdmin(
      `/guardian_elder_links?elder_email=eq.${encodeURIComponent(elder_email)}&status=eq.pending&select=id,guardian_id,parent_name,relation,created_at`,
    );

    // Enrich with guardian names
    const links = result.data ?? [];
    const enriched = await Promise.all(
      links.map(async (link) => {
        const gRes = await supabaseAdmin(`/profiles?id=eq.${link.guardian_id}&select=full_name`);
        return { ...link, guardian_name: gRes.data?.[0]?.full_name ?? 'Unknown' };
      }),
    );

    return res.json({ success: true, invitations: enriched });
  } catch (err) {
    console.error('getPendingInvitations error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/guardian/save-push-token
// Body: { push_token }
const savePushToken = async (req, res) => {
  const user_id = req.supabase?.userId;
  const { push_token } = req.body;

  if (!user_id || !push_token) {
    return res.status(400).json({ success: false, message: 'Missing user_id or push_token' });
  }

  try {
    await supabaseAdmin(`/profiles?id=eq.${user_id}`, {
      method: 'PATCH',
      body: JSON.stringify({ push_token }),
    });
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

async function sendPushNotification(token, guardianName, relation) {
  await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: token,
      title: 'Guardian Connection Request',
      body: `${guardianName} wants to be your Guardian (as your ${relation}). Open TinyBit to accept.`,
      data: { type: 'guardian_invite' },
      sound: 'default',
    }),
  });
}

// ─── NEW: Guardian dashboard endpoints ────────────────────────────────────────
const { supabaseClient } = require('../config/supabase');

// GET /api/guardian/elders
const guardianElders = async (req, res) => {
  const guardianId = req.supabase?.userId;
  if (!guardianId) return res.status(401).json({ success: false, message: 'Unauthorized' });

  try {
    const { data: links, error: linksErr } = await supabaseClient
      .from('guardian_elder_links')
      .select('elder_id, parent_name, relation, elder_email')
      .eq('guardian_id', guardianId)
      .eq('status', 'connected');

    if (linksErr) throw linksErr;
    if (!links || links.length === 0) return res.json({ success: true, data: [] });

    const elderIds = links.map(l => l.elder_id).filter(Boolean);
    const today = new Date().toISOString().split('T')[0];

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

    const pMap = {};
    (profilesRes.data || []).forEach(p => { pMap[p.id] = p; });

    const checkinIds = new Set((checkinsRes.data || []).map(c => c.user_id));
    const medsByUser = {};
    (medsRes.data || []).forEach(m => {
      if (!medsByUser[m.user_id]) medsByUser[m.user_id] = [];
      medsByUser[m.user_id].push(m.id);
    });
    const loggedMeds = new Set((logsRes.data || []).map(l => l.medicine_id));

    const data = links.map(link => {
      const profile = pMap[link.elder_id] || null;
      const meds = medsByUser[link.elder_id] || [];
      return {
        elderId:       link.elder_id,
        parentName:    link.parent_name,
        relation:      link.relation,
        elderEmail:    link.elder_email,
        profile:       profile ? { fullName: profile.full_name, age: profile.age, location: profile.location } : null,
        checkedInToday: checkinIds.has(link.elder_id),
        medicineCount: meds.length,
        medicinesDone: meds.filter(id => loggedMeds.has(id)).length,
      };
    });

    return res.json({ success: true, data });
  } catch (err) {
    console.error('guardianElders error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

// GET /api/guardian/alerts
const guardianAlerts = async (req, res) => {
  const guardianId = req.supabase?.userId;
  if (!guardianId) return res.status(401).json({ success: false, message: 'Unauthorized' });

  try {
    const { data: links, error: linksErr } = await supabaseClient
      .from('guardian_elder_links')
      .select('elder_id, parent_name')
      .eq('guardian_id', guardianId)
      .eq('status', 'connected');

    if (linksErr) throw linksErr;
    if (!links || links.length === 0) return res.json({ success: true, data: [] });

    const today = new Date().toISOString().split('T')[0];
    const t     = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    const hour  = new Date().getHours();
    const generated = [];

    for (const link of links) {
      const name = link.parent_name.toUpperCase();
      const eid  = link.elder_id;

      const [checkinRes, medsRes] = await Promise.all([
        supabaseClient.from('daily_checkins').select('id')
          .eq('user_id', eid)
          .gte('created_at', `${today}T00:00:00Z`)
          .lte('created_at', `${today}T23:59:59Z`)
          .maybeSingle(),
        supabaseClient.from('medicines').select('id, name').eq('user_id', eid).eq('is_active', true),
      ]);

      if (!checkinRes.data && hour >= 9) {
        generated.push({
          id:    `checkin_${eid}`,
          tag:   { text: 'Urgent', bg: '#FCEEEF', fg: '#DC2626' },
          who:   name,
          title: 'Morning Check-In Not Completed',
          body:  `${link.parent_name} has not completed today's check-in. Please check on them.`,
          time:  `Today · ${t}`,
        });
      }

      const meds = medsRes.data || [];
      if (meds.length > 0) {
        const { data: logs } = await supabaseClient
          .from('medicine_logs')
          .select('medicine_id')
          .eq('user_id', eid)
          .gte('taken_at', `${today}T00:00:00Z`)
          .lte('taken_at', `${today}T23:59:59Z`);

        const loggedIds = new Set((logs || []).map(l => l.medicine_id));
        const missed    = meds.filter(m => !loggedIds.has(m.id));

        if (missed.length > 0) {
          const names = missed.slice(0, 2).map(m => m.name).join(', ');
          generated.push({
            id:    `med_${eid}`,
            tag:   { text: 'Attention', bg: '#FFF3E0', fg: '#F59E0B' },
            who:   name,
            title: `${missed.length} Medicine${missed.length > 1 ? 's' : ''} Not Taken`,
            body:  `${names}${missed.length > 2 ? ` and ${missed.length - 2} more` : ''} not confirmed taken today.`,
            time:  `Today · ${t}`,
          });
        } else {
          generated.push({
            id:    `med_ok_${eid}`,
            tag:   { text: 'Good Going', bg: '#D1FADF', fg: '#16A34A' },
            who:   name,
            title: 'All Medicines Taken Today',
            body:  `${link.parent_name} has confirmed all ${meds.length} medicine${meds.length > 1 ? 's' : ''} today.`,
            time:  `Today · ${t}`,
          });
        }
      }
    }

    if (generated.length === 0) {
      generated.push({
        id:    'all_ok',
        tag:   { text: 'Good Going', bg: '#D1FADF', fg: '#16A34A' },
        who:   'ALL',
        title: 'Everything looks good!',
        body:  'No urgent alerts right now. All family members are on track.',
        time:  `Today · ${t}`,
      });
    }

    return res.json({ success: true, data: generated });
  } catch (err) {
    console.error('guardianAlerts error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

// GET /api/guardian/location
const guardianLocation = async (req, res) => {
  const guardianId = req.supabase?.userId;
  if (!guardianId) return res.status(401).json({ success: false, message: 'Unauthorized' });

  try {
    const { data: links, error: linksErr } = await supabaseClient
      .from('guardian_elder_links')
      .select('elder_id, parent_name, relation')
      .eq('guardian_id', guardianId)
      .eq('status', 'connected');

    if (linksErr) throw linksErr;

    const list = links || [];
    const ids  = list.map(l => l.elder_id).filter(Boolean);
    const pMap = {};

    if (ids.length > 0) {
      const { data: profiles } = await supabaseClient
        .from('profiles')
        .select('id, full_name, location')
        .in('id', ids);
      (profiles || []).forEach(p => { pMap[p.id] = p; });
    }

    const elders = list.map(link => ({
      elderId:  link.elder_id,
      name:     pMap[link.elder_id]?.full_name || link.parent_name,
      relation: link.relation,
      location: pMap[link.elder_id]?.location || null,
    }));

    return res.json({
      success: true,
      data: {
        elders,
        safeZones: [
          { id: 'z1', name: 'Home',              note: 'Primary safe zone · 300m radius', badge: { text: 'Primary', bg: '#D1FADF', fg: '#16A34A' } },
          { id: 'z2', name: 'Hospital / Clinic', note: 'Doctor visits',                   badge: { text: 'Medical',  bg: '#E9D5FF', fg: '#7C3AED' } },
          { id: 'z3', name: 'Place of Worship',  note: 'Regular morning visits',          badge: { text: 'Trusted',  bg: '#D1FADF', fg: '#16A34A' } },
          { id: 'z4', name: 'Local Market',      note: 'Grocery shopping nearby',         badge: { text: 'Allowed',  bg: '#D1FADF', fg: '#16A34A' } },
        ],
      },
    });
  } catch (err) {
    console.error('guardianLocation error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

// GET /api/guardian/reports?period=weekly|monthly|yearly
const guardianReports = async (req, res) => {
  const guardianId = req.supabase?.userId;
  if (!guardianId) return res.status(401).json({ success: false, message: 'Unauthorized' });

  const emptyMetrics = { medAdherence: '--', medTrend: '--', avgMood: '--', moodTrend: '--', checkinStreak: '--', avgSleep: '--' };

  try {
    const { data: links, error: linksErr } = await supabaseClient
      .from('guardian_elder_links')
      .select('elder_id, parent_name')
      .eq('guardian_id', guardianId)
      .eq('status', 'connected')
      .limit(1);

    if (linksErr) throw linksErr;
    if (!links || links.length === 0) {
      return res.json({ success: true, data: { elderName: 'Elder', bars: [0,0,0,0,0,0,0], metrics: emptyMetrics } });
    }

    const elderId   = links[0].elder_id;
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

    const moodMap = {};
    (moodsRes.data || []).forEach(m => { moodMap[String(m.created_at).slice(0, 10)] = m.mood_score; });
    const bars = dates.map(d => moodMap[d] ? moodMap[d] * 20 : 0);

    const activeMeds  = medsRes.data?.length ?? 0;
    const logCount    = logsRes.data?.length ?? 0;
    const maxPossible = activeMeds * 7;
    const adherence   = maxPossible > 0 ? Math.round((logCount / maxPossible) * 100) : null;

    const moods        = moodsRes.data || [];
    const avgMoodScore = moods.length > 0
      ? (moods.reduce((s, m) => s + m.mood_score, 0) / moods.length).toFixed(1)
      : null;

    const checkinDates = new Set((checkinsRes.data || []).map(c => String(c.created_at).slice(0, 10)));
    let streak = 0;
    for (let i = dates.length - 1; i >= 0; i--) {
      if (checkinDates.has(dates[i])) streak++;
      else break;
    }

    const sleepRows = sleepRes.data || [];
    const avgSleep  = sleepRows.length > 0
      ? (sleepRows.reduce((s, r) => s + Number(r.sleep_hours), 0) / sleepRows.length).toFixed(1)
      : null;

    return res.json({
      success: true,
      data: {
        elderName,
        bars,
        metrics: {
          medAdherence:  adherence != null ? `${adherence}%` : '--',
          medTrend:      adherence != null ? (adherence >= 80 ? '+Good' : 'Low') : '--',
          avgMood:       avgMoodScore ? `${avgMoodScore}/5` : '--',
          moodTrend:     avgMoodScore ? (Number(avgMoodScore) >= 3.5 ? 'Good' : 'Low') : '--',
          checkinStreak: `${streak}d`,
          avgSleep:      avgSleep ? `${avgSleep}h` : '--',
        },
      },
    });
  } catch (err) {
    console.error('guardianReports error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

// GET /api/guardian/connected-guardians
// Returns connected guardians for the authenticated elder
const getConnectedGuardians = async (req, res) => {
  const elderId = req.supabase?.userId;
  if (!elderId) return res.status(401).json({ success: false, message: 'Unauthorized' });

  try {
    const { data: links, error: linksErr } = await supabaseClient
      .from('guardian_elder_links')
      .select('guardian_id, relation')
      .eq('elder_id', elderId)
      .eq('status', 'connected');

    if (linksErr) throw linksErr;
    if (!links || links.length === 0) return res.json({ success: true, data: [] });

    const guardianIds = links.map((link) => link.guardian_id).filter(Boolean);
    const { data: profiles, error: profErr } = await supabaseClient
      .from('profiles')
      .select('id, full_name, location, mobile')
      .in('id', guardianIds);

    if (profErr) throw profErr;

    const profileMap = {};
    (profiles || []).forEach((profile) => { profileMap[profile.id] = profile; });

    const guardians = links.map((link) => ({
      id:       link.guardian_id,
      name:     profileMap[link.guardian_id]?.full_name ?? 'Guardian',
      relation: link.relation,
      location: profileMap[link.guardian_id]?.location ?? null,
      phone:    profileMap[link.guardian_id]?.mobile ?? null,
    }));

    return res.json({ success: true, data: guardians });
  } catch (err) {
    console.error('getConnectedGuardians error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

module.exports = { inviteParent, respondToInvitation, getPendingInvitations, savePushToken, guardianElders, guardianAlerts, guardianLocation, guardianReports, getConnectedGuardians };
