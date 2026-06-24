const { supabaseClient } = require('../config/supabase');

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

module.exports = { triggerSos };
