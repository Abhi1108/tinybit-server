const express = require('express');
const router = express.Router();
const { requireJwtAuth } = require('../middleware/jwtAuth.middleware');
const { requireActivePlan } = require('../middleware/requireActivePlan.middleware');
const { requireFeature } = require('../middleware/planEntitlement.middleware');
const {
  inviteParent,
  createElderProfile,
  respondToInvitation,
  getPendingInvitations,
  getSentInvitations,
  savePushToken,
  clearPushToken,
  guardianElders,
  guardianAlerts,
  guardianLocation,
  guardianReports,
  getConnectedGuardians,
  removeElder,
  getElderSummary,
  getElderDashboard,
  getElderProfileForGuardian,
  updateElderProfileForGuardian,
  getElderCoGuardians,
  notifyOtherGuardians,
  listElderEmergencyContacts,
  createElderEmergencyContact,
  sendElderReminder,
  listElderMedicines,
  getElderMedicine,
  createElderMedicine,
  updateElderMedicine,
  deleteElderMedicine,
  listElderMedicineLogs,
  getElderMedicineAdherenceWeek,
  listElderHealthRecords,
  createElderHealthRecord,
  deleteElderHealthRecord,
  getElderHealthRecordInsights,
  compareElderHealthRecords,
  listElderDoctors,
  createElderDoctor,
  deleteElderDoctor,
  presignElderUpload,
  presignElderDownload,
} = require('../controllers/guardian.controller');

router.post('/invite',               requireJwtAuth, requireActivePlan, inviteParent);
router.post('/elders',               requireJwtAuth, requireActivePlan, createElderProfile);
router.post('/respond',              requireJwtAuth, respondToInvitation);
router.get('/pending-invitations',   requireJwtAuth, getPendingInvitations);
router.get('/sent-invitations',      requireJwtAuth, getSentInvitations);
router.get('/connected-guardians',   requireJwtAuth, getConnectedGuardians);
router.post('/save-push-token',      requireJwtAuth, savePushToken);
router.post('/clear-push-token',     requireJwtAuth, clearPushToken);

router.get('/elders',                requireJwtAuth, guardianElders);
router.delete('/elders/:elderId',    requireJwtAuth, removeElder);
router.get('/alerts',                requireJwtAuth, guardianAlerts);

// Location Tracking: Premium only
router.get('/location',              requireJwtAuth, requireFeature('location_tracking'), guardianLocation);

// Activity Log & Reports: Premium only
router.get('/reports',               requireJwtAuth, requireFeature('activity_log'), guardianReports);
router.get('/elders/:elderId/summary',   requireJwtAuth, getElderSummary);
router.get('/elders/:elderId/dashboard', requireJwtAuth, getElderDashboard);
router.get('/elders/:elderId/profile',   requireJwtAuth, getElderProfileForGuardian);
router.patch('/elders/:elderId/profile', requireJwtAuth, updateElderProfileForGuardian);
router.get('/elders/:elderId/co-guardians', requireJwtAuth, getElderCoGuardians);
router.post('/elders/:elderId/notify-guardians', requireJwtAuth, notifyOtherGuardians);
router.get('/elders/:elderId/emergency-contacts',  requireJwtAuth, listElderEmergencyContacts);
router.post('/elders/:elderId/emergency-contacts', requireJwtAuth, createElderEmergencyContact);
router.post('/elders/:elderId/send-reminder',       requireJwtAuth, sendElderReminder);

// Medicine Management: Free ✓ | Premium ✓ (Available to all users)
router.get('/elders/:elderId/medicines',        requireJwtAuth, listElderMedicines);
router.post('/elders/:elderId/medicines',       requireJwtAuth, createElderMedicine);
router.get('/elders/:elderId/medicines/logs',   requireJwtAuth, listElderMedicineLogs);
router.get('/elders/:elderId/medicines/adherence-week', requireJwtAuth, getElderMedicineAdherenceWeek);
// NOTE: /medicines/:id must be registered after the /medicines/logs and /medicines/adherence-week
// literal routes above, or a request to those paths would match :id="logs"/"adherence-week" here instead.
router.get('/elders/:elderId/medicines/:id',    requireJwtAuth, getElderMedicine);
router.patch('/elders/:elderId/medicines/:id',  requireJwtAuth, updateElderMedicine);
router.delete('/elders/:elderId/medicines/:id', requireJwtAuth, deleteElderMedicine);

// Health Records: 1 scan/month quota on Free, unlimited on Premium
router.get('/elders/:elderId/health-records',        requireJwtAuth, listElderHealthRecords);
router.post('/elders/:elderId/health-records',       requireJwtAuth, createElderHealthRecord);

// Analytics & Insights: Premium only
router.post('/elders/:elderId/health-records/compare',      requireJwtAuth, requireFeature('report_analytics'), compareElderHealthRecords);
router.post('/elders/:elderId/health-records/:id/insights', requireJwtAuth, requireFeature('report_analytics'), getElderHealthRecordInsights);
router.delete('/elders/:elderId/health-records/:id', requireJwtAuth, deleteElderHealthRecord);

router.get('/elders/:elderId/doctors',        requireJwtAuth, listElderDoctors);
router.post('/elders/:elderId/doctors',       requireJwtAuth, createElderDoctor);
router.delete('/elders/:elderId/doctors/:id', requireJwtAuth, deleteElderDoctor);

router.post('/elders/:elderId/storage/presign-upload',   requireJwtAuth, presignElderUpload);
router.post('/elders/:elderId/storage/presign-download', requireJwtAuth, presignElderDownload);

module.exports = router;
