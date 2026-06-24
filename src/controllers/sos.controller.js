const { supabaseClient } = require('../config/supabase');

const DEFAULT_COLOR = '#F0F4FF';

function isTableMissing(error) {
  return error?.code === '42P01' || error?.code === 'PGRST205';
}

function readBody(req) {
  return req.body ?? {};
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

    const { data, error } = await supabaseClient
      .from('emergency_contacts')
      .insert({
        user_id: userId,
        name,
        role,
        phone,
        color,
      })
      .select('id, name, role, phone, color')
      .single();

    if (error) {
      console.error('[sos/emergency-contacts] insert:', error.message);
      if (isTableMissing(error)) {
        return res.status(501).json({
          success: false,
          message: 'emergency_contacts table is not deployed. Run migration 055_emergency_contacts.sql.',
        });
      }
      return res.status(500).json({ success: false, message: 'Could not save emergency contact.' });
    }

    return res.json({ success: true, contact: data });
  } catch (err) {
    console.error('[sos/emergency-contacts] create', err);
    return res.status(500).json({ success: false, message: err.message || 'Could not save emergency contact.' });
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

    const { data, error } = await supabaseClient
      .from('emergency_contacts')
      .update(patch)
      .eq('id', contactId)
      .eq('user_id', userId)
      .select('id, name, role, phone, color')
      .single();

    if (error) {
      console.error('[sos/emergency-contacts] update:', error.message);
      if (isTableMissing(error)) {
        return res.status(501).json({
          success: false,
          message: 'emergency_contacts table is not deployed. Run migration 055_emergency_contacts.sql.',
        });
      }
      return res.status(500).json({ success: false, message: 'Could not update emergency contact.' });
    }

    if (!data) {
      return res.status(404).json({ success: false, message: 'Emergency contact not found.' });
    }

    return res.json({ success: true, contact: data });
  } catch (err) {
    console.error('[sos/emergency-contacts] update', err);
    return res.status(500).json({ success: false, message: err.message || 'Could not update emergency contact.' });
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
    const { data, error } = await supabaseClient
      .from('emergency_contacts')
      .delete()
      .eq('id', contactId)
      .eq('user_id', userId)
      .select('id')
      .single();

    if (error) {
      console.error('[sos/emergency-contacts] delete:', error.message);
      if (isTableMissing(error)) {
        return res.status(501).json({
          success: false,
          message: 'emergency_contacts table is not deployed. Run migration 055_emergency_contacts.sql.',
        });
      }
      return res.status(500).json({ success: false, message: 'Could not delete emergency contact.' });
    }

    if (!data) {
      return res.status(404).json({ success: false, message: 'Emergency contact not found.' });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('[sos/emergency-contacts] delete', err);
    return res.status(500).json({ success: false, message: err.message || 'Could not delete emergency contact.' });
  }
}

/** POST /api/sos/trigger — log SOS event (call-only on device; no SMS). */
async function triggerSos(req, res) {
  try {
    const userId = req.auth.userId;

    const { data: profile, error: profileErr } = await supabaseClient
      .from('profiles')
      .select('full_name, emergency_name, emergency_phone, mobile')
      .eq('id', userId)
      .single();

    if (profileErr) {
      console.error('[sos/trigger] profile:', profileErr.message);
      return res.status(500).json({ success: false, message: 'Could not load profile' });
    }

    const elderName = profile.full_name || profile.emergency_name || 'A TinyBit user';

    console.log('[sos/trigger]', {
      userId,
      elderName,
      emergency_phone: profile.emergency_phone ?? null,
      channel: 'call-only',
    });

    return res.json({
      success: true,
      message: 'SOS logged. Use the dialer to call your emergency contact.',
    });
  } catch (err) {
    console.error('[sos/trigger]', err);
    return res.status(500).json({ success: false, message: err.message || 'SOS trigger failed' });
  }
}

module.exports = {
  triggerSos,
  createEmergencyContact,
  updateEmergencyContact,
  deleteEmergencyContact,
};
