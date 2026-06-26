/**
 * Auth user persistence — routes to MySQL or Supabase based on DB_DRIVER.
 *   DB_DRIVER=mysql     → mysql/schema.sql + src/config/mysql.js
 *   DB_DRIVER=supabase  → default (current production)
 */
const driver = (process.env.DB_DRIVER || 'supabase').toLowerCase();

module.exports = driver === 'mysql'
  ? require('./auth-users.mysql')
  : require('./auth-users.supabase');
