const mindGamesService = require('../services/mind-games.service');

const AVATAR_COLORS = ['#5B8DEF', '#E87C7C', '#7BC67E', '#5CB8B2', '#E87C22'];

function isTableMissing(error) {
  return (
    error?.code === '42P01'
    || error?.code === 'PGRST205'
    || error?.code === 'ER_NO_SUCH_TABLE'
    || error?.errno === 1146
  );
}

function readBody(req) {
  return req.body ?? {};
}

function resolveUserId(req) {
  return req.auth?.userId ?? req.supabase?.userId ?? null;
}

function formatLeaderboardEntry(entry, currentUserId, index) {
  const isSelf = entry.userId === currentUserId;
  const sub = isSelf
    ? `You · ${entry.score} pts`
    : entry.location
      ? `From · ${entry.location}`
      : `${entry.score} pts`;

  return {
    userId: entry.userId,
    name: entry.name,
    initial: entry.name.charAt(0).toUpperCase(),
    sub,
    score: entry.score,
    avatarBg: AVATAR_COLORS[index % AVATAR_COLORS.length],
  };
}

/** POST /api/mind-games/scores */
async function postScore(req, res) {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const body = readBody(req);
    const game_type = body.game_type ?? body.gameType;
    const score = body.score;
    const durationSeconds = body.duration_seconds ?? body.durationSeconds ?? 0;

    if (!game_type || !String(game_type).trim()) {
      return res.status(400).json({ success: false, message: 'game_type is required.' });
    }

    if (score == null || Number.isNaN(Number(score))) {
      return res.status(400).json({ success: false, message: 'score is required.' });
    }

    if (Number.isNaN(Number(durationSeconds))) {
      return res.status(400).json({ success: false, message: 'duration_seconds must be a number.' });
    }

    const row = await mindGamesService.insertScore(userId, {
      game_type: String(game_type).trim(),
      score: Number(score),
      duration_seconds: Number(durationSeconds),
    });

    return res.json({ success: true, score: row });
  } catch (err) {
    console.error('[mind-games] postScore', err);
    if (isTableMissing(err)) {
      return res.status(501).json({
        success: false,
        message: 'mind_games_scores table is not deployed.',
      });
    }
    if (err?.code === 'ER_CHECK_CONSTRAINT_VIOLATED' || err?.errno === 3819) {
      return res.status(400).json({
        success: false,
        message: 'Invalid score value.',
      });
    }
    return res.status(500).json({
      success: false,
      message: err.message || 'Could not save score.',
    });
  }
}

/** GET /api/mind-games/stats */
async function getStats(req, res) {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const stats = await mindGamesService.getUserStats(userId);

    return res.json({ success: true, stats });
  } catch (err) {
    console.error('[mind-games] getStats', err);
    if (isTableMissing(err)) {
      return res.status(501).json({
        success: false,
        message: 'mind_games_scores table is not deployed.',
      });
    }
    return res.status(500).json({
      success: false,
      message: err.message || 'Could not load mind games stats.',
    });
  }
}

/** GET /api/mind-games/leaderboard */
async function getLeaderboard(req, res) {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const limit = req.query.limit ?? 5;
    const rows = await mindGamesService.getLeaderboard(limit);
    const leaderboard = rows.map((entry, index) => formatLeaderboardEntry(entry, userId, index));

    return res.json({ success: true, leaderboard });
  } catch (err) {
    console.error('[mind-games] getLeaderboard', err);
    if (isTableMissing(err)) {
      return res.status(501).json({
        success: false,
        message: 'mind_games_scores table is not deployed.',
      });
    }
    return res.status(500).json({
      success: false,
      message: err.message || 'Could not load leaderboard.',
    });
  }
}

module.exports = {
  postScore,
  getStats,
  getLeaderboard,
};
