const express = require('express');
const router = express.Router();
const { requireJwtAuth } = require('../middleware/jwtAuth.middleware');
const {
  deprecatedOtpEndpoint,
  login,
  register,
  googleAuth,
  phoneAuth,
  googleAuthStatus,
  refreshSession,
  logout,
  getMe,
  updateProfile,
  getSettings,
  updateSettings,
} = require('../controllers/auth.controller');

router.post('/otp/send',     deprecatedOtpEndpoint);
router.post('/otp/verify',   deprecatedOtpEndpoint);
router.post('/otp/complete', deprecatedOtpEndpoint);
router.get('/google/status', googleAuthStatus);
router.post('/google',       googleAuth);
router.post('/phone',        phoneAuth);
router.post('/login',        login);
router.post('/register',     register);
router.post('/refresh',      refreshSession);
router.post('/logout',       logout);
router.get('/me',            requireJwtAuth, getMe);
router.patch('/profile',     requireJwtAuth, updateProfile);
router.get('/settings',      requireJwtAuth, getSettings);
router.patch('/settings',    requireJwtAuth, updateSettings);

module.exports = router;
