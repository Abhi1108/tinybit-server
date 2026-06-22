const express = require('express');
const router = express.Router();
const { requireJwtAuth } = require('../middleware/jwtAuth.middleware');
const {
  sendOtp,
  verifyOtp,
  completeOtpAuth,
  login,
  register,
  refreshSession,
  logout,
  getMe,
} = require('../controllers/auth.controller');

router.post('/otp/send',     sendOtp);
router.post('/otp/verify',   verifyOtp);
router.post('/otp/complete', completeOtpAuth);
router.post('/login',       login);
router.post('/register',    register);
router.post('/refresh',     refreshSession);
router.post('/logout',      logout);
router.get('/me',           requireJwtAuth, getMe);

module.exports = router;
