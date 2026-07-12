const mysql = require('mysql2/promise');

let pool;

function getPool() {
  if (pool) return pool;

  const url = process.env.MYSQL_URL?.trim();
  if (url) {
    pool = mysql.createPool({
      uri:            url,
      waitForConnections: true,
      connectionLimit:  10,
      timezone:         '+00:00',
    });
    return pool;
  }

  const host = process.env.MYSQL_HOST || '127.0.0.1';
  const port = parseInt(process.env.MYSQL_PORT || '3306', 10);
  const user = process.env.MYSQL_USER || 'root';
  const password = process.env.MYSQL_PASSWORD || '';
  const database = process.env.MYSQL_DATABASE || 'tinybit';

  pool = mysql.createPool({
    host,
    port,
    user,
    password,
    database,
    waitForConnections: true,
    connectionLimit:    10,
    timezone:           '+00:00',
  });

  return pool;
}

/** Run a parameterized query; returns row array. */
async function query(sql, params = []) {
  const [rows] = await getPool().execute(sql, params);
  return rows;
}

/** Run insert/update/delete; returns ResultSetHeader. */
async function execute(sql, params = []) {
  const [result] = await getPool().execute(sql, params);
  return result;
}

/**
 * Runs `fn(conn)` inside a single transaction — commits on success, rolls back and
 * rethrows on error, always releases the connection. `conn` is a raw mysql2
 * PoolConnection; use `conn.execute(sql, params)` inside `fn` (same call shape as the
 * pool-level `execute` above, returns `[result]`/`[rows]`).
 */
async function withTransaction(fn) {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    try { await conn.rollback(); } catch { /* rollback best-effort */ }
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { getPool, query, execute, withTransaction };
