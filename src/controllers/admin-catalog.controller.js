const catalogService = require('../services/admin-catalog.mysql');
const auditService = require('../services/admin-audit.mysql');

function handleError(res, err) {
  return res.status(err.status || 500).json({ success: false, error: err.message });
}

function audit(req, action, targetType, targetId, details) {
  return auditService.recordSafe({
    actor: req.admin?.username ?? 'unknown',
    action,
    targetType,
    targetId,
    details,
    ip: req.ip,
  });
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
    await audit(req, 'doctor.create', 'doctor', doctor.id, { name: doctor.name });
    return res.status(201).json({ success: true, doctor });
  } catch (err) {
    return handleError(res, err);
  }
};

const updateDoctor = async (req, res) => {
  try {
    const doctor = await catalogService.updateDoctor(req.params.id, req.body ?? {});
    await audit(req, 'doctor.update', 'doctor', req.params.id, { fields: Object.keys(req.body ?? {}) });
    return res.json({ success: true, doctor });
  } catch (err) {
    return handleError(res, err);
  }
};

const deleteDoctor = async (req, res) => {
  try {
    await catalogService.deleteDoctor(req.params.id);
    await audit(req, 'doctor.delete', 'doctor', req.params.id);
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
      media_type: req.query.media_type,
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
    await audit(req, 'mood_media.create', 'mood_media', track.id, { title: track.title });
    return res.status(201).json({ success: true, track });
  } catch (err) {
    return handleError(res, err);
  }
};

const updateMoodMediaTrack = async (req, res) => {
  try {
    const track = await catalogService.updateMoodMediaTrack(req.params.id, req.body ?? {});
    await audit(req, 'mood_media.update', 'mood_media', req.params.id, { fields: Object.keys(req.body ?? {}) });
    return res.json({ success: true, track });
  } catch (err) {
    return handleError(res, err);
  }
};

const deleteMoodMediaTrack = async (req, res) => {
  try {
    await catalogService.deleteMoodMediaTrack(req.params.id);
    await audit(req, 'mood_media.delete', 'mood_media', req.params.id);
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
    await audit(req, 'quiz.create', 'quiz_question', question.id);
    return res.status(201).json({ success: true, question });
  } catch (err) {
    return handleError(res, err);
  }
};

const updateQuizQuestion = async (req, res) => {
  try {
    const question = await catalogService.updateQuizQuestion(req.params.id, req.body ?? {});
    await audit(req, 'quiz.update', 'quiz_question', req.params.id, { fields: Object.keys(req.body ?? {}) });
    return res.json({ success: true, question });
  } catch (err) {
    return handleError(res, err);
  }
};

const deleteQuizQuestion = async (req, res) => {
  try {
    await catalogService.deleteQuizQuestion(req.params.id);
    await audit(req, 'quiz.delete', 'quiz_question', req.params.id);
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
    await audit(req, 'inspiration.create', 'inspiration', inspiration.id, { author: inspiration.author });
    return res.status(201).json({ success: true, inspiration });
  } catch (err) {
    return handleError(res, err);
  }
};

const updateInspiration = async (req, res) => {
  try {
    const inspiration = await catalogService.updateInspiration(req.params.id, req.body ?? {});
    await audit(req, 'inspiration.update', 'inspiration', req.params.id, { fields: Object.keys(req.body ?? {}) });
    return res.json({ success: true, inspiration });
  } catch (err) {
    return handleError(res, err);
  }
};

const deleteInspiration = async (req, res) => {
  try {
    await catalogService.deleteInspiration(req.params.id);
    await audit(req, 'inspiration.delete', 'inspiration', req.params.id);
    return res.json({ success: true });
  } catch (err) {
    return handleError(res, err);
  }
};

// ── Help & Guide — tutorials ────────────────────────────────────────────────

const getHelpTutorials = async (req, res) => {
  try {
    const tutorials = await catalogService.listHelpTutorials({
      ...listQuery(req),
      category: req.query.category,
    });
    return res.json({ success: true, tutorials });
  } catch (err) {
    return handleError(res, err);
  }
};

const getHelpTutorial = async (req, res) => {
  try {
    const tutorial = await catalogService.getHelpTutorialById(req.params.id);
    if (!tutorial) return res.status(404).json({ success: false, error: 'Help tutorial not found' });
    return res.json({ success: true, tutorial });
  } catch (err) {
    return handleError(res, err);
  }
};

const createHelpTutorial = async (req, res) => {
  try {
    const tutorial = await catalogService.createHelpTutorial(req.body);
    await audit(req, 'help_tutorial.create', 'help_tutorial', tutorial.id, { title: tutorial.title });
    return res.status(201).json({ success: true, tutorial });
  } catch (err) {
    return handleError(res, err);
  }
};

const updateHelpTutorial = async (req, res) => {
  try {
    const tutorial = await catalogService.updateHelpTutorial(req.params.id, req.body ?? {});
    await audit(req, 'help_tutorial.update', 'help_tutorial', req.params.id, { fields: Object.keys(req.body ?? {}) });
    return res.json({ success: true, tutorial });
  } catch (err) {
    return handleError(res, err);
  }
};

const deleteHelpTutorial = async (req, res) => {
  try {
    await catalogService.deleteHelpTutorial(req.params.id);
    await audit(req, 'help_tutorial.delete', 'help_tutorial', req.params.id);
    return res.json({ success: true });
  } catch (err) {
    return handleError(res, err);
  }
};

// ── Help & Guide — FAQs ─────────────────────────────────────────────────────

const getHelpFaqs = async (req, res) => {
  try {
    const faqs = await catalogService.listHelpFaqs(listQuery(req));
    return res.json({ success: true, faqs });
  } catch (err) {
    return handleError(res, err);
  }
};

const getHelpFaq = async (req, res) => {
  try {
    const faq = await catalogService.getHelpFaqById(req.params.id);
    if (!faq) return res.status(404).json({ success: false, error: 'Help FAQ not found' });
    return res.json({ success: true, faq });
  } catch (err) {
    return handleError(res, err);
  }
};

const createHelpFaq = async (req, res) => {
  try {
    const faq = await catalogService.createHelpFaq(req.body);
    await audit(req, 'help_faq.create', 'help_faq', faq.id);
    return res.status(201).json({ success: true, faq });
  } catch (err) {
    return handleError(res, err);
  }
};

const updateHelpFaq = async (req, res) => {
  try {
    const faq = await catalogService.updateHelpFaq(req.params.id, req.body ?? {});
    await audit(req, 'help_faq.update', 'help_faq', req.params.id, { fields: Object.keys(req.body ?? {}) });
    return res.json({ success: true, faq });
  } catch (err) {
    return handleError(res, err);
  }
};

const deleteHelpFaq = async (req, res) => {
  try {
    await catalogService.deleteHelpFaq(req.params.id);
    await audit(req, 'help_faq.delete', 'help_faq', req.params.id);
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
  getHelpTutorials,
  getHelpTutorial,
  createHelpTutorial,
  updateHelpTutorial,
  deleteHelpTutorial,
  getHelpFaqs,
  getHelpFaq,
  createHelpFaq,
  updateHelpFaq,
  deleteHelpFaq,
};
