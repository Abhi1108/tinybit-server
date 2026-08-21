const express = require('express');
const path = require('path');
const router = express.Router();

const {
  login, logout,
  listAdminAccounts,
  createAdminAccount,
  updateAdminAccount,
  resetAdminPassword,
  deleteAdminAccount,
  listRoles,
  createRole,
  updateRole,
  deleteRole,
  serveDashboard,
  getStats, getAnalytics,
  getUsers, getIncompleteUsers, exportUsers, getUserById, createUser, updateUser,
  banUser, deleteUser, restoreUser, purgeUser,
  getConnections, updateConnection, deleteConnection,
  getMedicines,
  getCheckIns,
  getMoods,
  getHealthReadings,
  getAIConversations,
  getCareEvents,
  createCareEvent,
  deleteCareEvent,
  getMindGames,
  broadcast,
  getHealthRecords,
  deleteHealthRecord,
  getAuditLogs,
  exportAuditLogs,
  getSosAlerts,
  updateSosAlert,
  getNotifications,
  getEmergencyContacts,
  getJournalEntries,
  getFamilyMessages,
  getElderLocations,
  getAppointments,
  getStreaks,
  getUserSubscriptions,
  getRevenueSummary,
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
  getHelpTutorials,
  getHelpTutorialCategories,
  getHelpTutorial,
  createHelpTutorial,
  updateHelpTutorial,
  deleteHelpTutorial,
  getHelpFaqs,
  getHelpFaq,
  createHelpFaq,
  updateHelpFaq,
  deleteHelpFaq,
} = require('../controllers/admin-catalog.controller');
const { presignCatalogUpload } = require('../controllers/admin-storage.controller');
const {
  getPricingTiers,
  getPricingTier,
  createPricingTier,
  updatePricingTier,
  deletePricingTier,
  getOrders,
  getOrder,
  refundPayment,
} = require('../controllers/admin-payments.controller');
const {
  sessionAuth,
  requireSuperAdmin,
  requirePermission,
} = require('../middleware/adminAuth.middleware');

router.use(express.static(path.join(__dirname, '../../public/admin')));

router.get('/', serveDashboard);

router.post('/api/login', login);
router.post('/api/logout', sessionAuth, logout);

router.get('/api/roles', sessionAuth, listRoles);
router.post('/api/roles', sessionAuth, requireSuperAdmin, createRole);
router.patch('/api/roles/:id', sessionAuth, requireSuperAdmin, updateRole);
router.delete('/api/roles/:id', sessionAuth, requireSuperAdmin, deleteRole);

router.get('/api/admins', sessionAuth, requireSuperAdmin, listAdminAccounts);
router.post('/api/admins', sessionAuth, requireSuperAdmin, createAdminAccount);
router.patch('/api/admins/:id', sessionAuth, requireSuperAdmin, updateAdminAccount);
router.patch('/api/admins/:id/password', sessionAuth, requireSuperAdmin, resetAdminPassword);
router.delete('/api/admins/:id', sessionAuth, requireSuperAdmin, deleteAdminAccount);

router.get('/api/stats', sessionAuth, requirePermission('Dashboard', 'Dashboard (Read)'), getStats);
router.get('/api/analytics', sessionAuth, requirePermission('Dashboard', 'Dashboard (Read)'), getAnalytics);

router.get('/api/users/export', sessionAuth, requirePermission('User Management'), exportUsers);
router.get('/api/users/incomplete', sessionAuth, requirePermission('User Management', 'Users (Read)'), getIncompleteUsers);
router.get('/api/users', sessionAuth, requirePermission('User Management', 'Users (Read)'), getUsers);
router.post('/api/users', sessionAuth, requirePermission('User Management'), createUser);
router.get('/api/users/:id', sessionAuth, requirePermission('User Management', 'Users (Read)'), getUserById);
router.patch('/api/users/:id', sessionAuth, requirePermission('User Management'), updateUser);
router.patch('/api/users/:id/ban', sessionAuth, requirePermission('User Management'), banUser);
router.delete('/api/users/:id', sessionAuth, requirePermission('User Management'), deleteUser);
router.patch('/api/users/:id/restore', sessionAuth, requirePermission('User Management'), restoreUser);
router.delete('/api/users/:id/purge', sessionAuth, requirePermission('User Management'), purgeUser);

router.get('/api/connections', sessionAuth, requirePermission('User Management', 'Users (Read)'), getConnections);
router.patch('/api/connections/:id', sessionAuth, requirePermission('User Management'), updateConnection);
router.delete('/api/connections/:id', sessionAuth, requirePermission('User Management'), deleteConnection);

router.get('/api/medicines', sessionAuth, requirePermission('User Management', 'Users (Read)'), getMedicines);
router.get('/api/check-ins', sessionAuth, requirePermission('User Management', 'Users (Read)'), getCheckIns);
router.get('/api/moods', sessionAuth, requirePermission('User Management', 'Users (Read)'), getMoods);
router.get('/api/health-readings', sessionAuth, requirePermission('User Management', 'Users (Read)'), getHealthReadings);
router.get('/api/care-events', sessionAuth, requirePermission('User Management', 'Users (Read)'), getCareEvents);
router.post('/api/care-events', sessionAuth, requirePermission('User Management'), createCareEvent);
router.delete('/api/care-events/:id', sessionAuth, requirePermission('User Management'), deleteCareEvent);
router.get('/api/mind-games', sessionAuth, requirePermission('Leaderboard & Rewards', 'User Management', 'Users (Read)'), getMindGames);
router.get('/api/health-records', sessionAuth, requirePermission('User Management', 'Users (Read)'), getHealthRecords);
router.delete('/api/health-records/:id', sessionAuth, requirePermission('User Management'), deleteHealthRecord);
router.get('/api/journal', sessionAuth, requirePermission('User Management', 'Users (Read)'), getJournalEntries);
router.get('/api/family-messages', sessionAuth, requirePermission('User Management', 'Users (Read)'), getFamilyMessages);
router.get('/api/elder-locations', sessionAuth, requirePermission('User Management', 'Users (Read)'), getElderLocations);
router.get('/api/appointments', sessionAuth, requirePermission('User Management', 'Users (Read)'), getAppointments);
router.get('/api/streaks', sessionAuth, requirePermission('Leaderboard & Rewards', 'User Management', 'Users (Read)'), getStreaks);

router.get('/api/ai-conversations', sessionAuth, requirePermission('AI Management'), getAIConversations);
router.post('/api/ai-forecast-multi', sessionAuth, requirePermission('AI Management'), async (req, res) => {
  const { healthForecastMulti } = require('../controllers/ai.controller');
  return healthForecastMulti(req, res);
});

router.get('/api/sos-alerts', sessionAuth, requirePermission('SOS Management', 'SOS (Read)'), getSosAlerts);
router.patch('/api/sos-alerts/:id', sessionAuth, requirePermission('SOS Management'), updateSosAlert);
router.get('/api/emergency-contacts', sessionAuth, requirePermission('SOS Management', 'SOS (Read)'), getEmergencyContacts);

router.get('/api/notifications', sessionAuth, requirePermission('Notifications', 'Notifications (Read)'), getNotifications);
router.post('/api/broadcast', sessionAuth, requirePermission('Notifications'), broadcast);

router.get('/api/user-subscriptions', sessionAuth, requirePermission('Billing'), getUserSubscriptions);
router.get('/api/revenue', sessionAuth, requirePermission('Billing'), getRevenueSummary);

router.get('/api/audit-log/export', sessionAuth, requirePermission('Admin Management', 'Settings'), exportAuditLogs);
router.get('/api/audit-log', sessionAuth, requirePermission('Admin Management', 'Settings'), getAuditLogs);

router.post('/api/storage/presign-upload', sessionAuth, requirePermission('Content Management', 'FAQ Management'), presignCatalogUpload);

router.get('/api/doctors', sessionAuth, requirePermission('Content Management'), getDoctors);
router.post('/api/doctors', sessionAuth, requirePermission('Content Management'), createDoctor);
router.get('/api/doctors/:id', sessionAuth, requirePermission('Content Management'), getDoctor);
router.patch('/api/doctors/:id', sessionAuth, requirePermission('Content Management'), updateDoctor);
router.delete('/api/doctors/:id', sessionAuth, requirePermission('Content Management'), deleteDoctor);

router.get('/api/mood-media', sessionAuth, requirePermission('Content Management'), getMoodMediaTracks);
router.post('/api/mood-media', sessionAuth, requirePermission('Content Management'), createMoodMediaTrack);
router.get('/api/mood-media/:id', sessionAuth, requirePermission('Content Management'), getMoodMediaTrack);
router.patch('/api/mood-media/:id', sessionAuth, requirePermission('Content Management'), updateMoodMediaTrack);
router.delete('/api/mood-media/:id', sessionAuth, requirePermission('Content Management'), deleteMoodMediaTrack);

router.get('/api/quiz-questions', sessionAuth, requirePermission('Content Management'), getQuizQuestions);
router.post('/api/quiz-questions', sessionAuth, requirePermission('Content Management'), createQuizQuestion);
router.get('/api/quiz-questions/:id', sessionAuth, requirePermission('Content Management'), getQuizQuestion);
router.patch('/api/quiz-questions/:id', sessionAuth, requirePermission('Content Management'), updateQuizQuestion);
router.delete('/api/quiz-questions/:id', sessionAuth, requirePermission('Content Management'), deleteQuizQuestion);

router.get('/api/inspirations', sessionAuth, requirePermission('Content Management'), getInspirations);
router.post('/api/inspirations', sessionAuth, requirePermission('Content Management'), createInspiration);
router.get('/api/inspirations/:id', sessionAuth, requirePermission('Content Management'), getInspiration);
router.patch('/api/inspirations/:id', sessionAuth, requirePermission('Content Management'), updateInspiration);
router.delete('/api/inspirations/:id', sessionAuth, requirePermission('Content Management'), deleteInspiration);

router.get('/api/help-tutorials', sessionAuth, requirePermission('Content Management', 'FAQ Management'), getHelpTutorials);
router.get('/api/help-tutorials/categories', sessionAuth, requirePermission('Content Management', 'FAQ Management'), getHelpTutorialCategories);
router.post('/api/help-tutorials', sessionAuth, requirePermission('Content Management', 'FAQ Management'), createHelpTutorial);
router.get('/api/help-tutorials/:id', sessionAuth, requirePermission('Content Management', 'FAQ Management'), getHelpTutorial);
router.patch('/api/help-tutorials/:id', sessionAuth, requirePermission('Content Management', 'FAQ Management'), updateHelpTutorial);
router.delete('/api/help-tutorials/:id', sessionAuth, requirePermission('Content Management', 'FAQ Management'), deleteHelpTutorial);

router.get('/api/help-faqs', sessionAuth, requirePermission('FAQ Management', 'Content Management'), getHelpFaqs);
router.post('/api/help-faqs', sessionAuth, requirePermission('FAQ Management', 'Content Management'), createHelpFaq);
router.get('/api/help-faqs/:id', sessionAuth, requirePermission('FAQ Management', 'Content Management'), getHelpFaq);
router.patch('/api/help-faqs/:id', sessionAuth, requirePermission('FAQ Management', 'Content Management'), updateHelpFaq);
router.delete('/api/help-faqs/:id', sessionAuth, requirePermission('FAQ Management', 'Content Management'), deleteHelpFaq);

router.get('/api/pricing-tiers', sessionAuth, requirePermission('Billing'), getPricingTiers);
router.post('/api/pricing-tiers', sessionAuth, requirePermission('Billing'), createPricingTier);
router.get('/api/pricing-tiers/:id', sessionAuth, requirePermission('Billing'), getPricingTier);
router.patch('/api/pricing-tiers/:id', sessionAuth, requirePermission('Billing'), updatePricingTier);
router.delete('/api/pricing-tiers/:id', sessionAuth, requirePermission('Billing'), deletePricingTier);

router.get('/api/payments/orders', sessionAuth, requirePermission('Billing'), getOrders);
router.get('/api/payments/orders/:id', sessionAuth, requirePermission('Billing'), getOrder);
router.post('/api/payments/:id/refund', sessionAuth, requirePermission('Billing'), refundPayment);

module.exports = router;
