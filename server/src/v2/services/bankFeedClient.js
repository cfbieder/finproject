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

// Which consuming app fin is — sent as ?app on /v1/{accounts,transactions,balances}
// so the shared bank-feed serves fin only its routed accounts (OCME's go to the
// OCME app). Additive on the bank-feed side: omitting it returns all accounts.
const APP = process.env.BANK_FEED_APP || 'fin';

const DEFAULT_TIMEOUT_MS = 8000;

/**
 * CR091 — the mint's ceiling must clear bank-feed's own retry chain.
 *
 * bank-feed retries an upstream 429 up to `BANK_FEED_MINT_MAX_ATTEMPTS` times,
 * sleeping for the `Retry-After` fintable sends. Measured 2026-09-04: fintable
 * asked for **58 s** on the first wait, so the chain ran ~58 s while this client
 * aborted at the inherited 8000 ms and reported a TIMEOUT — for a call that
 * returns in 54 ms when it is not rate-limited.
 *
 * ⚠️ A client ceiling below the server's retry budget does not make success
 * unlikely, it makes it IMPOSSIBLE — the request can only ever be abandoned.
 * That is CR059's floor lesson in a second place, so the number below is
 * DERIVED from the chain and guarded by a test, never tuned by feel. Raise
 * bank-feed's attempts or fintable's Retry-After and the test fails here first.
 */
const BANK_FEED_MINT_MAX_ATTEMPTS = 4;
const BANK_FEED_MINT_MAX_RETRY_AFTER_MS = 60_000;  // fintable's observed ceiling
const MINT_TIMEOUT_MS =
  (BANK_FEED_MINT_MAX_ATTEMPTS - 1) * BANK_FEED_MINT_MAX_RETRY_AFTER_MS + 15_000;

function ensureConfigured() {
  if (!API_KEY) {
    throw new Error('BANK_FEED_API_KEY env var is not set on fin-server');
  }
}

async function request(path, { method = 'GET', query, body: jsonBody, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
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
  const headers = { 'Accept': 'application/json', 'X-API-Key': API_KEY };
  if (jsonBody !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: jsonBody !== undefined ? JSON.stringify(jsonBody) : undefined,
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
function accounts()    { return request('/v1/accounts', { query: { app: APP } }); }
function balances(asOf) { return request('/v1/balances', { query: { as_of: asOf, app: APP } }); }

// CR061. Investment positions per account, from the latest snapshot at or
// before `asOf`. ⚠️ Each entry carries a `status` that must be read BEFORE its
// `positions`: an empty list means the account holds nothing ('empty'), the
// upstream has no snapshot for that date ('absent'), or the fetch broke
// ('partial') — and only 'fetched' licenses "this is what is held".
function holdings(asOf) { return request('/v1/holdings', { query: { as_of: asOf, app: APP } }); }

/**
 * CR060 — ask bank-feed to mint a single-use browser URL for connecting or
 * re-authorising a bank. bank-feed holds the upstream token; fin never does.
 *
 * This is the FIRST write-shaped call fin makes to bank-feed, and it is not
 * really a write: minting connects nothing, a human opens the URL. Upstream
 * treats it as a `read`-scope operation for that reason.
 *
 * @param {object}  o
 * @param {string} [o.connectionId] re-authorise this connection; omit for a new bank.
 * @param {string} [o.institution]  institution slug (new connections only).
 * @returns {Promise<{link:{url:string,expires_at:string}}>}
 */
function mintConnectionLink({ connectionId = null, institution = null } = {}) {
  const path = connectionId
    ? `/v1/connections/${encodeURIComponent(connectionId)}/link`
    : '/v1/connections/link';
  return request(path, {
    method: 'POST',
    body: institution ? { institution } : {},
    timeoutMs: MINT_TIMEOUT_MS,
  });
}

function transactions({ since, until, accountId, limit = 500, offset = 0 } = {}) {
  return request('/v1/transactions', {
    query: { since, until, account_id: accountId, app: APP, limit, offset },
  });
}

/**
 * POST /v1/sync — ask the bank-feed to pull fresh data from upstream (the Sheet)
 * before we read balances/transactions, so we don't reconcile/stage on
 * morning-stale data. The service coalesces concurrent calls and honours
 * `max_age` (skip if it synced within the window) / `force` (bypass). Global
 * (no app filter — one Sheet pull serves every consumer). Longer timeout since
 * a real pull is slower than a read. Returns the service's sync summary
 * (`{skipped:true,reason:'fresh',...}` when within the freshness window).
 */
function sync({ maxAgeMin, force = false } = {}) {
  return request('/v1/sync', {
    method: 'POST',
    query: { max_age: maxAgeMin, force: force ? 'true' : undefined },
    timeoutMs: 30000,
  });
}

// ---- CR036 manual statement upload ----------------------------------------
// Stateless parse (format layer lives in the service). Returns fin-convention
// rows + a balance magnitude; fin applies account-level sign flags after.
function manualParse({ accountExternalId, csv, profileId, profile } = {}) {
  return request('/v1/manual/parse', {
    method: 'POST',
    body: { account_external_id: accountExternalId, csv, profile_id: profileId, profile },
    timeoutMs: 20000,
  });
}

// CR036 P2 — mapper support: header/sample inspection + saving a mapping.
function manualInspect({ csv } = {}) {
  return request('/v1/manual/inspect', { method: 'POST', body: { csv }, timeoutMs: 20000 });
}

function manualSaveProfile({ label, kind, currency, spec } = {}) {
  return request('/v1/manual/profiles', {
    method: 'POST',
    body: { label, kind, currency, spec },
    timeoutMs: 20000,
  });
}

// Trusted bulk-write of already sign-aligned rows + a signed balance.
function manualCommit({ accountExternalId, rows, balance, source = 'manual' } = {}) {
  return request('/v1/manual/commit', {
    method: 'POST',
    body: { account_external_id: accountExternalId, rows, balance, source },
    timeoutMs: 20000,
  });
}

function manualProfiles() { return request('/v1/manual/profiles'); }

module.exports = {
  health,
  feedsHealth,
  connections,
  mintConnectionLink,
  accounts,
  balances,
  holdings,
  transactions,
  sync,
  manualParse,
  manualCommit,
  manualProfiles,
  manualInspect,
  manualSaveProfile,
  // exposed for diagnostic / config readback
  baseUrl: BASE_URL,
  // CR091 — exported so the timeout/backoff relationship is testable, not folklore.
  MINT_TIMEOUT_MS,
  BANK_FEED_MINT_MAX_ATTEMPTS,
  BANK_FEED_MINT_MAX_RETRY_AFTER_MS,
};
