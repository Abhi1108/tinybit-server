const { query } = require('../config/mysql');

const QUIZ_SELECT = 'id, question, options, correct_index, active, sort_order, created_at';
const INSPIRATION_SELECT = 'id, quote, author, active, sort_order, created_at';

function parseJsonArray(value) {
  if (value == null) return value;
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

function toIsoString(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function mapQuizRow(row) {
  if (!row) return null;

  return {
    id: row.id,
    question: row.question,
    options: parseJsonArray(row.options),
    correct_index: Number(row.correct_index),
    active: Boolean(row.active),
    sort_order: Number(row.sort_order ?? 0),
    created_at: toIsoString(row.created_at),
  };
}

function mapInspirationRow(row) {
  if (!row) return null;

  return {
    id: row.id,
    quote: row.quote,
    author: row.author,
    active: Boolean(row.active),
    sort_order: Number(row.sort_order ?? 0),
    created_at: toIsoString(row.created_at),
  };
}

function getDailyIndex(length) {
  const now = new Date();
  const dateString = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  let hash = 0;
  for (let i = 0; i < dateString.length; i++) {
    hash = (hash << 5) - hash + dateString.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % length;
}

async function getActiveQuizQuestions() {
  const rows = await query(
    `SELECT ${QUIZ_SELECT}
     FROM daily_quiz_questions
     WHERE active = 1
     ORDER BY sort_order ASC`,
  );
  return rows.map(mapQuizRow);
}

async function getActiveInspirations() {
  const rows = await query(
    `SELECT ${INSPIRATION_SELECT}
     FROM daily_inspirations
     WHERE active = 1
     ORDER BY sort_order ASC`,
  );
  return rows.map(mapInspirationRow);
}

async function pickTodaysQuiz() {
  const questions = await getActiveQuizQuestions();
  if (!questions.length) return null;
  return questions[getDailyIndex(questions.length)];
}

async function pickTodaysInspiration() {
  const inspirations = await getActiveInspirations();
  if (!inspirations.length) return null;
  return inspirations[getDailyIndex(inspirations.length)];
}

module.exports = {
  getActiveQuizQuestions,
  getActiveInspirations,
  pickTodaysQuiz,
  pickTodaysInspiration,
};
