const familyMessagesService = require('../services/family-messages.service');
const storageService = require('../services/storage.service');
const { mapStorageError } = require('./storage.controller');
const { resolveTodayForUser } = require('../services/timezone.service');

function isTableMissing(error) {
  return (
    error?.code === 'ER_NO_SUCH_TABLE'
    || error?.errno === 1146
  );
}

function readBody(req) {
  return req.body ?? {};
}

function isValidDateParam(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''));
}

function todayDateParam(userId) {
  return resolveTodayForUser(userId);
}

/** GET /api/family/messages/history?with=<userId>&limit=50 — full two-way thread, newest first. */
async function getMessageHistory(req, res) {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const otherUserId = String(req.query.with ?? '').trim();
    if (!otherUserId) {
      return res.status(400).json({ success: false, message: '"with" query param is required.' });
    }

    const limitRaw = parseInt(req.query.limit, 10);
    const limit = Number.isInteger(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;

    const messages = await familyMessagesService.listBetween(userId, otherUserId, limit);
    return res.json({ success: true, messages });
  } catch (err) {
    console.error('[family/messages] history', err);
    if (isTableMissing(err)) {
      return res.status(501).json({ success: false, message: 'family_messages table is not deployed.' });
    }
    return res.status(500).json({
      success: false,
      message: err.message || 'Could not load message history.',
    });
  }
}

/** GET /api/family/messages/latest */
async function getLatestMessage(req, res) {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const message = await familyMessagesService.latestForReceiver(userId);
    return res.json({ success: true, message });
  } catch (err) {
    console.error('[family/messages] latest', err);
    if (isTableMissing(err)) {
      return res.status(501).json({
        success: false,
        message: 'family_messages table is not deployed.',
      });
    }
    return res.status(500).json({
      success: false,
      message: err.message || 'Could not load latest message.',
    });
  }
}

/** GET /api/family/messages/count?date=YYYY-MM-DD */
async function getMessageCount(req, res) {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const dateRaw = String(req.query.date ?? '').trim();
    const date = isValidDateParam(dateRaw) ? dateRaw : await todayDateParam(userId);

    const count = await familyMessagesService.countForReceiverOnDate(userId, date);
    return res.json({ success: true, count });
  } catch (err) {
    console.error('[family/messages] count', err);
    if (isTableMissing(err)) {
      return res.status(501).json({ success: false, message: 'family_messages table is not deployed.' });
    }
    return res.status(500).json({
      success: false,
      message: err.message || 'Could not count messages.',
    });
  }
}

/** POST /api/family/messages */
async function createMessage(req, res) {
  try {
    const senderId = req.auth?.userId;
    if (!senderId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const body = readBody(req);
    const receiverId = String(body.receiver_id ?? body.receiverId ?? '').trim();
    const message = String(body.message ?? body.content ?? '').trim();
    const audioUrlRaw = body.audio_url ?? body.audioUrl;
    const audioUrl = audioUrlRaw != null ? String(audioUrlRaw).trim() : null;

    if (!receiverId) {
      return res.status(400).json({ success: false, message: 'receiver_id is required.' });
    }
    if (!message && !audioUrl) {
      return res.status(400).json({ success: false, message: 'message, content, or audio_url is required.' });
    }
    if (audioUrl && !/^https?:\/\//i.test(audioUrl)) {
      return res.status(400).json({ success: false, message: 'audio_url must be an HTTPS URL.' });
    }

    const created = await familyMessagesService.create(senderId, receiverId, message, audioUrl || null);
    return res.json({ success: true, message: created });
  } catch (err) {
    console.error('[family/messages] create', err);
    if (isTableMissing(err)) {
      return res.status(501).json({ success: false, message: 'family_messages table is not deployed.' });
    }
    return res.status(500).json({
      success: false,
      message: err.message || 'Could not send message.',
    });
  }
}

/** POST /api/family/messages/presign-download — { audio_url } of a voice message you sent or received */
async function presignAudioDownload(req, res) {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const audioUrl = String(req.body?.audio_url ?? '').trim();
    if (!audioUrl) {
      return res.status(400).json({ success: false, message: 'audio_url is required.' });
    }

    const isParticipant = await familyMessagesService.isParticipantInAudioMessage(userId, audioUrl);
    if (!isParticipant) {
      return res.status(403).json({ success: false, message: 'You do not have access to this voice message.' });
    }

    const key = storageService.extractObjectKey(audioUrl);
    if (!key) {
      return res.status(400).json({ success: false, message: 'Invalid audio_url.' });
    }
    const ownerId = key.split('/')[1];

    const result = await storageService.createPresignedDownload({ key, userId: ownerId });
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('[family/messages] presign-download', err);
    const mapped = mapStorageError(err, res);
    if (mapped) return mapped;
    return res.status(500).json({ success: false, message: err.message || 'Could not create download URL.' });
  }
}

module.exports = {
  getMessageHistory,
  getLatestMessage,
  getMessageCount,
  createMessage,
  presignAudioDownload,
};
