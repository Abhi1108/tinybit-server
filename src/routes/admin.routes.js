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
  getMindGames,
  broadcast,
} = require('../controllers/admin.controller');

router.use('/assets', express.static(path.join(__dirname, '../../public/admin')));

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
router.get('/api/mind-games', sessionAuth, getMindGames);

router.post('/api/broadcast', sessionAuth, broadcast);

module.exports = router;
