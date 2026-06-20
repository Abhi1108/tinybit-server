const express = require('express');
const router = express.Router();
const { requireSupabaseAuth } = require('../middleware/supabaseAuth.middleware');
const {
  sendOtp,
  verifyOtp,
  login,
  register,
  refreshSession,
  getMe,
} = require('../controllers/auth.controller');

router.post('/otp/send',    sendOtp);
router.post('/otp/verify',  verifyOtp);
router.post('/login',       login);
router.post('/register',    register);
router.post('/refresh',     refreshSession);
router.get('/me',           requireSupabaseAuth, getMe);

module.exports = router;
