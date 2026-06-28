const familyMessagesService = require('../services/family-messages.service');

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

function todayDateParam() {
  return new Date().toISOString().slice(0, 10);
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
    const date = isValidDateParam(dateRaw) ? dateRaw : todayDateParam();

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

    if (!receiverId) {
      return res.status(400).json({ success: false, message: 'receiver_id is required.' });
    }
    if (!message) {
      return res.status(400).json({ success: false, message: 'message or content is required.' });
    }

    const created = await familyMessagesService.create(senderId, receiverId, message);
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

module.exports = {
  getLatestMessage,
  getMessageCount,
  createMessage,
};
