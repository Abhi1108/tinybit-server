const dailyContentService = require('../services/daily-content.service');

function isTableMissing(error) {
  return (
    error?.code === '42P01'
    || error?.code === 'PGRST205'
    || error?.code === 'ER_NO_SUCH_TABLE'
    || error?.errno === 1146
  );
}

function mapQuizForClient(row) {
  if (!row) return null;
  return {
    q: row.question,
    opts: row.options,
    ans: row.correct_index,
    question: row.question,
    options: row.options,
    correct_index: row.correct_index,
  };
}

function mapInspirationForClient(row) {
  if (!row) return null;
  return {
    text: row.quote,
    author: row.author,
  };
}

/** GET /api/content/quiz/today */
async function getTodaysQuiz(req, res) {
  try {
    const quiz = await dailyContentService.pickTodaysQuiz();

    if (!quiz) {
      return res.status(404).json({ success: false, message: 'No active quiz questions.' });
    }

    return res.json({ success: true, quiz: mapQuizForClient(quiz) });
  } catch (err) {
    console.error('[content/quiz] today', err);
    if (isTableMissing(err)) {
      return res.status(501).json({
        success: false,
        message: 'daily_quiz_questions table is not deployed.',
      });
    }
    return res.status(500).json({
      success: false,
      message: err.message || 'Could not load today\'s quiz.',
    });
  }
}

/** GET /api/content/inspiration/today */
async function getTodaysInspiration(req, res) {
  try {
    const inspiration = await dailyContentService.pickTodaysInspiration();

    if (!inspiration) {
      return res.status(404).json({ success: false, message: 'No active inspirations.' });
    }

    return res.json({
      success: true,
      inspiration: mapInspirationForClient(inspiration),
    });
  } catch (err) {
    console.error('[content/inspiration] today', err);
    if (isTableMissing(err)) {
      return res.status(501).json({
        success: false,
        message: 'daily_inspirations table is not deployed.',
      });
    }
    return res.status(500).json({
      success: false,
      message: err.message || 'Could not load today\'s inspiration.',
    });
  }
}

module.exports = {
  getTodaysQuiz,
  getTodaysInspiration,
};
