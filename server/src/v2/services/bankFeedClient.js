/**
 * bankFeedClient — thin HTTP client for the bank-feed microservice (CR021).
 *
 * Provides read-only access to bank-feed's /v1/* contract. This is the
 * client side of what will eventually replace PocketSmith in fin v3
 * (planned as CR022). For Phase 7 spike, it's read-only diagnostic use.
 *
 * Configuration (env vars on the fin-server process):
 *   BANK_FEED_URL          base URL (default: http://host.docker.internal:3007)
 *   BANK_FEED_API_KEY      shared API key, sent as X-API-Key header
 *
 * Network note: when fin-server runs in Docker and bank-feed runs in its
 * own compose on the same host, `host.docker.internal` resolves to the
 * host. docker-compose.dev.yml must include
 *   extra_hosts: ["host.docker.internal:host-gateway"]
 * for that to work on Linux.
 *
 * Contract this targets: bank-feed/contracts/v1/README.md.
 */

const BASE_URL = process.env.BANK_FEED_URL || 'http://host.docker.internal:3007';
const API_KEY = process.env.BANK_FEED_API_KEY || '';

const DEFAULT_TIMEOUT_MS = 8000;

function ensureConfigured() {
  if (!API_KEY) {
    throw new Error('BANK_FEED_API_KEY env var is not set on fin-server');
  }
}

async function request(path, { method = 'GET', query, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  ensureConfigured();
  const url = new URL(path, BASE_URL);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') {
        url.searchParams.set(k, String(v));
      }
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        'Accept': 'application/json',
        'X-API-Key': API_KEY,
      },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      throw new Error(`bank-feed request timed out after ${timeoutMs}ms (${url})`);
    }
    throw new Error(`bank-feed request failed (${url}): ${err.message}`);
  }
  clearTimeout(timer);

  const text = await res.text();
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
  }
  if (!res.ok) {
    const message = body && body.error ? body.error : `HTTP ${res.status}`;
    const e = new Error(`bank-feed ${method} ${path} → ${res.status}: ${message}`);
    e.status = res.status;
    e.body = body;
    throw e;
  }
  return body;
}

// ---------- Public API ------------------------------------------------------

function health()      { return request('/v1/health'); }
function feedsHealth() { return request('/v1/health/feeds'); }
function connections() { return request('/v1/connections'); }
function accounts()    { return request('/v1/accounts'); }
function balances(asOf) { return request('/v1/balances', { query: { as_of: asOf } }); }

function transactions({ since, until, accountId, limit = 500, offset = 0 } = {}) {
  return request('/v1/transactions', {
    query: { since, until, account_id: accountId, limit, offset },
  });
}

module.exports = {
  health,
  feedsHealth,
  connections,
  accounts,
  balances,
  transactions,
  // exposed for diagnostic / config readback
  baseUrl: BASE_URL,
};
