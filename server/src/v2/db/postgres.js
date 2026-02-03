/**
 * PostgreSQL Database Connection Module
 *
 * Provides connection pooling and transaction support using the pg library.
 * Uses DATABASE_URL environment variable for connection configuration.
 */

const { Pool } = require('pg');

// Connection pool - created lazily on first use
let pool = null;

/**
 * Get or create the connection pool
 */
function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is not set');
    }

    pool = new Pool({
      connectionString,
      max: 10, // Maximum connections in pool
      idleTimeoutMillis: 30000, // Close idle connections after 30s
      connectionTimeoutMillis: 5000, // Fail if can't connect in 5s
    });

    // Log pool errors
    pool.on('error', (err) => {
      console.error('Unexpected PostgreSQL pool error:', err);
    });
  }

  return pool;
}

/**
 * Execute a query with optional parameters
 *
 * @param {string} text - SQL query text
 * @param {Array} params - Query parameters (optional)
 * @returns {Promise<Object>} - Query result with rows, rowCount, etc.
 *
 * @example
 * const result = await db.query('SELECT * FROM accounts WHERE id = $1', [1]);
 * console.log(result.rows);
 */
async function query(text, params = []) {
  const start = Date.now();
  const result = await getPool().query(text, params);
  const duration = Date.now() - start;

  // Log slow queries (>100ms) in development
  if (process.env.NODE_ENV !== 'production' && duration > 100) {
    console.log('Slow query:', { text, duration: `${duration}ms`, rows: result.rowCount });
  }

  return result;
}

/**
 * Get a client from the pool for transactions
 *
 * @returns {Promise<Object>} - Client object with query method
 *
 * @example
 * const client = await db.getClient();
 * try {
 *   await client.query('BEGIN');
 *   await client.query('INSERT INTO ...');
 *   await client.query('COMMIT');
 * } catch (e) {
 *   await client.query('ROLLBACK');
 *   throw e;
 * } finally {
 *   client.release();
 * }
 */
async function getClient() {
  return getPool().connect();
}

/**
 * Execute a function within a transaction
 *
 * @param {Function} fn - Async function that receives the client
 * @returns {Promise<*>} - Result of the function
 *
 * @example
 * const result = await db.transaction(async (client) => {
 *   await client.query('INSERT INTO accounts (name) VALUES ($1)', ['Checking']);
 *   await client.query('INSERT INTO transactions ...');
 *   return { success: true };
 * });
 */
async function transaction(fn) {
  const client = await getClient();

  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Check database connection health
 *
 * @returns {Promise<boolean>} - True if connected, throws on error
 */
async function healthCheck() {
  const result = await query('SELECT NOW() as now');
  return result.rows.length > 0;
}

/**
 * Close all pool connections (for graceful shutdown)
 */
async function close() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = {
  query,
  getClient,
  transaction,
  healthCheck,
  close,
  getPool,
};
