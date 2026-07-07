const express = require('express');
const router = express.Router();
const { requireJwtAuth } = require('../middleware/jwtAuth.middleware');
const {
  inviteParent,
  respondToInvitation,
  getPendingInvitations,
  getSentInvitations,
  savePushToken,
  guardianElders,
  guardianAlerts,
  guardianLocation,
  guardianReports,
  getConnectedGuardians,
  removeElder,
  getElderSummary,
  listElderMedicines,
  createElderMedicine,
  updateElderMedicine,
  deleteElderMedicine,
  listElderMedicineLogs,
  listElderHealthRecords,
  createElderHealthRecord,
  deleteElderHealthRecord,
  presignElderUpload,
  presignElderDownload,
} = require('../controllers/guardian.controller');

router.post('/invite',               requireJwtAuth, inviteParent);
router.post('/respond',              requireJwtAuth, respondToInvitation);
router.get('/pending-invitations',   requireJwtAuth, getPendingInvitations);
router.get('/sent-invitations',      requireJwtAuth, getSentInvitations);
router.get('/connected-guardians',   requireJwtAuth, getConnectedGuardians);
router.post('/save-push-token',      requireJwtAuth, savePushToken);

router.get('/elders',                requireJwtAuth, guardianElders);
router.delete('/elders/:elderId',    requireJwtAuth, removeElder);
router.get('/alerts',                requireJwtAuth, guardianAlerts);
router.get('/location',              requireJwtAuth, guardianLocation);
router.get('/reports',               requireJwtAuth, guardianReports);
router.get('/elders/:elderId/summary', requireJwtAuth, getElderSummary);

router.get('/elders/:elderId/medicines',        requireJwtAuth, listElderMedicines);
router.post('/elders/:elderId/medicines',       requireJwtAuth, createElderMedicine);
router.patch('/elders/:elderId/medicines/:id',  requireJwtAuth, updateElderMedicine);
router.delete('/elders/:elderId/medicines/:id', requireJwtAuth, deleteElderMedicine);
router.get('/elders/:elderId/medicines/logs',   requireJwtAuth, listElderMedicineLogs);

router.get('/elders/:elderId/health-records',        requireJwtAuth, listElderHealthRecords);
router.post('/elders/:elderId/health-records',       requireJwtAuth, createElderHealthRecord);
router.delete('/elders/:elderId/health-records/:id', requireJwtAuth, deleteElderHealthRecord);

router.post('/elders/:elderId/storage/presign-upload',   requireJwtAuth, presignElderUpload);
router.post('/elders/:elderId/storage/presign-download', requireJwtAuth, presignElderDownload);

module.exports = router;
