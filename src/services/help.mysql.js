const { query } = require('../config/mysql');

function mapTutorialRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    description: row.description ?? null,
    video_url: row.video_url ?? null,
    thumbnail_url: row.thumbnail_url ?? null,
    difficulty: row.difficulty,
    duration_seconds: row.duration_seconds == null ? null : Number(row.duration_seconds),
    sort_order: row.sort_order == null ? 0 : Number(row.sort_order),
  };
}

function mapFaqRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    question: row.question,
    answer: row.answer,
    sort_order: row.sort_order == null ? 0 : Number(row.sort_order),
  };
}

/** GET-facing: active tutorials only, optionally filtered by category. */
async function listActiveTutorials(category) {
  const clauses = ['is_active = 1'];
  const params = [];
  if (category) {
    clauses.push('category = ?');
    params.push(category);
  }

  const rows = await query(
    `SELECT id, category, title, description, video_url, thumbnail_url,
            difficulty, duration_seconds, sort_order
     FROM help_tutorials
     WHERE ${clauses.join(' AND ')}
     ORDER BY category ASC, sort_order ASC`,
    params,
  );

  return rows.map(mapTutorialRow);
}

/** GET-facing: active FAQs only. */
async function listActiveFaqs() {
  const rows = await query(
    `SELECT id, question, answer, sort_order
     FROM help_faqs
     WHERE is_active = 1
     ORDER BY sort_order ASC`,
  );

  return rows.map(mapFaqRow);
}

module.exports = { listActiveTutorials, listActiveFaqs };
