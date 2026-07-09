const { randomUUID } = require('crypto');
const { query, execute } = require('../config/mysql');

const DEFAULT_COUNTRY = '*';

function toIso(val) {
  if (!val) return val;
  if (val instanceof Date) return val.toISOString();
  return val;
}

function notFound(id) {
  const err = new Error('Pricing tier not found');
  err.status = 404;
  err.id = id;
  return err;
}

function pricingNotConfiguredError() {
  const err = new Error('No pricing is configured for this country. Add a payment_pricing_tiers row (admin) before guardians can pay.');
  err.status = 503;
  err.code = 'PRICING_NOT_CONFIGURED';
  return err;
}

function normalizeCountryCode(countryCode) {
  const raw = String(countryCode || '').trim().toUpperCase();
  return raw || DEFAULT_COUNTRY;
}

function mapTier(row) {
  if (!row) return null;
  return {
    ...row,
    amount:        Number(row.amount),
    elder_count:   Number(row.elder_count),
    interval_days: Number(row.interval_days),
    is_active:     !!row.is_active,
    created_at:    toIso(row.created_at),
    updated_at:    toIso(row.updated_at),
  };
}

/**
 * Tier lookup per ADR 0002: exact country's rows first (elder_count beyond the
 * highest configured row for that country reuses that row's price), falling back
 * to the '*' default-country row set if the country has no rows of its own at all.
 */
async function getTierForCountryAndElderCount(countryCode, elderCount) {
  const country = normalizeCountryCode(countryCode);
  const count = Math.max(1, Number(elderCount) || 1);

  const tier = await lookupTier(country, count);
  if (tier) return tier;

  if (country !== DEFAULT_COUNTRY) {
    const fallback = await lookupTier(DEFAULT_COUNTRY, count);
    if (fallback) return fallback;
  }

  throw pricingNotConfiguredError();
}

async function lookupTier(country, elderCount) {
  const rows = await query(
    `SELECT * FROM payment_pricing_tiers
     WHERE country_code = ? AND is_active = 1 AND elder_count <= ?
     ORDER BY elder_count DESC
     LIMIT 1`,
    [country, elderCount],
  );
  return mapTier(rows[0] ?? null);
}

/** The next configured tier above elderCount for this country (for "what would elder N+1 cost" UI). Null if none. */
async function getNextTier(countryCode, elderCount) {
  const country = normalizeCountryCode(countryCode);
  const count = Math.max(1, Number(elderCount) || 1);

  const rows = await query(
    `SELECT * FROM payment_pricing_tiers
     WHERE country_code = ? AND is_active = 1 AND elder_count > ?
     ORDER BY elder_count ASC
     LIMIT 1`,
    [country, count],
  );
  if (rows[0]) return mapTier(rows[0]);

  if (country !== DEFAULT_COUNTRY) {
    const fallbackRows = await query(
      `SELECT * FROM payment_pricing_tiers
       WHERE country_code = ? AND is_active = 1 AND elder_count > ?
       ORDER BY elder_count ASC
       LIMIT 1`,
      [DEFAULT_COUNTRY, count],
    );
    return mapTier(fallbackRows[0] ?? null);
  }

  return null;
}

// ── Admin CRUD ──────────────────────────────────────────────────────────────

async function listPricingTiers({ countryCode, active } = {}) {
  const clauses = [];
  const params = [];

  if (countryCode !== undefined && countryCode !== '') {
    clauses.push('country_code = ?');
    params.push(normalizeCountryCode(countryCode));
  }
  if (active !== undefined && active !== '') {
    clauses.push('is_active = ?');
    params.push(active === 'true' || active === true || active === '1' ? 1 : 0);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = await query(
    `SELECT * FROM payment_pricing_tiers ${where} ORDER BY country_code ASC, elder_count ASC`,
    params,
  );
  return rows.map(mapTier);
}

async function getPricingTierById(id) {
  const rows = await query('SELECT * FROM payment_pricing_tiers WHERE id = ? LIMIT 1', [id]);
  return mapTier(rows[0] ?? null);
}

function validateTierInput(body, { partial = false } = {}) {
  const out = {};

  if (!partial || body.country_code !== undefined) {
    out.country_code = normalizeCountryCode(body.country_code);
  }

  if (!partial || body.elder_count !== undefined) {
    const elderCount = Number(body.elder_count);
    if (!Number.isInteger(elderCount) || elderCount < 1) {
      const err = new Error('elder_count must be an integer >= 1');
      err.status = 400;
      throw err;
    }
    out.elder_count = elderCount;
  }

  if (!partial || body.amount !== undefined) {
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      const err = new Error('amount must be a positive number');
      err.status = 400;
      throw err;
    }
    out.amount = amount;
  }

  if (!partial || body.currency !== undefined) {
    const currency = String(body.currency || '').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      const err = new Error('currency must be a 3-letter ISO 4217 code, e.g. INR, USD');
      err.status = 400;
      throw err;
    }
    out.currency = currency;
  }

  if (body.interval_days !== undefined) {
    const intervalDays = Number(body.interval_days);
    if (!Number.isInteger(intervalDays) || intervalDays < 1) {
      const err = new Error('interval_days must be an integer >= 1');
      err.status = 400;
      throw err;
    }
    out.interval_days = intervalDays;
  }

  if (body.is_active !== undefined) {
    out.is_active = body.is_active ? 1 : 0;
  }

  return out;
}

async function createPricingTier(body) {
  const input = validateTierInput(body, { partial: false });
  const id = randomUUID();

  try {
    await execute(
      `INSERT INTO payment_pricing_tiers
         (id, country_code, elder_count, amount, currency, interval_days, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.country_code,
        input.elder_count,
        input.amount,
        input.currency,
        input.interval_days ?? 365,
        input.is_active ?? 1,
      ],
    );
  } catch (err) {
    if (err?.code === 'ER_DUP_ENTRY' || err?.errno === 1062) {
      const dup = new Error(`A pricing tier already exists for country '${input.country_code}' at elder_count ${input.elder_count}`);
      dup.status = 409;
      throw dup;
    }
    throw err;
  }

  return getPricingTierById(id);
}

async function updatePricingTier(id, body) {
  const existing = await getPricingTierById(id);
  if (!existing) throw notFound(id);

  const input = validateTierInput(body, { partial: true });
  const fields = Object.keys(input);
  if (!fields.length) return existing;

  const setClause = fields.map((key) => `${key} = ?`).join(', ');
  const params = fields.map((key) => input[key]);
  params.push(id);

  try {
    await execute(`UPDATE payment_pricing_tiers SET ${setClause} WHERE id = ?`, params);
  } catch (err) {
    if (err?.code === 'ER_DUP_ENTRY' || err?.errno === 1062) {
      const dup = new Error('Another pricing tier already exists for that country_code + elder_count combination');
      dup.status = 409;
      throw dup;
    }
    throw err;
  }

  return getPricingTierById(id);
}

async function deletePricingTier(id) {
  const existing = await getPricingTierById(id);
  if (!existing) throw notFound(id);
  await execute('DELETE FROM payment_pricing_tiers WHERE id = ?', [id]);
  return { id };
}

module.exports = {
  DEFAULT_COUNTRY,
  normalizeCountryCode,
  getTierForCountryAndElderCount,
  getNextTier,
  listPricingTiers,
  getPricingTierById,
  createPricingTier,
  updatePricingTier,
  deletePricingTier,
  pricingNotConfiguredError,
};
