const helpService = require('../services/help.service');

function isTableMissing(error) {
  return (
    error?.code === 'ER_NO_SUCH_TABLE'
    || error?.errno === 1146
  );
}

/** GET /api/help/tutorials — optional ?category= */
async function listTutorials(req, res) {
  try {
    const category = String(req.query.category ?? '').trim() || undefined;
    const tutorials = await helpService.listActiveTutorials(category);
    return res.json({ success: true, tutorials });
  } catch (err) {
    console.error('[help] listTutorials', err);
    if (isTableMissing(err)) {
      return res.status(501).json({ success: false, message: 'help_tutorials table is not deployed.' });
    }
    return res.status(500).json({ success: false, message: err.message || 'Could not load tutorials.' });
  }
}

/** GET /api/help/faqs */
async function listFaqs(req, res) {
  try {
    const faqs = await helpService.listActiveFaqs();
    return res.json({ success: true, faqs });
  } catch (err) {
    console.error('[help] listFaqs', err);
    if (isTableMissing(err)) {
      return res.status(501).json({ success: false, message: 'help_faqs table is not deployed.' });
    }
    return res.status(500).json({ success: false, message: err.message || 'Could not load FAQs.' });
  }
}

module.exports = { listTutorials, listFaqs };
