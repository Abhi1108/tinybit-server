const crypto = require('crypto');

const OTP_LENGTH = 4;
const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;

function generateCode() {
  const max = 10 ** OTP_LENGTH;
  const num = crypto.randomInt(0, max);
  return num.toString().padStart(OTP_LENGTH, '0');
}

function hashCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

function verifyCode(code, codeHash) {
  return hashCode(code) === codeHash;
}

module.exports = {
  OTP_LENGTH,
  OTP_TTL_MS,
  MAX_VERIFY_ATTEMPTS,
  generateCode,
  hashCode,
  verifyCode,
};
