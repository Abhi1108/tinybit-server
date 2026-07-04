const { randomUUID } = require('crypto');
const { query, execute } = require('../config/mysql');

const MOOD_CATEGORIES = new Set(['bhajans', 'meditation', 'jokes_fun', 'nature_sounds']);
const MOOD_MEDIA_TYPES = new Set(['audio', 'video', 'youtube']);
const YOUTUBE_ID_RE = /^[a-zA-Z0-9_-]{11}$/;
const YOUTUBE_URL_RE = /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[a-zA-Z0-9_-]{11}(&.*)?$/i;

function toIso(val) {
  if (!val) return val;
  if (val instanceof Date) return val.toISOString();
  return val;
}

function parsePageLimit(page, limit) {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  return { pageNum, limitNum, offset: (pageNum - 1) * limitNum };
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function notFound(table, id) {
  const err = new Error(`${table} record not found`);
  err.status = 404;
  err.id = id;
  return err;
}

function requireHttpsMediaUrl(value, fieldName, { required = false } = {}) {
  if (value == null || String(value).trim() === '') {
    if (required) {
      const err = new Error(`${fieldName} is required.`);
      err.status = 400;
      throw err;
    }
    return null;
  }

  const raw = String(value).trim();
  if (!/^https?:\/\//i.test(raw)) {
    const err = new Error(
      `${fieldName} must be an HTTPS URL. Upload via POST /admin/api/storage/presign-upload first.`,
    );
    err.status = 400;
    throw err;
  }

  return raw;
}

function requireYoutubeRef(value, fieldName, { required = false } = {}) {
  if (value == null || String(value).trim() === '') {
    if (required) {
      const err = new Error(`${fieldName} is required.`);
      err.status = 400;
      throw err;
    }
    return null;
  }

  const raw = String(value).trim();
  if (YOUTUBE_URL_RE.test(raw) || YOUTUBE_ID_RE.test(raw)) {
    return raw;
  }

  const err = new Error(
    `${fieldName} must be a YouTube URL (youtube.com/watch?v=... or youtu.be/...) or an 11-character video id.`,
  );
  err.status = 400;
  throw err;
}

// ── Doctors ─────────────────────────────────────────────────────────────────

function mapDoctor(row) {
  if (!row) return null;
  return {
    ...row,
    rating: row.rating == null ? null : Number(row.rating),
    is_active: !!row.is_active,
    sort_order: Number(row.sort_order ?? 0),
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
  };
}

async function listDoctors({ page, limit, specialty, active, search }) {
  const { limitNum, offset } = parsePageLimit(page, limit);
  const clauses = [];
  const params = [];

  if (specialty) {
    clauses.push('specialty = ?');
    params.push(specialty);
  }
  if (active !== undefined && active !== '') {
    clauses.push('is_active = ?');
    params.push(active === 'true' || active === true || active === '1' ? 1 : 0);
  }
  if (search) {
    clauses.push('(name LIKE ? OR specialty LIKE ? OR address LIKE ? OR hospital LIKE ?)');
    const q = `%${search}%`;
    params.push(q, q, q, q);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = await query(
    `SELECT id, name, specialty, rating, experience, fee, address, image_url,
            hospital, phone, email, about,
            is_active, sort_order, created_at, updated_at
     FROM doctors
     ${where}
     ORDER BY sort_order ASC, name ASC
     LIMIT ${limitNum} OFFSET ${offset}`,
    params,
  );

  return rows.map(mapDoctor);
}

async function getDoctorById(id) {
  const rows = await query(
    `SELECT id, name, specialty, rating, experience, fee, address, image_url,
            hospital, phone, email, about,
            is_active, sort_order, created_at, updated_at
     FROM doctors WHERE id = ? LIMIT 1`,
    [id],
  );
  return mapDoctor(rows[0] ?? null);
}

async function createDoctor(body) {
  const {
    name, specialty, rating, experience, fee, address, image_url,
    hospital, phone, email, about,
    is_active, sort_order
  } = body ?? {};
  if (!name?.trim() || !specialty?.trim() || !experience?.trim()) {
    const err = new Error('name, specialty, and experience are required');
    err.status = 400;
    throw err;
  }

  const id = randomUUID();
  const normalizedImageUrl = requireHttpsMediaUrl(image_url, 'image_url');
  await execute(
    `INSERT INTO doctors
       (id, name, specialty, rating, experience, fee, address, image_url,
        hospital, phone, email, about, is_active, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      name.trim(),
      specialty.trim(),
      rating ?? 4.5,
      experience.trim(),
      fee?.trim() || null,
      address?.trim() || null,
      normalizedImageUrl,
      hospital?.trim() || null,
      phone?.trim() || null,
      email?.trim() || null,
      about?.trim() || null,
      is_active === false || is_active === 0 ? 0 : 1,
      sort_order ?? 0,
    ],
  );
  return getDoctorById(id);
}

async function updateDoctor(id, body) {
  const existing = await getDoctorById(id);
  if (!existing) throw notFound('Doctor', id);

  const fields = [];
  const params = [];
  const allowed = [
    'name', 'specialty', 'rating', 'experience', 'fee', 'address', 'image_url',
    'hospital', 'phone', 'email', 'about', 'is_active', 'sort_order'
  ];

  for (const key of allowed) {
    if (body[key] === undefined) continue;
    if (key === 'is_active') {
      fields.push('is_active = ?');
      params.push(body[key] ? 1 : 0);
    } else if (key === 'rating') {
      fields.push(`${key} = ?`);
      params.push(body[key]);
    } else if (key === 'image_url') {
      fields.push('image_url = ?');
      params.push(requireHttpsMediaUrl(body[key], 'image_url'));
    } else {
      fields.push(`${key} = ?`);
      params.push(typeof body[key] === 'string' ? body[key].trim() : body[key]);
    }
  }

  if (!fields.length) return existing;

  params.push(id);
  await execute(`UPDATE doctors SET ${fields.join(', ')} WHERE id = ?`, params);
  return getDoctorById(id);
}

async function deleteDoctor(id) {
  const existing = await getDoctorById(id);
  if (!existing) throw notFound('Doctor', id);
  await execute('DELETE FROM doctors WHERE id = ?', [id]);
  return { id };
}

// ── Mood media tracks ───────────────────────────────────────────────────────

function mapMoodTrack(row) {
  if (!row) return null;
  return {
    ...row,
    duration_seconds: row.duration_seconds == null ? null : Number(row.duration_seconds),
    is_active: !!row.is_active,
    sort_order: Number(row.sort_order ?? 0),
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
  };
}

async function listMoodMediaTracks({ page, limit, category, active, search }) {
  const { limitNum, offset } = parsePageLimit(page, limit);
  const clauses = [];
  const params = [];

  if (category) {
    clauses.push('category = ?');
    params.push(category);
  }
  if (active !== undefined && active !== '') {
    clauses.push('is_active = ?');
    params.push(active === 'true' || active === true || active === '1' ? 1 : 0);
  }
  if (search) {
    clauses.push('(title LIKE ? OR subtitle LIKE ?)');
    const q = `%${search}%`;
    params.push(q, q);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = await query(
    `SELECT id, category, media_type, title, subtitle, duration_seconds, duration_label,
            icon_name, icon_url, audio_url, media_url, sort_order, is_active, created_at, updated_at
     FROM mood_media_tracks
     ${where}
     ORDER BY category ASC, sort_order ASC, title ASC
     LIMIT ${limitNum} OFFSET ${offset}`,
    params,
  );

  return rows.map(mapMoodTrack);
}

async function getMoodMediaTrackById(id) {
  const rows = await query(
    `SELECT id, category, media_type, title, subtitle, duration_seconds, duration_label,
            icon_name, icon_url, audio_url, media_url, sort_order, is_active, created_at, updated_at
     FROM mood_media_tracks WHERE id = ? LIMIT 1`,
    [id],
  );
  return mapMoodTrack(rows[0] ?? null);
}

function validateMoodMediaUrls(mediaType, { audio_url, media_url }) {
  if (mediaType === 'audio') {
    return {
      normalizedAudioUrl: requireHttpsMediaUrl(audio_url, 'audio_url', { required: true }),
      normalizedMediaUrl: null,
    };
  }
  if (mediaType === 'video') {
    return {
      normalizedAudioUrl: null,
      normalizedMediaUrl: requireHttpsMediaUrl(media_url, 'media_url', { required: true }),
    };
  }
  // youtube
  return {
    normalizedAudioUrl: null,
    normalizedMediaUrl: requireYoutubeRef(media_url, 'media_url', { required: true }),
  };
}

async function createMoodMediaTrack(body) {
  const {
    category, media_type, title, subtitle, duration_seconds, duration_label,
    icon_name, icon_url, audio_url, media_url, sort_order, is_active,
  } = body ?? {};

  if (!category || !MOOD_CATEGORIES.has(category)) {
    const err = new Error('category must be one of: bhajans, meditation, jokes_fun, nature_sounds');
    err.status = 400;
    throw err;
  }
  if (!title?.trim()) {
    const err = new Error('title is required');
    err.status = 400;
    throw err;
  }

  const mediaType = media_type === undefined ? 'audio' : media_type;
  if (!MOOD_MEDIA_TYPES.has(mediaType)) {
    const err = new Error('media_type must be one of: audio, video, youtube');
    err.status = 400;
    throw err;
  }

  const { normalizedAudioUrl, normalizedMediaUrl } = validateMoodMediaUrls(mediaType, { audio_url, media_url });
  const normalizedIconUrl = requireHttpsMediaUrl(icon_url, 'icon_url');

  const id = randomUUID();
  await execute(
    `INSERT INTO mood_media_tracks
       (id, category, media_type, title, subtitle, duration_seconds, duration_label,
        icon_name, icon_url, audio_url, media_url, sort_order, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      category,
      mediaType,
      title.trim(),
      subtitle?.trim() || null,
      duration_seconds ?? null,
      duration_label?.trim() || null,
      icon_name?.trim() || null,
      normalizedIconUrl,
      normalizedAudioUrl,
      normalizedMediaUrl,
      sort_order ?? 0,
      is_active === false || is_active === 0 ? 0 : 1,
    ],
  );
  return getMoodMediaTrackById(id);
}

async function updateMoodMediaTrack(id, body) {
  const existing = await getMoodMediaTrackById(id);
  if (!existing) throw notFound('Mood media track', id);

  if (body.category !== undefined && !MOOD_CATEGORIES.has(body.category)) {
    const err = new Error('Invalid category');
    err.status = 400;
    throw err;
  }
  if (body.media_type !== undefined && !MOOD_MEDIA_TYPES.has(body.media_type)) {
    const err = new Error('media_type must be one of: audio, video, youtube');
    err.status = 400;
    throw err;
  }

  // Effective media_type after this update — used to validate whichever URL field(s) are present.
  const effectiveMediaType = body.media_type !== undefined ? body.media_type : existing.media_type;

  const fields = [];
  const params = [];
  const allowed = [
    'category', 'media_type', 'title', 'subtitle', 'duration_seconds', 'duration_label',
    'icon_name', 'icon_url', 'audio_url', 'media_url', 'sort_order', 'is_active',
  ];
  const typeChanging = body.media_type !== undefined && body.media_type !== existing.media_type;

  for (const key of allowed) {
    if (body[key] === undefined) continue;
    if (key === 'is_active') {
      fields.push('is_active = ?');
      params.push(body[key] ? 1 : 0);
    } else if (key === 'duration_seconds' || key === 'sort_order') {
      fields.push(`${key} = ?`);
      params.push(body[key]);
    } else if (key === 'audio_url') {
      if (effectiveMediaType !== 'audio') continue;
      fields.push('audio_url = ?');
      params.push(requireHttpsMediaUrl(body[key], 'audio_url', { required: true }));
    } else if (key === 'media_url') {
      if (effectiveMediaType === 'audio') continue;
      fields.push('media_url = ?');
      params.push(
        effectiveMediaType === 'youtube'
          ? requireYoutubeRef(body[key], 'media_url', { required: true })
          : requireHttpsMediaUrl(body[key], 'media_url', { required: true }),
      );
    } else if (key === 'icon_url') {
      fields.push('icon_url = ?');
      params.push(requireHttpsMediaUrl(body[key], 'icon_url'));
    } else {
      fields.push(`${key} = ?`);
      params.push(typeof body[key] === 'string' ? body[key].trim() : body[key]);
    }
  }

  // If media_type is changing, make sure the matching URL field ends up populated — either
  // supplied in this same request or already present on the existing row — otherwise the DB
  // CHECK constraint would reject the row. Also null out the now-irrelevant column so stale
  // data from the previous media_type doesn't linger on the row.
  if (typeChanging) {
    if (effectiveMediaType === 'audio') {
      if (body.audio_url === undefined) {
        requireHttpsMediaUrl(existing.audio_url, 'audio_url', { required: true });
      }
      if (body.media_url === undefined) {
        fields.push('media_url = ?');
        params.push(null);
      }
    } else {
      if (body.media_url === undefined) {
        if (effectiveMediaType === 'video') {
          requireHttpsMediaUrl(existing.media_url, 'media_url', { required: true });
        } else {
          requireYoutubeRef(existing.media_url, 'media_url', { required: true });
        }
      }
      if (body.audio_url === undefined) {
        fields.push('audio_url = ?');
        params.push(null);
      }
    }
  }

  if (!fields.length) return existing;

  params.push(id);
  await execute(`UPDATE mood_media_tracks SET ${fields.join(', ')} WHERE id = ?`, params);
  return getMoodMediaTrackById(id);
}

async function deleteMoodMediaTrack(id) {
  const existing = await getMoodMediaTrackById(id);
  if (!existing) throw notFound('Mood media track', id);
  await execute('DELETE FROM mood_media_tracks WHERE id = ?', [id]);
  return { id };
}

// ── Daily quiz questions ────────────────────────────────────────────────────

function mapQuiz(row) {
  if (!row) return null;
  return {
    id: row.id,
    question: row.question,
    options: parseJsonArray(row.options) ?? row.options,
    correct_index: Number(row.correct_index),
    active: !!row.active,
    sort_order: Number(row.sort_order ?? 0),
    created_at: toIso(row.created_at),
  };
}

async function listQuizQuestions({ page, limit, active, search }) {
  const { limitNum, offset } = parsePageLimit(page, limit);
  const clauses = [];
  const params = [];

  if (active !== undefined && active !== '') {
    clauses.push('active = ?');
    params.push(active === 'true' || active === true || active === '1' ? 1 : 0);
  }
  if (search) {
    clauses.push('question LIKE ?');
    params.push(`%${search}%`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = await query(
    `SELECT id, question, options, correct_index, active, sort_order, created_at
     FROM daily_quiz_questions
     ${where}
     ORDER BY sort_order ASC
     LIMIT ${limitNum} OFFSET ${offset}`,
    params,
  );

  return rows.map(mapQuiz);
}

async function getQuizQuestionById(id) {
  const rows = await query(
    `SELECT id, question, options, correct_index, active, sort_order, created_at
     FROM daily_quiz_questions WHERE id = ? LIMIT 1`,
    [id],
  );
  return mapQuiz(rows[0] ?? null);
}

async function createQuizQuestion(body) {
  const { question, options, correct_index, active, sort_order } = body ?? {};
  const opts = parseJsonArray(options);

  if (!question?.trim() || !opts?.length || opts.length < 2) {
    const err = new Error('question and options (array, min 2) are required');
    err.status = 400;
    throw err;
  }
  if (correct_index == null || correct_index < 0 || correct_index >= opts.length) {
    const err = new Error('correct_index must be a valid option index');
    err.status = 400;
    throw err;
  }

  const id = randomUUID();
  await execute(
    `INSERT INTO daily_quiz_questions (id, question, options, correct_index, active, sort_order)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      id,
      question.trim(),
      JSON.stringify(opts),
      correct_index,
      active === false || active === 0 ? 0 : 1,
      sort_order ?? 0,
    ],
  );
  return getQuizQuestionById(id);
}

async function updateQuizQuestion(id, body) {
  const existing = await getQuizQuestionById(id);
  if (!existing) throw notFound('Quiz question', id);

  const fields = [];
  const params = [];

  if (body.question !== undefined) {
    fields.push('question = ?');
    params.push(String(body.question).trim());
  }
  if (body.options !== undefined) {
    const opts = parseJsonArray(body.options);
    if (!opts?.length) {
      const err = new Error('options must be a non-empty array');
      err.status = 400;
      throw err;
    }
    fields.push('options = ?');
    params.push(JSON.stringify(opts));
  }
  if (body.correct_index !== undefined) {
    fields.push('correct_index = ?');
    params.push(body.correct_index);
  }
  if (body.active !== undefined) {
    fields.push('active = ?');
    params.push(body.active ? 1 : 0);
  }
  if (body.sort_order !== undefined) {
    fields.push('sort_order = ?');
    params.push(body.sort_order);
  }

  if (!fields.length) return existing;

  params.push(id);
  await execute(`UPDATE daily_quiz_questions SET ${fields.join(', ')} WHERE id = ?`, params);
  return getQuizQuestionById(id);
}

async function deleteQuizQuestion(id) {
  const existing = await getQuizQuestionById(id);
  if (!existing) throw notFound('Quiz question', id);
  await execute('DELETE FROM daily_quiz_questions WHERE id = ?', [id]);
  return { id };
}

// ── Daily inspirations ──────────────────────────────────────────────────────

function mapInspiration(row) {
  if (!row) return null;
  return {
    ...row,
    active: !!row.active,
    sort_order: Number(row.sort_order ?? 0),
    created_at: toIso(row.created_at),
  };
}

async function listInspirations({ page, limit, active, search }) {
  const { limitNum, offset } = parsePageLimit(page, limit);
  const clauses = [];
  const params = [];

  if (active !== undefined && active !== '') {
    clauses.push('active = ?');
    params.push(active === 'true' || active === true || active === '1' ? 1 : 0);
  }
  if (search) {
    clauses.push('(quote LIKE ? OR author LIKE ?)');
    const q = `%${search}%`;
    params.push(q, q);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = await query(
    `SELECT id, quote, author, active, sort_order, created_at
     FROM daily_inspirations
     ${where}
     ORDER BY sort_order ASC
     LIMIT ${limitNum} OFFSET ${offset}`,
    params,
  );

  return rows.map(mapInspiration);
}

async function getInspirationById(id) {
  const rows = await query(
    `SELECT id, quote, author, active, sort_order, created_at
     FROM daily_inspirations WHERE id = ? LIMIT 1`,
    [id],
  );
  return mapInspiration(rows[0] ?? null);
}

async function createInspiration(body) {
  const { quote, author, active, sort_order } = body ?? {};
  if (!quote?.trim() || !author?.trim()) {
    const err = new Error('quote and author are required');
    err.status = 400;
    throw err;
  }

  const id = randomUUID();
  await execute(
    `INSERT INTO daily_inspirations (id, quote, author, active, sort_order)
     VALUES (?, ?, ?, ?, ?)`,
    [
      id,
      quote.trim(),
      author.trim(),
      active === false || active === 0 ? 0 : 1,
      sort_order ?? 0,
    ],
  );
  return getInspirationById(id);
}

async function updateInspiration(id, body) {
  const existing = await getInspirationById(id);
  if (!existing) throw notFound('Inspiration', id);

  const fields = [];
  const params = [];
  const allowed = ['quote', 'author', 'active', 'sort_order'];

  for (const key of allowed) {
    if (body[key] === undefined) continue;
    if (key === 'active') {
      fields.push('active = ?');
      params.push(body[key] ? 1 : 0);
    } else if (key === 'sort_order') {
      fields.push('sort_order = ?');
      params.push(body[key]);
    } else {
      fields.push(`${key} = ?`);
      params.push(String(body[key]).trim());
    }
  }

  if (!fields.length) return existing;

  params.push(id);
  await execute(`UPDATE daily_inspirations SET ${fields.join(', ')} WHERE id = ?`, params);
  return getInspirationById(id);
}

async function deleteInspiration(id) {
  const existing = await getInspirationById(id);
  if (!existing) throw notFound('Inspiration', id);
  await execute('DELETE FROM daily_inspirations WHERE id = ?', [id]);
  return { id };
}

module.exports = {
  listDoctors,
  getDoctorById,
  createDoctor,
  updateDoctor,
  deleteDoctor,
  listMoodMediaTracks,
  getMoodMediaTrackById,
  createMoodMediaTrack,
  updateMoodMediaTrack,
  deleteMoodMediaTrack,
  listQuizQuestions,
  getQuizQuestionById,
  createQuizQuestion,
  updateQuizQuestion,
  deleteQuizQuestion,
  listInspirations,
  getInspirationById,
  createInspiration,
  updateInspiration,
  deleteInspiration,
};
