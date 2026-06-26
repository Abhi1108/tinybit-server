const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

const guardianService = require('../services/guardian.service');

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

const STATIC_SAFE_ZONES = [
  { id: 'z1', name: 'Home', note: 'Primary safe zone · 300m radius', badge: { text: 'Primary', bg: '#D1FADF', fg: '#16A34A' } },
  { id: 'z2', name: 'Hospital / Clinic', note: 'Doctor visits', badge: { text: 'Medical', bg: '#E9D5FF', fg: '#7C3AED' } },
  { id: 'z3', name: 'Place of Worship', note: 'Regular morning visits', badge: { text: 'Trusted', bg: '#D1FADF', fg: '#16A34A' } },
  { id: 'z4', name: 'Local Market', note: 'Grocery shopping nearby', badge: { text: 'Allowed', bg: '#D1FADF', fg: '#16A34A' } },
];

// POST /api/guardian/invite
const inviteParent = async (req, res) => {
  const { guardian_name, parent_name, relation, elder_email } = req.body;
  const guardian_id = req.auth?.userId ?? req.supabase?.userId;

  if (!guardian_id) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  if (!parent_name || !relation || !elder_email) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  try {
    await guardianService.ensureGuardianProfile(
      guardian_id,
      guardian_name,
      req.auth?.email ?? req.supabase?.email,
    );

    const elderProfile = await guardianService.findProfileByEmail(elder_email);
    const elder_id = elderProfile?.id ?? null;
    const push_token = elderProfile?.push_token ?? null;

    if (await guardianService.hasPendingInvite(guardian_id, elder_email)) {
      return res.status(409).json({ success: false, message: 'A pending invitation already exists for this email' });
    }

    await guardianService.createInvitation({
      guardian_id,
      elder_id,
      elder_email,
      parent_name,
      relation,
    });

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
    const status = err.statusCode ?? 500;
    const message = (err?.message && String(err.message).trim())
      ? String(err.message).trim()
      : 'Could not send invitation. Please try again.';
    return res.status(status).json({ success: false, message });
  }
};

// POST /api/guardian/respond
const respondToInvitation = async (req, res) => {
  const { link_id, action } = req.body;
  const elder_id = req.auth?.userId ?? req.supabase?.userId;

  if (!link_id || !['accept', 'decline'].includes(action)) {
    return res.status(400).json({ success: false, message: 'Invalid request' });
  }

  try {
    const newStatus = await guardianService.respondToInvitation(link_id, action, elder_id);
    return res.json({ success: true, status: newStatus });
  } catch (err) {
    console.error('respondToInvitation error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/guardian/pending-invitations
const getPendingInvitations = async (req, res) => {
  const elder_email = req.auth?.email ?? req.supabase?.email;
  if (!elder_email) return res.status(401).json({ success: false, message: 'Unauthorized' });

  try {
    const invitations = await guardianService.getPendingInvitations(elder_email);
    return res.json({ success: true, invitations });
  } catch (err) {
    console.error('getPendingInvitations error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/guardian/save-push-token
const savePushToken = async (req, res) => {
  const user_id = req.auth?.userId ?? req.supabase?.userId;
  const { push_token } = req.body;

  if (!user_id || !push_token) {
    return res.status(400).json({ success: false, message: 'Missing user_id or push_token' });
  }

  try {
    await guardianService.savePushToken(user_id, push_token);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/guardian/elders
const guardianElders = async (req, res) => {
  const guardianId = req.auth?.userId ?? req.supabase?.userId;
  if (!guardianId) return res.status(401).json({ success: false, message: 'Unauthorized' });

  try {
    const data = await guardianService.getGuardianEldersDashboard(guardianId);
    return res.json({ success: true, data });
  } catch (err) {
    console.error('guardianElders error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

// GET /api/guardian/alerts
const guardianAlerts = async (req, res) => {
  const guardianId = req.auth?.userId ?? req.supabase?.userId;
  if (!guardianId) return res.status(401).json({ success: false, message: 'Unauthorized' });

  try {
    const data = await guardianService.getGuardianAlerts(guardianId);
    return res.json({ success: true, data });
  } catch (err) {
    console.error('guardianAlerts error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

// GET /api/guardian/location
const guardianLocation = async (req, res) => {
  const guardianId = req.auth?.userId ?? req.supabase?.userId;
  if (!guardianId) return res.status(401).json({ success: false, message: 'Unauthorized' });

  try {
    const elders = await guardianService.getGuardianLocationElders(guardianId);
    return res.json({
      success: true,
      data: {
        elders,
        safeZones: STATIC_SAFE_ZONES,
      },
    });
  } catch (err) {
    console.error('guardianLocation error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

// GET /api/guardian/reports?period=weekly|monthly|yearly
const guardianReports = async (req, res) => {
  const guardianId = req.auth?.userId ?? req.supabase?.userId;
  if (!guardianId) return res.status(401).json({ success: false, message: 'Unauthorized' });

  try {
    const data = await guardianService.getGuardianReports(guardianId);
    return res.json({ success: true, data });
  } catch (err) {
    console.error('guardianReports error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

// GET /api/guardian/connected-guardians
const getConnectedGuardians = async (req, res) => {
  const elderId = req.auth?.userId ?? req.supabase?.userId;
  if (!elderId) return res.status(401).json({ success: false, message: 'Unauthorized' });

  try {
    const data = await guardianService.getConnectedGuardians(elderId);
    return res.json({ success: true, data });
  } catch (err) {
    console.error('getConnectedGuardians error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

const getSentInvitations = async (req, res) => {
  const guardianId = req.auth?.userId ?? req.supabase?.userId;
  if (!guardianId) return res.status(401).json({ success: false, message: 'Unauthorized' });

  try {
    const invitations = await guardianService.listSentInvitations(guardianId);
    return res.json({ success: true, invitations });
  } catch (err) {
    console.error('getSentInvitations error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

module.exports = {
  inviteParent,
  respondToInvitation,
  getPendingInvitations,
  getSentInvitations,
  savePushToken,
  guardianElders,
  guardianAlerts,
  guardianLocation,
  guardianReports,
  getConnectedGuardians,
};
