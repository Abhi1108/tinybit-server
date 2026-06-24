const express = require('express');
const router = express.Router();
const { requireJwtAuth } = require('../middleware/jwtAuth.middleware');
const {
  sendOtp,
  verifyOtp,
  completeOtpAuth,
  login,
  register,
  googleAuth,
  refreshSession,
  logout,
  getMe,
  updateProfile,
} = require('../controllers/auth.controller');

router.post('/otp/send',     sendOtp);
router.post('/otp/verify',   verifyOtp);
router.post('/otp/complete', completeOtpAuth);
router.post('/google',       googleAuth);
router.post('/login',       login);
router.post('/register',    register);
router.post('/refresh',     refreshSession);
router.post('/logout',      logout);
router.get('/me',           requireJwtAuth, getMe);
router.patch('/profile',    requireJwtAuth, updateProfile);

module.exports = router;
