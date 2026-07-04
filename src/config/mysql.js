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

module.exports = { getPool, query, execute };
