const journalService = require('../services/journal.service');

const VALID_TYPES = new Set(['Written', 'Voice']);

function isTableMissing(error) {
  return (
    error?.code === 'ER_NO_SUCH_TABLE'
    || error?.errno === 1146
  );
}

function readBody(req) {
  return req.body ?? {};
}

function resolveJournalAudioUrl(body) {
  const url = body.audio_uri ?? body.audioUri ?? body.audio_url ?? body.audioUrl;
  if (url == null || !String(url).trim()) return null;

  const raw = String(url).trim();
  if (!/^https?:\/\//i.test(raw)) {
    return null;
  }

  return raw;
}

/** GET /api/journal */
async function listJournalEntries(req, res) {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const entries = await journalService.listByUser(userId);
    return res.json({ success: true, entries });
  } catch (err) {
    console.error('[journal] list', err);
    if (isTableMissing(err)) {
      return res.status(501).json({
        success: false,
        message: 'journal table is not deployed.',
      });
    }
    return res.status(500).json({
      success: false,
      message: err.message || 'Could not load journal entries.',
    });
  }
}

/** GET /api/journal/count */
async function getJournalCount(req, res) {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const count = await journalService.countByUser(userId);
    return res.json({ success: true, count });
  } catch (err) {
    console.error('[journal] count', err);
    if (isTableMissing(err)) {
      return res.status(501).json({ success: false, message: 'journal table is not deployed.' });
    }
    return res.status(500).json({
      success: false,
      message: err.message || 'Could not count journal entries.',
    });
  }
}

/** POST /api/journal */
async function createJournalEntry(req, res) {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const body = readBody(req);
    const type = String(body.type ?? '').trim();
    const content = String(body.content ?? '').trim();
    const prompt = body.prompt == null ? null : String(body.prompt);
    const audioUri = resolveJournalAudioUrl(body);

    if (!VALID_TYPES.has(type)) {
      return res.status(400).json({
        success: false,
        message: 'Type must be Written or Voice.',
      });
    }

    if (!content && type === 'Written') {
      return res.status(400).json({ success: false, message: 'Content is required.' });
    }

    if (type === 'Voice') {
      if (!audioUri) {
        return res.status(400).json({
          success: false,
          message: 'Voice entries require audio_url (HTTPS). Upload via POST /api/storage/presign-upload first.',
        });
      }
    }

    const entry = await journalService.create(userId, {
      type,
      content: content || (type === 'Voice' ? 'Voice memory' : ''),
      audio_uri: audioUri,
      prompt,
    });

    return res.json({ success: true, entry });
  } catch (err) {
    console.error('[journal] create', err);
    if (isTableMissing(err)) {
      return res.status(501).json({ success: false, message: 'journal table is not deployed.' });
    }
    return res.status(500).json({
      success: false,
      message: err.message || 'Could not save journal entry.',
    });
  }
}

module.exports = {
  listJournalEntries,
  getJournalCount,
  createJournalEntry,
};
