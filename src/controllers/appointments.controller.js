const appointmentsService = require('../services/appointments.service');

function isTableMissing(error) {
  return (
    error?.code === 'ER_NO_SUCH_TABLE'
    || error?.errno === 1146
  );
}

function readBody(req) {
  return req.body ?? {};
}

/** GET /api/appointments */
async function listAppointments(req, res) {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const appointments = await appointmentsService.listByUser(userId);
    return res.json({ success: true, appointments });
  } catch (err) {
    console.error('[appointments] list', err);
    if (isTableMissing(err)) {
      return res.status(501).json({
        success: false,
        message: 'appointments table is not deployed.',
      });
    }
    return res.status(500).json({
      success: false,
      message: err.message || 'Could not load appointments.',
    });
  }
}

/** POST /api/appointments */
async function createAppointment(req, res) {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const body = readBody(req);
    const {
      user_id: _ignoredUserId,
      id: _ignoredId,
      created_at: _ignoredCreatedAt,
      ...fields
    } = body;

    if (!fields.doctor_name?.trim()) {
      return res.status(400).json({ success: false, message: 'Doctor name is required.' });
    }

    const appointment = await appointmentsService.create(userId, fields);
    return res.json({ success: true, appointment });
  } catch (err) {
    console.error('[appointments] create', err);
    if (isTableMissing(err)) {
      return res.status(501).json({ success: false, message: 'appointments table is not deployed.' });
    }
    return res.status(500).json({
      success: false,
      message: err.message || 'Could not save appointment.',
    });
  }
}

/** PATCH /api/appointments/:id — body: { status } */
async function updateAppointmentStatus(req, res) {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const status = String(readBody(req).status ?? '').trim();
    if (!status) {
      return res.status(400).json({ success: false, message: 'Status is required.' });
    }

    const appointment = await appointmentsService.updateStatus(userId, req.params.id, status);

    if (!appointment) {
      return res.status(404).json({ success: false, message: 'Appointment not found.' });
    }

    return res.json({ success: true, appointment });
  } catch (err) {
    console.error('[appointments] updateStatus', err);
    if (isTableMissing(err)) {
      return res.status(501).json({ success: false, message: 'appointments table is not deployed.' });
    }
    return res.status(500).json({
      success: false,
      message: err.message || 'Could not update appointment.',
    });
  }
}

module.exports = {
  listAppointments,
  createAppointment,
  updateAppointmentStatus,
};
