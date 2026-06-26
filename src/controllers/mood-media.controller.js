const moodMediaService = require('../services/mood-media.service');

const VALID_CATEGORIES = new Set(['bhajans', 'meditation', 'jokes_fun', 'nature_sounds']);

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

/** GET /api/mood-media/:category */
async function listByCategory(req, res) {
  try {
    const category = String(req.params.category ?? '').trim();

    if (!VALID_CATEGORIES.has(category)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid category. Use bhajans, meditation, jokes_fun, or nature_sounds.',
      });
    }

    const tracks = await moodMediaService.listByCategory(category);
    return res.json({ success: true, tracks });
  } catch (err) {
    console.error('[mood-media] list', err);
    if (isTableMissing(err)) {
      return res.status(501).json({
        success: false,
        message: 'mood_media_tracks table is not deployed.',
      });
    }
    return res.status(500).json({
      success: false,
      message: err.message || 'Could not load mood media tracks.',
    });
  }
}

/** GET /api/mood-media/favorites */
async function listFavorites(req, res) {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const tracks = await moodMediaService.listFavorites(userId);
    return res.json({ success: true, tracks });
  } catch (err) {
    console.error('[mood-media] favorites list', err);
    if (isTableMissing(err)) {
      return res.status(501).json({
        success: false,
        message: 'mood_media_favorites table is not deployed.',
      });
    }
    return res.status(500).json({
      success: false,
      message: err.message || 'Could not load favorites.',
    });
  }
}

/** POST /api/mood-media/favorites — body: { track_id } */
async function addFavorite(req, res) {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const body = readBody(req);
    const trackId = String(body.track_id ?? body.trackId ?? '').trim();

    if (!trackId) {
      return res.status(400).json({ success: false, message: 'track_id is required.' });
    }

    const favorite = await moodMediaService.addFavorite(userId, trackId);
    return res.json({ success: true, favorite });
  } catch (err) {
    console.error('[mood-media] favorites add', err);
    if (isTableMissing(err)) {
      return res.status(501).json({
        success: false,
        message: 'mood_media_favorites table is not deployed.',
      });
    }
    return res.status(500).json({
      success: false,
      message: err.message || 'Could not add favorite.',
    });
  }
}

/** DELETE /api/mood-media/favorites/:trackId */
async function removeFavorite(req, res) {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const trackId = String(req.params.trackId ?? '').trim();
    if (!trackId) {
      return res.status(400).json({ success: false, message: 'trackId is required.' });
    }

    const removed = await moodMediaService.removeFavorite(userId, trackId);

    if (!removed) {
      return res.status(404).json({ success: false, message: 'Favorite not found.' });
    }

    return res.json({ success: true, favorite: removed });
  } catch (err) {
    console.error('[mood-media] favorites remove', err);
    if (isTableMissing(err)) {
      return res.status(501).json({
        success: false,
        message: 'mood_media_favorites table is not deployed.',
      });
    }
    return res.status(500).json({
      success: false,
      message: err.message || 'Could not remove favorite.',
    });
  }
}

module.exports = {
  listByCategory,
  listFavorites,
  addFavorite,
  removeFavorite,
};
