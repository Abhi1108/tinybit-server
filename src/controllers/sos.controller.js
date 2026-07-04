const emergencyContactsService = require('../services/emergency-contacts.service');
const sosService = require('../services/sos.service');

const DEFAULT_COLOR = '#F0F4FF';

function isTableMissing(error) {
  return (
    error?.code === '42P01'
    || error?.code === 'PGRST205'
    || error?.code === 'ER_NO_SUCH_TABLE'
    || error?.errno === 1146
  );
}

function readBody(req) {
  return req.body ?? {};
}

/** GET /api/sos/emergency-contacts */
async function listEmergencyContacts(req, res) {
  try {
    const userId = req.auth?.userId ?? req.supabase?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const contacts = await emergencyContactsService.listByUserId(userId);
    return res.json({ success: true, contacts });
  } catch (err) {
    console.error('[sos/emergency-contacts] list:', err.message || err);
    if (isTableMissing(err)) {
      return res.status(501).json({
        success: false,
        message: 'emergency_contacts table is not deployed. Run migration 055_emergency_contacts.sql.',
      });
    }
    return res.status(500).json({ success: false, message: 'Could not load emergency contacts.' });
  }
}

/** POST /api/sos/emergency-contacts */
async function createEmergencyContact(req, res) {
  try {
    const userId = req.auth?.userId ?? req.supabase?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const body = readBody(req);
    const name = String(body.name ?? '').trim();
    const role = String(body.role ?? '').trim();
    const phone = String(body.phone ?? '').trim();
    const color = String(body.color ?? DEFAULT_COLOR).trim() || DEFAULT_COLOR;

    if (!name) {
      return res.status(400).json({ success: false, message: 'Name is required.' });
    }
    if (!phone) {
      return res.status(400).json({ success: false, message: 'Phone number is required.' });
    }

    const contact = await emergencyContactsService.create(userId, { name, role, phone, color });
    return res.json({ success: true, contact });
  } catch (err) {
    console.error('[sos/emergency-contacts] insert:', err.message || err);
    if (isTableMissing(err)) {
      return res.status(501).json({
        success: false,
        message: 'emergency_contacts table is not deployed. Run migration 055_emergency_contacts.sql.',
      });
    }
    return res.status(500).json({ success: false, message: 'Could not save emergency contact.' });
  }
}

/** PATCH /api/sos/emergency-contacts/:id */
async function updateEmergencyContact(req, res) {
  try {
    const userId = req.auth?.userId ?? req.supabase?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const contactId = req.params.id;
    const body = readBody(req);
    const patch = {};

    if (body.name !== undefined) patch.name = String(body.name).trim();
    if (body.role !== undefined) patch.role = String(body.role).trim();
    if (body.phone !== undefined) patch.phone = String(body.phone).trim();
    if (body.color !== undefined) {
      patch.color = String(body.color).trim() || DEFAULT_COLOR;
    }

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ success: false, message: 'No fields to update.' });
    }

    const contact = await emergencyContactsService.update(userId, contactId, patch);

    if (!contact) {
      return res.status(404).json({ success: false, message: 'Emergency contact not found.' });
    }

    return res.json({ success: true, contact });
  } catch (err) {
    console.error('[sos/emergency-contacts] update:', err.message || err);
    if (isTableMissing(err)) {
      return res.status(501).json({
        success: false,
        message: 'emergency_contacts table is not deployed. Run migration 055_emergency_contacts.sql.',
      });
    }
    return res.status(500).json({ success: false, message: 'Could not update emergency contact.' });
  }
}

/** DELETE /api/sos/emergency-contacts/:id */
async function deleteEmergencyContact(req, res) {
  try {
    const userId = req.auth?.userId ?? req.supabase?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const contactId = req.params.id;
    const deleted = await emergencyContactsService.remove(userId, contactId);

    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Emergency contact not found.' });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('[sos/emergency-contacts] delete:', err.message || err);
    if (isTableMissing(err)) {
      return res.status(501).json({
        success: false,
        message: 'emergency_contacts table is not deployed. Run migration 055_emergency_contacts.sql.',
      });
    }
    return res.status(500).json({ success: false, message: 'Could not delete emergency contact.' });
  }
}

/** POST /api/sos/trigger — log SOS event (call-only on device; no SMS). */
async function triggerSos(req, res) {
  try {
    const userId = req.auth.userId;

    const profile = await sosService.getProfileForTrigger(userId);
    if (!profile) {
      return res.status(500).json({ success: false, message: 'Could not load profile' });
    }

    const alert = await sosService.createAlert(userId);

    const elderName = profile.full_name || profile.emergency_name || 'A TinyBit user';

    console.log('[sos/trigger]', {
      userId,
      alertId: alert.id,
      elderName,
      emergency_phone: profile.emergency_phone ?? null,
      channel: 'call-only',
    });

    return res.json({
      success: true,
      message: 'SOS logged. Use the dialer to call your emergency contact.',
    });
  } catch (err) {
    console.error('[sos/trigger]', err.message || err);
    return res.status(500).json({ success: false, message: err.message || 'SOS trigger failed' });
  }
}

module.exports = {
  triggerSos,
  listEmergencyContacts,
  createEmergencyContact,
  updateEmergencyContact,
  deleteEmergencyContact,
};
