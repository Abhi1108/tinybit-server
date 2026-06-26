/**
 * Shared database helpers for DB_DRIVER routing (supabase | mysql).
 */
function getDriver() {
  return (process.env.DB_DRIVER || 'mysql').toLowerCase();
}

function isDuplicateKeyError(err) {
  return err?.code === 'ER_DUP_ENTRY' || err?.errno === 1062;
}

module.exports = {
  getDriver,
  isDuplicateKeyError,
};
