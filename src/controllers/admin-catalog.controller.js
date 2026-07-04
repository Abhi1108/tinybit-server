const catalogService = require('../services/admin-catalog.mysql');

function handleError(res, err) {
  return res.status(err.status || 500).json({ success: false, error: err.message });
}

function listQuery(req) {
  return {
    page: req.query.page,
    limit: req.query.limit,
    search: req.query.search,
    active: req.query.active,
  };
}

// ── Doctors ─────────────────────────────────────────────────────────────────

const getDoctors = async (req, res) => {
  try {
    const doctors = await catalogService.listDoctors({
      ...listQuery(req),
      specialty: req.query.specialty,
    });
    return res.json({ success: true, doctors });
  } catch (err) {
    return handleError(res, err);
  }
};

const getDoctor = async (req, res) => {
  try {
    const doctor = await catalogService.getDoctorById(req.params.id);
    if (!doctor) return res.status(404).json({ success: false, error: 'Doctor not found' });
    return res.json({ success: true, doctor });
  } catch (err) {
    return handleError(res, err);
  }
};

const createDoctor = async (req, res) => {
  try {
    const doctor = await catalogService.createDoctor(req.body);
    return res.status(201).json({ success: true, doctor });
  } catch (err) {
    return handleError(res, err);
  }
};

const updateDoctor = async (req, res) => {
  try {
    const doctor = await catalogService.updateDoctor(req.params.id, req.body ?? {});
    return res.json({ success: true, doctor });
  } catch (err) {
    return handleError(res, err);
  }
};

const deleteDoctor = async (req, res) => {
  try {
    await catalogService.deleteDoctor(req.params.id);
    return res.json({ success: true });
  } catch (err) {
    return handleError(res, err);
  }
};

// ── Mood media ──────────────────────────────────────────────────────────────

const getMoodMediaTracks = async (req, res) => {
  try {
    const tracks = await catalogService.listMoodMediaTracks({
      ...listQuery(req),
      category: req.query.category,
    });
    return res.json({ success: true, tracks });
  } catch (err) {
    return handleError(res, err);
  }
};

const getMoodMediaTrack = async (req, res) => {
  try {
    const track = await catalogService.getMoodMediaTrackById(req.params.id);
    if (!track) return res.status(404).json({ success: false, error: 'Track not found' });
    return res.json({ success: true, track });
  } catch (err) {
    return handleError(res, err);
  }
};

const createMoodMediaTrack = async (req, res) => {
  try {
    const track = await catalogService.createMoodMediaTrack(req.body);
    return res.status(201).json({ success: true, track });
  } catch (err) {
    return handleError(res, err);
  }
};

const updateMoodMediaTrack = async (req, res) => {
  try {
    const track = await catalogService.updateMoodMediaTrack(req.params.id, req.body ?? {});
    return res.json({ success: true, track });
  } catch (err) {
    return handleError(res, err);
  }
};

const deleteMoodMediaTrack = async (req, res) => {
  try {
    await catalogService.deleteMoodMediaTrack(req.params.id);
    return res.json({ success: true });
  } catch (err) {
    return handleError(res, err);
  }
};

// ── Quiz questions ──────────────────────────────────────────────────────────

const getQuizQuestions = async (req, res) => {
  try {
    const questions = await catalogService.listQuizQuestions(listQuery(req));
    return res.json({ success: true, questions });
  } catch (err) {
    return handleError(res, err);
  }
};

const getQuizQuestion = async (req, res) => {
  try {
    const question = await catalogService.getQuizQuestionById(req.params.id);
    if (!question) return res.status(404).json({ success: false, error: 'Question not found' });
    return res.json({ success: true, question });
  } catch (err) {
    return handleError(res, err);
  }
};

const createQuizQuestion = async (req, res) => {
  try {
    const question = await catalogService.createQuizQuestion(req.body);
    return res.status(201).json({ success: true, question });
  } catch (err) {
    return handleError(res, err);
  }
};

const updateQuizQuestion = async (req, res) => {
  try {
    const question = await catalogService.updateQuizQuestion(req.params.id, req.body ?? {});
    return res.json({ success: true, question });
  } catch (err) {
    return handleError(res, err);
  }
};

const deleteQuizQuestion = async (req, res) => {
  try {
    await catalogService.deleteQuizQuestion(req.params.id);
    return res.json({ success: true });
  } catch (err) {
    return handleError(res, err);
  }
};

// ── Inspirations ────────────────────────────────────────────────────────────

const getInspirations = async (req, res) => {
  try {
    const inspirations = await catalogService.listInspirations(listQuery(req));
    return res.json({ success: true, inspirations });
  } catch (err) {
    return handleError(res, err);
  }
};

const getInspiration = async (req, res) => {
  try {
    const inspiration = await catalogService.getInspirationById(req.params.id);
    if (!inspiration) return res.status(404).json({ success: false, error: 'Inspiration not found' });
    return res.json({ success: true, inspiration });
  } catch (err) {
    return handleError(res, err);
  }
};

const createInspiration = async (req, res) => {
  try {
    const inspiration = await catalogService.createInspiration(req.body);
    return res.status(201).json({ success: true, inspiration });
  } catch (err) {
    return handleError(res, err);
  }
};

const updateInspiration = async (req, res) => {
  try {
    const inspiration = await catalogService.updateInspiration(req.params.id, req.body ?? {});
    return res.json({ success: true, inspiration });
  } catch (err) {
    return handleError(res, err);
  }
};

const deleteInspiration = async (req, res) => {
  try {
    await catalogService.deleteInspiration(req.params.id);
    return res.json({ success: true });
  } catch (err) {
    return handleError(res, err);
  }
};

module.exports = {
  getDoctors,
  getDoctor,
  createDoctor,
  updateDoctor,
  deleteDoctor,
  getMoodMediaTracks,
  getMoodMediaTrack,
  createMoodMediaTrack,
  updateMoodMediaTrack,
  deleteMoodMediaTrack,
  getQuizQuestions,
  getQuizQuestion,
  createQuizQuestion,
  updateQuizQuestion,
  deleteQuizQuestion,
  getInspirations,
  getInspiration,
  createInspiration,
  updateInspiration,
  deleteInspiration,
};
