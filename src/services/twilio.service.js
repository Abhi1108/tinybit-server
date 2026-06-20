const { OTP_LENGTH } = require('../utils/otp');

let twilioClient = null;

function isDevMode() {
  return process.env.OTP_DEV_MODE === 'true' || !process.env.TWILIO_ACCOUNT_SID;
}

function getClient() {
  if (twilioClient) return twilioClient;

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;

  // eslint-disable-next-line global-require
  const twilio = require('twilio');
  twilioClient = twilio(sid, token);
  return twilioClient;
}

async function sendOtpSms(phoneE164, code) {
  if (isDevMode()) {
    console.log(`[OTP DEV] ${phoneE164} → ${code}`);
    return { channel: 'dev' };
  }

  const from = process.env.TWILIO_PHONE_NUMBER;
  if (!from) {
    throw new Error('TWILIO_PHONE_NUMBER is not configured');
  }

  const client = getClient();
  if (!client) {
    throw new Error('Twilio is not configured');
  }

  await client.messages.create({
    body: `Your TinyBit verification code is ${code}. Valid for 5 minutes.`,
    from,
    to: phoneE164,
  });

  return { channel: 'sms' };
}

module.exports = { sendOtpSms, isDevMode, OTP_LENGTH };
