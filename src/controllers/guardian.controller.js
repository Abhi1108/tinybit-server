const guardianService = require('../services/guardian.service');
const medicinesService = require('../services/medicines.service');
const medicineLogsService = require('../services/medicine-logs.service');
const healthRecordsService = require('../services/health-records.service');
const healthInsightsService = require('../services/health-insights.service');
const savedDoctorsService = require('../services/saved-doctors.service');
const emergencyContactsService = require('../services/emergency-contacts.service');
const { normalizeCreatePayload, loadRecordBase64 } = require('./health-vault.controller');
const storageService = require('../services/storage.service');
const { mapStorageError } = require('./storage.controller');
const { sendExpoPush } = require('../services/notifications.service');
const paymentsService = require('../services/payments.mysql');
const profilesService = require('../services/profiles.service');
const authUsersService = require('../services/auth-users.service');
const { toE164 } = require('../utils/phone');

async function notifyElderOfMedicineChange(elderId, message) {
  try {
    const token = await guardianService.getElderPushToken(elderId);
    if (token) {
      await sendExpoPush(token, {
        title: 'Medicine Updated',
        body: message,
        data: { type: 'guardian_medicine_update' },
      });
    }
  } catch (err) {
    console.error('notifyElderOfMedicineChange error:', err);
  }
}

async function requireElderConnection(req, res) {
  const guardianId = req.auth?.userId;
  const { elderId } = req.params;
  if (!guardianId) {
    res.status(401).json({ success: false, message: 'Unauthorized' });
    return null;
  }
  if (!elderId) {
    res.status(400).json({ success: false, message: 'elderId is required' });
    return null;
  }
  const connected = await guardianService.isConnectedToElder(guardianId, elderId);
  if (!connected) {
    res.status(403).json({ success: false, message: 'You are not connected to this elder.' });
    return null;
  }
  return elderId;
}

async function sendPushNotification(token, guardianName, relation) {
  await sendExpoPush(token, {
    title: 'Guardian Connection Request',
    body: `${guardianName} wants to be your Guardian (as your ${relation}). Open TinyBit to accept.`,
    data: { type: 'guardian_invite' },
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
  const guardian_id = req.auth?.userId;

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
      req.auth?.email,
    );

    const elderProfile = await guardianService.findProfileByEmail(elder_email);
    const elder_id = elderProfile?.id ?? null;
    const push_token = elderProfile?.push_token ?? null;

    if (await guardianService.hasPendingInvite(guardian_id, elder_email)) {
      return res.status(409).json({ success: false, message: 'A pending invitation already exists for this email' });
    }

    // Mid-cycle tier upgrade gate (CONTEXT.md Q5/Q10, ADR 0003): elder_count counts
    // pending + connected links, so sending this invite itself counts toward the tier —
    // block until the guardian pays the difference if it would cross into a higher tier.
    const currentElderCount = await paymentsService.getElderCountForGuardian(guardian_id);
    const prospectiveElderCount = currentElderCount + 1;
    const guardianProfile = await profilesService.getProfileById(guardian_id);
    const entitledElderCount = guardianProfile?.plan_elder_count ?? 0;

    if (prospectiveElderCount > entitledElderCount) {
      const { order, appliedImmediately } = await paymentsService.createUpgradeOrder(guardian_id, prospectiveElderCount);
      if (!appliedImmediately) {
        return res.status(402).json({
          success: false,
          message: 'Adding this elder requires a payment.',
          code: 'UPGRADE_REQUIRED',
          order,
          razorpay_key_id: process.env.RAZORPAY_KEY_ID || null,
        });
      }
      // appliedImmediately: tier bump had zero/negative delta (e.g. admin lowered prices)
      // and was applied directly to profiles — fall through and let the invite proceed.
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

// POST /api/guardian/elders — ADR 0004: guardian creates a real, immediately-claimable elder
// account directly (the elder isn't on the app yet) — not a pending invite. Creates
// app_users + profiles + guardian_elder_links(status='connected') atomically.
const createElderProfile = async (req, res) => {
  const guardianId = req.auth?.userId;
  if (!guardianId) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  const {
    first_name,
    last_name,
    email,
    mobile,
    mobile_country,
    relation,
    age,
    blood_group,
    biological_sex,
    preferred_language,
    medical_conditions,
    medical_notes,
  } = req.body ?? {};

  if (!first_name || !email || !mobile || !mobile_country || !relation) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  let phoneE164;
  try {
    phoneE164 = toE164(String(mobile), String(mobile_country));
  } catch {
    return res.status(400).json({ success: false, message: 'Invalid mobile number.' });
  }

  try {
    const normalizedEmail = String(email).trim().toLowerCase();

    // Fail loudly on a phone/email already used by a different account (ADR 0004) — never
    // silently attach this data to an unrelated person's profile.
    const [existingByPhone, existingByEmail] = await Promise.all([
      authUsersService.findByPhone(phoneE164),
      authUsersService.findByEmail(normalizedEmail),
    ]);

    if (existingByPhone) {
      return res.status(409).json({
        success: false,
        message: 'This phone number is already registered to an account.',
        code: 'PHONE_TAKEN',
      });
    }
    if (existingByEmail) {
      return res.status(409).json({
        success: false,
        message: 'This email is already registered to an account.',
        code: 'EMAIL_TAKEN',
      });
    }

    // Mid-cycle tier upgrade gate (CONTEXT.md Q5/Q10, ADR 0003): elder_count counts
    // pending + connected links, so creating this shadow elder counts toward the tier —
    // block until the guardian pays the difference if it would cross into a higher tier.
    const currentElderCount = await paymentsService.getElderCountForGuardian(guardianId);
    const prospectiveElderCount = currentElderCount + 1;
    const guardianProfile = await profilesService.getProfileById(guardianId);
    const entitledElderCount = guardianProfile?.plan_elder_count ?? 0;

    if (prospectiveElderCount > entitledElderCount) {
      const { order, appliedImmediately } = await paymentsService.createUpgradeOrder(guardianId, prospectiveElderCount);
      if (!appliedImmediately) {
        return res.status(402).json({
          success: false,
          message: 'Adding this elder requires a payment.',
          code: 'UPGRADE_REQUIRED',
          order,
          razorpay_key_id: process.env.RAZORPAY_KEY_ID || null,
        });
      }
      // appliedImmediately: tier bump had zero/negative delta and was applied directly to
      // profiles — fall through and let the elder profile creation proceed.
    }

    const elder = await guardianService.createElderProfile({
      guardianId,
      firstName: String(first_name).trim(),
      lastName: last_name != null ? String(last_name).trim() : '',
      email: normalizedEmail,
      phoneE164,
      relation,
      age: age ?? null,
      bloodGroup: blood_group ?? null,
      biologicalSex: biological_sex ?? null,
      preferredLanguage: preferred_language ?? null,
      medicalConditions: Array.isArray(medical_conditions) ? medical_conditions : null,
      medicalNotes: medical_notes ?? null,
    });

    return res.json({ success: true, elder });
  } catch (err) {
    console.error('createElderProfile error:', err);
    const status = err.statusCode ?? 500;
    const message = (err?.message && String(err.message).trim())
      ? String(err.message).trim()
      : 'Could not create elder profile. Please try again.';
    return res.status(status).json({ success: false, message });
  }
};

// POST /api/guardian/respond
const respondToInvitation = async (req, res) => {
  const { link_id, action } = req.body;
  const elder_id = req.auth?.userId;

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
  const authEmail = req.auth?.email;
  if (!authEmail) return res.status(401).json({ success: false, message: 'Unauthorized' });

  try {
    // A guardian may invite an elder by email OR by phone (see resolveInviteElderEmail on
    // mobile), which resolves to a synthetic `{digits}@phone.tinybit.app` elder_email. That
    // only equals req.auth.email (app_users.email) when the elder ALSO signed up via phone
    // OTP — a Google-signed-up elder's app_users.email is their real email, so a phone-based
    // invite for them would never match on req.auth.email alone. Match against every
    // identifier this elder is known by: their login email, their profile email (can differ),
    // and the synthetic phone-email derived from their profile's real mobile number.
    const candidateEmails = new Set([authEmail.trim().toLowerCase()]);

    const profile = await profilesService.getProfileById(req.auth.userId);
    if (profile?.email) candidateEmails.add(String(profile.email).trim().toLowerCase());
    if (profile?.mobile) {
      const digits = String(profile.mobile).replace(/\D/g, '');
      if (digits) candidateEmails.add(`${digits}@phone.tinybit.app`);
    }

    const invitations = await guardianService.getPendingInvitations([...candidateEmails]);
    return res.json({ success: true, invitations });
  } catch (err) {
    console.error('getPendingInvitations error:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/guardian/save-push-token
const savePushToken = async (req, res) => {
  const user_id = req.auth?.userId;
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
  const guardianId = req.auth?.userId;
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
  const guardianId = req.auth?.userId;
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
  const guardianId = req.auth?.userId;
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

const VALID_REPORT_PERIODS = new Set(['weekly', 'monthly', 'yearly']);

// GET /api/guardian/reports?period=weekly|monthly|yearly
const guardianReports = async (req, res) => {
  const guardianId = req.auth?.userId;
  if (!guardianId) return res.status(401).json({ success: false, message: 'Unauthorized' });

  const periodRaw = String(req.query.period ?? 'weekly').toLowerCase();
  const period = VALID_REPORT_PERIODS.has(periodRaw) ? periodRaw : 'weekly';

  try {
    const data = await guardianService.getGuardianReports(guardianId, period);
    return res.json({ success: true, data });
  } catch (err) {
    console.error('guardianReports error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

// GET /api/guardian/connected-guardians
const getConnectedGuardians = async (req, res) => {
  const elderId = req.auth?.userId;
  if (!elderId) return res.status(401).json({ success: false, message: 'Unauthorized' });

  try {
    const data = await guardianService.getConnectedGuardians(elderId);
    return res.json({ success: true, data });
  } catch (err) {
    console.error('getConnectedGuardians error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

// GET /api/guardian/elders/:elderId/co-guardians — other guardians also watching this elder
const getElderCoGuardians = async (req, res) => {
  const elderId = await requireElderConnection(req, res);
  if (!elderId) return;
  const guardianId = req.auth?.userId;

  try {
    const all = await guardianService.getConnectedGuardians(elderId);
    const others = all.filter((g) => g.id !== guardianId);
    return res.json({ success: true, data: others });
  } catch (err) {
    console.error('getElderCoGuardians error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

// POST /api/guardian/elders/:elderId/notify-guardians — { message }
const notifyOtherGuardians = async (req, res) => {
  const elderId = await requireElderConnection(req, res);
  if (!elderId) return;
  const guardianId = req.auth?.userId;

  try {
    const message = String(req.body?.message ?? '').trim() || 'Please check on this alert.';
    const allGuardians = await guardianService.getConnectedGuardians(elderId);
    const others = allGuardians.filter((g) => g.id !== guardianId);

    await Promise.all(
      others
        .filter((g) => g.push_token)
        .map((g) => sendExpoPush(g.push_token, {
          title: 'Care Alert',
          body: message,
          data: { type: 'guardian_alert_notify' },
        }).catch(() => {})),
    );

    return res.json({ success: true, notified: others.length });
  } catch (err) {
    console.error('notifyOtherGuardians error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

// GET /api/guardian/elders/:elderId/emergency-contacts
const listElderEmergencyContacts = async (req, res) => {
  const elderId = await requireElderConnection(req, res);
  if (!elderId) return;

  try {
    const contacts = await emergencyContactsService.listByUserId(elderId);
    return res.json({ success: true, contacts });
  } catch (err) {
    console.error('listElderEmergencyContacts error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Could not load emergency contacts.' });
  }
};

// POST /api/guardian/elders/:elderId/emergency-contacts
const createElderEmergencyContact = async (req, res) => {
  const elderId = await requireElderConnection(req, res);
  if (!elderId) return;

  try {
    const { name, role, phone, color } = req.body ?? {};
    if (!name || !phone) {
      return res.status(400).json({ success: false, message: 'name and phone are required.' });
    }
    const contact = await emergencyContactsService.create(elderId, { name, role: role ?? null, phone, color: color ?? null });
    return res.json({ success: true, contact });
  } catch (err) {
    console.error('createElderEmergencyContact error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Could not save emergency contact.' });
  }
};

// POST /api/guardian/elders/:elderId/send-reminder — { message }
const sendElderReminder = async (req, res) => {
  const elderId = await requireElderConnection(req, res);
  if (!elderId) return;

  try {
    const message = String(req.body?.message ?? '').trim();
    if (!message) {
      return res.status(400).json({ success: false, message: 'message is required.' });
    }
    const token = await guardianService.getElderPushToken(elderId);
    if (!token) {
      return res.status(404).json({ success: false, message: 'This elder has no device registered for notifications.' });
    }
    await sendExpoPush(token, {
      title: 'Reminder from your family',
      body: message,
      data: { type: 'guardian_reminder' },
    });
    return res.json({ success: true });
  } catch (err) {
    console.error('sendElderReminder error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Could not send reminder.' });
  }
};

// GET /api/guardian/elders/:elderId/dashboard
const getElderDashboard = async (req, res) => {
  const guardianId = req.auth?.userId;
  const { elderId } = req.params;
  if (!guardianId) return res.status(401).json({ success: false, message: 'Unauthorized' });
  if (!elderId) return res.status(400).json({ success: false, message: 'elderId is required' });

  try {
    const data = await guardianService.getElderDashboardForGuardian(guardianId, elderId);
    return res.json({ success: true, data });
  } catch (err) {
    console.error('getElderDashboard error:', err);
    const status = err.statusCode ?? 500;
    return res.status(status).json({ success: false, message: err.message || 'Server error' });
  }
};

// DELETE /api/guardian/elders/:elderId
const removeElder = async (req, res) => {
  const guardianId = req.auth?.userId;
  const { elderId } = req.params;
  if (!guardianId) return res.status(401).json({ success: false, message: 'Unauthorized' });
  if (!elderId) return res.status(400).json({ success: false, message: 'elderId is required' });

  try {
    const removed = await guardianService.unlinkElder(guardianId, elderId);
    if (!removed) {
      return res.status(404).json({ success: false, message: 'Connection not found.' });
    }
    return res.json({ success: true });
  } catch (err) {
    console.error('removeElder error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

// GET /api/guardian/elders/:elderId/summary
const getElderSummary = async (req, res) => {
  const guardianId = req.auth?.userId;
  const { elderId } = req.params;
  if (!guardianId) return res.status(401).json({ success: false, message: 'Unauthorized' });
  if (!elderId) return res.status(400).json({ success: false, message: 'elderId is required' });

  try {
    const data = await guardianService.getElderSummaryForGuardian(guardianId, elderId);
    return res.json({ success: true, data });
  } catch (err) {
    console.error('getElderSummary error:', err);
    const status = err.statusCode ?? 500;
    return res.status(status).json({ success: false, message: err.message || 'Server error' });
  }
};

// GET /api/guardian/elders/:elderId/medicines
const listElderMedicines = async (req, res) => {
  const elderId = await requireElderConnection(req, res);
  if (!elderId) return;

  try {
    const activeOnly = String(req.query.active ?? 'true').toLowerCase() !== 'false';
    const medicines = await medicinesService.listByUser(elderId, { activeOnly });
    return res.json({ success: true, medicines });
  } catch (err) {
    console.error('listElderMedicines error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Could not load medicines.' });
  }
};

// GET /api/guardian/elders/:elderId/medicines/:id
const getElderMedicine = async (req, res) => {
  const elderId = await requireElderConnection(req, res);
  if (!elderId) return;

  try {
    const medicine = await medicinesService.getById(elderId, req.params.id);
    if (!medicine) {
      return res.status(404).json({ success: false, message: 'Medicine not found.' });
    }
    return res.json({ success: true, medicine });
  } catch (err) {
    console.error('getElderMedicine error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Could not load medicine.' });
  }
};

// POST /api/guardian/elders/:elderId/medicines
const createElderMedicine = async (req, res) => {
  const elderId = await requireElderConnection(req, res);
  if (!elderId) return;

  try {
    const body = req.body ?? {};
    const rawRows = Array.isArray(body.medicines) ? body.medicines : [body];

    if (rawRows.length === 0 || !rawRows[0]?.name?.trim()) {
      return res.status(400).json({ success: false, message: 'Medicine name is required.' });
    }

    const medicines = await medicinesService.create(elderId, rawRows);
    await notifyElderOfMedicineChange(elderId, 'Your guardian added a new medicine to your schedule.');
    return res.json({ success: true, medicines });
  } catch (err) {
    console.error('createElderMedicine error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Could not save medicine.' });
  }
};

// PATCH /api/guardian/elders/:elderId/medicines/:id
const updateElderMedicine = async (req, res) => {
  const elderId = await requireElderConnection(req, res);
  if (!elderId) return;

  try {
    const {
      user_id: _ignoredUserId,
      id: _ignoredId,
      created_at: _ignoredCreatedAt,
      updated_at: _ignoredUpdatedAt,
      ...patch
    } = req.body ?? {};

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update.' });
    }

    const medicine = await medicinesService.update(elderId, req.params.id, patch);
    if (!medicine) {
      return res.status(404).json({ success: false, message: 'Medicine not found.' });
    }

    await notifyElderOfMedicineChange(elderId, 'Your guardian updated a medicine in your schedule.');
    return res.json({ success: true, medicine });
  } catch (err) {
    console.error('updateElderMedicine error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Could not update medicine.' });
  }
};

// DELETE /api/guardian/elders/:elderId/medicines/:id
const deleteElderMedicine = async (req, res) => {
  const elderId = await requireElderConnection(req, res);
  if (!elderId) return;

  try {
    const deleted = await medicinesService.delete(elderId, req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Medicine not found.' });
    }

    await notifyElderOfMedicineChange(elderId, 'Your guardian removed a medicine from your schedule.');
    return res.json({ success: true, id: deleted.id });
  } catch (err) {
    console.error('deleteElderMedicine error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Could not delete medicine.' });
  }
};

// GET /api/guardian/elders/:elderId/medicines/logs
const listElderMedicineLogs = async (req, res) => {
  const elderId = await requireElderConnection(req, res);
  if (!elderId) return;

  try {
    const scope = String(req.query.scope ?? '').toLowerCase();
    let logs;
    if (scope === 'week') {
      logs = await medicineLogsService.listForWeek(elderId);
    } else if (req.query.from && req.query.to) {
      logs = await medicineLogsService.listInRange(
        elderId,
        new Date(String(req.query.from)),
        new Date(String(req.query.to)),
      );
    } else {
      logs = await medicineLogsService.listForDay(elderId);
    }
    return res.json({ success: true, logs });
  } catch (err) {
    console.error('listElderMedicineLogs error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Could not load medicine logs.' });
  }
};

// GET /api/guardian/elders/:elderId/medicines/adherence-week
const getElderMedicineAdherenceWeek = async (req, res) => {
  const guardianId = req.auth?.userId;
  const { elderId } = req.params;
  if (!guardianId) return res.status(401).json({ success: false, message: 'Unauthorized' });
  if (!elderId) return res.status(400).json({ success: false, message: 'elderId is required' });

  try {
    const week = await guardianService.getElderMedicineAdherenceWeek(guardianId, elderId);
    return res.json({ success: true, week });
  } catch (err) {
    console.error('getElderMedicineAdherenceWeek error:', err);
    const status = err.statusCode ?? 500;
    return res.status(status).json({ success: false, message: err.message || 'Server error' });
  }
};

// GET /api/guardian/elders/:elderId/health-records
const listElderHealthRecords = async (req, res) => {
  const elderId = await requireElderConnection(req, res);
  if (!elderId) return;

  try {
    const { category, date_range: dateRange } = req.query ?? {};
    const records = await healthRecordsService.listByUser(elderId, { category, dateRange });
    return res.json({ success: true, records });
  } catch (err) {
    console.error('listElderHealthRecords error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Could not load health records.' });
  }
};

// POST /api/guardian/elders/:elderId/health-records
const createElderHealthRecord = async (req, res) => {
  const elderId = await requireElderConnection(req, res);
  if (!elderId) return;

  try {
    const payload = normalizeCreatePayload(req.body ?? {});

    if (!payload.title) {
      return res.status(400).json({ success: false, message: 'Record title is required.' });
    }
    if (!payload.uri || !/^https?:\/\//i.test(payload.uri)) {
      return res.status(400).json({
        success: false,
        message: 'file_url is required. Upload the file via POST /api/storage/presign-upload first.',
      });
    }

    const record = await healthRecordsService.create(elderId, payload);
    return res.json({ success: true, record });
  } catch (err) {
    console.error('createElderHealthRecord error:', err);
    if (err?.code === 'ER_CHECK_CONSTRAINT_VIOLATED' || err?.errno === 3819) {
      return res.status(400).json({ success: false, message: 'Invalid health record category.' });
    }
    return res.status(500).json({ success: false, message: err.message || 'Could not save health record.' });
  }
};

// POST /api/guardian/elders/:elderId/storage/presign-upload
const presignElderUpload = async (req, res) => {
  const elderId = await requireElderConnection(req, res);
  if (!elderId) return;

  try {
    const body = req.body ?? {};
    const filename = body.filename ?? body.file_name ?? body.fileName;
    const contentType = body.content_type ?? body.contentType ?? body.mime_type ?? body.mimeType;

    if (!filename || !String(filename).trim()) {
      return res.status(400).json({ success: false, message: 'filename is required.' });
    }

    const result = await storageService.createPresignedUpload({
      purpose: body.purpose,
      userId: elderId,
      filename: String(filename).trim(),
      contentType,
    });

    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('presignElderUpload error:', err);
    const mapped = mapStorageError(err, res);
    if (mapped) return mapped;
    return res.status(500).json({ success: false, message: err.message || 'Could not create upload URL.' });
  }
};

// POST /api/guardian/elders/:elderId/storage/presign-download
const presignElderDownload = async (req, res) => {
  const elderId = await requireElderConnection(req, res);
  if (!elderId) return;

  try {
    const key = req.body?.key ?? req.query?.key;
    if (!key || !String(key).trim()) {
      return res.status(400).json({ success: false, message: 'key is required.' });
    }

    const result = await storageService.createPresignedDownload({
      key: String(key).trim(),
      userId: elderId,
    });

    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('presignElderDownload error:', err);
    const mapped = mapStorageError(err, res);
    if (mapped) return mapped;
    return res.status(500).json({ success: false, message: err.message || 'Could not create download URL.' });
  }
};

// DELETE /api/guardian/elders/:elderId/health-records/:id
const deleteElderHealthRecord = async (req, res) => {
  const elderId = await requireElderConnection(req, res);
  if (!elderId) return;

  try {
    const deleted = await healthRecordsService.deleteById(elderId, req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Health record not found.' });
    }
    return res.json({ success: true, id: deleted.id });
  } catch (err) {
    console.error('deleteElderHealthRecord error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Could not delete health record.' });
  }
};

// POST /api/guardian/elders/:elderId/health-records/:id/insights?refresh=true
const getElderHealthRecordInsights = async (req, res) => {
  const elderId = await requireElderConnection(req, res);
  if (!elderId) return;

  try {
    const record = await healthRecordsService.getById(elderId, req.params.id);
    if (!record) {
      return res.status(404).json({ success: false, message: 'Health record not found.' });
    }

    const forceRefresh = String(req.query?.refresh || '').toLowerCase() === 'true';
    if (!forceRefresh && record.ai_insights) {
      return res.json({ success: true, data: record.ai_insights, cached: true, computed_at: record.ai_insights_at });
    }

    const base64 = await loadRecordBase64(record);
    if (!base64) {
      return res.status(400).json({ success: false, message: 'This record has no stored file to analyze.' });
    }

    const insights = await healthInsightsService.runHealthForecast({
      base64,
      mimeType: record.mime_type || 'image/jpeg',
      category: record.category,
      title: record.title,
    });

    const updated = await healthRecordsService.saveInsights(elderId, record.id, insights);
    return res.json({
      success: true,
      data: insights,
      cached: false,
      computed_at: updated?.ai_insights_at ?? null,
    });
  } catch (err) {
    console.error('getElderHealthRecordInsights error:', err);
    return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Could not analyze this record.' });
  }
};

// POST /api/guardian/elders/:elderId/health-records/compare — body: { recordIds: string[] } (2+)
const compareElderHealthRecords = async (req, res) => {
  const elderId = await requireElderConnection(req, res);
  if (!elderId) return;

  try {
    const { recordIds } = req.body ?? {};
    if (!Array.isArray(recordIds) || recordIds.length < 2) {
      return res.status(400).json({ success: false, message: 'Select at least 2 records to compare.' });
    }

    const records = [];
    for (const id of recordIds) {
      const record = await healthRecordsService.getById(elderId, id);
      if (!record) {
        return res.status(404).json({ success: false, message: `Health record ${id} not found.` });
      }
      records.push(record);
    }

    const documents = [];
    for (const record of records) {
      let base64 = null;
      try {
        base64 = await loadRecordBase64(record);
      } catch (err) {
        console.warn(`compareElderHealthRecords: failed to load record ${record.id}`, err.message);
      }
      if (!base64) continue;
      documents.push({
        base64,
        mimeType: record.mime_type || 'image/jpeg',
        category:  record.category,
        title:     record.title,
        date:      record.date,
      });
    }

    const insights = await healthInsightsService.runMultiHealthForecast(documents);
    return res.json({ success: true, data: insights });
  } catch (err) {
    console.error('compareElderHealthRecords error:', err);
    return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Could not compare these records.' });
  }
};

// GET /api/guardian/elders/:elderId/doctors
const listElderDoctors = async (req, res) => {
  const elderId = await requireElderConnection(req, res);
  if (!elderId) return;

  try {
    const doctors = await savedDoctorsService.listByUser(elderId);
    return res.json({ success: true, doctors });
  } catch (err) {
    console.error('listElderDoctors error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Could not load doctors.' });
  }
};

// POST /api/guardian/elders/:elderId/doctors
const createElderDoctor = async (req, res) => {
  const elderId = await requireElderConnection(req, res);
  if (!elderId) return;

  try {
    const { name, phone } = req.body ?? {};
    const doctor = await savedDoctorsService.create(elderId, { name, phone });
    return res.json({ success: true, doctor });
  } catch (err) {
    console.error('createElderDoctor error:', err);
    return res.status(err.statusCode || 500).json({ success: false, message: err.message || 'Could not add doctor.' });
  }
};

// DELETE /api/guardian/elders/:elderId/doctors/:id
const deleteElderDoctor = async (req, res) => {
  const elderId = await requireElderConnection(req, res);
  if (!elderId) return;

  try {
    const deleted = await savedDoctorsService.deleteById(elderId, req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Doctor not found.' });
    }
    return res.json({ success: true });
  } catch (err) {
    console.error('deleteElderDoctor error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Could not delete doctor.' });
  }
};

const getSentInvitations = async (req, res) => {
  const guardianId = req.auth?.userId;
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
  createElderProfile,
  respondToInvitation,
  getPendingInvitations,
  getSentInvitations,
  savePushToken,
  guardianElders,
  guardianAlerts,
  guardianLocation,
  guardianReports,
  getConnectedGuardians,
  removeElder,
  getElderSummary,
  getElderDashboard,
  getElderCoGuardians,
  notifyOtherGuardians,
  listElderEmergencyContacts,
  createElderEmergencyContact,
  sendElderReminder,
  listElderMedicines,
  getElderMedicine,
  createElderMedicine,
  updateElderMedicine,
  deleteElderMedicine,
  listElderMedicineLogs,
  getElderMedicineAdherenceWeek,
  listElderHealthRecords,
  createElderHealthRecord,
  deleteElderHealthRecord,
  getElderHealthRecordInsights,
  compareElderHealthRecords,
  listElderDoctors,
  createElderDoctor,
  deleteElderDoctor,
  presignElderUpload,
  presignElderDownload,
};
