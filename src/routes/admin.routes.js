const express = require('express');
const path = require('path');
const router = express.Router();

const {
  checkSession,
  login, logout,
  serveDashboard,
  getStats, getAnalytics,
  getUsers, getIncompleteUsers, exportUsers, getUserById, createUser, updateUser,
  banUser, deleteUser,
  getConnections, updateConnection, deleteConnection,
  getMedicines,
  getCheckIns,
  getMoods,
  getAIConversations,
  getCareEvents,
  createCareEvent,
  deleteCareEvent,
  getMindGames,
  broadcast,
  getHealthRecords,
  deleteHealthRecord,
} = require('../controllers/admin.controller');
const {
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
} = require('../controllers/admin-catalog.controller');
const { presignCatalogUpload } = require('../controllers/admin-storage.controller');

router.use(express.static(path.join(__dirname, '../../public/admin')));

const sessionAuth = (req, res, next) => {
  const auth = req.headers.authorization ?? '';
  if (!auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!checkSession(auth.slice(7))) {
    return res.status(401).json({ error: 'Session expired. Please log in again.' });
  }
  return next();
};

router.get('/', serveDashboard);

router.post('/api/login', login);
router.post('/api/logout', sessionAuth, logout);

router.get('/api/stats', sessionAuth, getStats);
router.get('/api/analytics', sessionAuth, getAnalytics);

router.get('/api/users/export', sessionAuth, exportUsers);
router.get('/api/users/incomplete', sessionAuth, getIncompleteUsers);
router.get('/api/users', sessionAuth, getUsers);
router.post('/api/users', sessionAuth, createUser);
router.get('/api/users/:id', sessionAuth, getUserById);
router.patch('/api/users/:id', sessionAuth, updateUser);
router.patch('/api/users/:id/ban', sessionAuth, banUser);
router.delete('/api/users/:id', sessionAuth, deleteUser);

router.get('/api/connections', sessionAuth, getConnections);
router.patch('/api/connections/:id', sessionAuth, updateConnection);
router.delete('/api/connections/:id', sessionAuth, deleteConnection);

router.get('/api/medicines', sessionAuth, getMedicines);
router.get('/api/check-ins', sessionAuth, getCheckIns);
router.get('/api/moods', sessionAuth, getMoods);
router.get('/api/ai-conversations', sessionAuth, getAIConversations);
router.get('/api/care-events', sessionAuth, getCareEvents);
router.post('/api/care-events', sessionAuth, createCareEvent);
router.delete('/api/care-events/:id', sessionAuth, deleteCareEvent);
router.get('/api/mind-games', sessionAuth, getMindGames);

router.get('/api/health-records', sessionAuth, getHealthRecords);
router.delete('/api/health-records/:id', sessionAuth, deleteHealthRecord);
router.post('/api/ai-forecast-multi', sessionAuth, async (req, res) => {
  const { healthForecastMulti } = require('../controllers/ai.controller');
  return healthForecastMulti(req, res);
});

router.post('/api/broadcast', sessionAuth, broadcast);

router.post('/api/storage/presign-upload', sessionAuth, presignCatalogUpload);

// ── Catalog (P1 — real content via tinybit-admin) ───────────────────────────
router.get('/api/doctors', sessionAuth, getDoctors);
router.post('/api/doctors', sessionAuth, createDoctor);
router.get('/api/doctors/:id', sessionAuth, getDoctor);
router.patch('/api/doctors/:id', sessionAuth, updateDoctor);
router.delete('/api/doctors/:id', sessionAuth, deleteDoctor);

router.get('/api/mood-media', sessionAuth, getMoodMediaTracks);
router.post('/api/mood-media', sessionAuth, createMoodMediaTrack);
router.get('/api/mood-media/:id', sessionAuth, getMoodMediaTrack);
router.patch('/api/mood-media/:id', sessionAuth, updateMoodMediaTrack);
router.delete('/api/mood-media/:id', sessionAuth, deleteMoodMediaTrack);

router.get('/api/quiz-questions', sessionAuth, getQuizQuestions);
router.post('/api/quiz-questions', sessionAuth, createQuizQuestion);
router.get('/api/quiz-questions/:id', sessionAuth, getQuizQuestion);
router.patch('/api/quiz-questions/:id', sessionAuth, updateQuizQuestion);
router.delete('/api/quiz-questions/:id', sessionAuth, deleteQuizQuestion);

router.get('/api/inspirations', sessionAuth, getInspirations);
router.post('/api/inspirations', sessionAuth, createInspiration);
router.get('/api/inspirations/:id', sessionAuth, getInspiration);
router.patch('/api/inspirations/:id', sessionAuth, updateInspiration);
router.delete('/api/inspirations/:id', sessionAuth, deleteInspiration);

module.exports = router;
