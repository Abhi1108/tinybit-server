const doctorsService = require('../services/doctors.service');

function isTableMissing(error) {
  return (
    error?.code === '42P01'
    || error?.code === 'PGRST205'
    || error?.code === 'ER_NO_SUCH_TABLE'
    || error?.errno === 1146
  );
}

/** GET /api/doctors — optional ?specialty= */
async function listDoctors(req, res) {
  try {
    const specialty = String(req.query.specialty ?? '').trim() || undefined;
    const doctors = specialty
      ? await doctorsService.listBySpecialty(specialty)
      : await doctorsService.listActive();

    return res.json({ success: true, doctors });
  } catch (err) {
    console.error('[doctors] list', err);
    if (isTableMissing(err)) {
      return res.status(501).json({
        success: false,
        message: 'doctors table is not deployed.',
      });
    }
    return res.status(500).json({
      success: false,
      message: err.message || 'Could not load doctors.',
    });
  }
}

/** GET /api/doctors/:id */
async function getDoctor(req, res) {
  try {
    const doctor = await doctorsService.getById(req.params.id);

    if (!doctor) {
      return res.status(404).json({ success: false, message: 'Doctor not found.' });
    }

    return res.json({ success: true, doctor });
  } catch (err) {
    console.error('[doctors] get', err);
    if (isTableMissing(err)) {
      return res.status(501).json({ success: false, message: 'doctors table is not deployed.' });
    }
    return res.status(500).json({
      success: false,
      message: err.message || 'Could not load doctor.',
    });
  }
}

module.exports = {
  listDoctors,
  getDoctor,
};
