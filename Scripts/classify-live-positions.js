#!/usr/bin/env node
/**
 * classify-live-positions.js — CR061 P1.
 *
 * Runs the classifier over the REAL positions bank-feed holds and prints the
 * distribution, so the rules can be checked against the portfolio they were
 * written for.
 *
 * ⚠️ Why this is a script and not a test fixture. The repo does not commit real
 * financial data — `Samples/Fidelity/`, `Samples/Fintable/` and the Quicken
 * exports are all gitignored, and only sanitized fixtures are committed. A
 * frozen file of the 95 live positions would be the portfolio itself: the
 * symbols ARE the holdings. So the committed tests use sanitized fixtures that
 * reproduce every shape, and this script is how the same rules get checked
 * against reality. Its OUTPUT is data; do not paste it into a doc or a test.
 *
 * READ-ONLY. Fetches from bank-feed and prints. Writes nothing, anywhere.
 *
 * Usage:  node Scripts/classify-live-positions.js [--verbose]
 * Env:    BANK_FEED_URL (default http://localhost:3007), BANK_FEED_API_KEY
 */

const path = require('node:path');
const fs = require('node:fs');

// Read .env directly rather than depending on dotenv: this script lives at the
// repo root, where there are no node_modules, and it must run without an install.
for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const { classify } = require('../server/src/v2/services/investmentClassification');

// ⚠️ BANK_FEED_URL in .env is written for the SERVER CONTAINER
// (`host.docker.internal:3007`), which does not resolve from a host-side
// script. Rewrite it rather than requiring a second variable that would then
// have to be kept in sync with the first.
const BASE = (process.env.BANK_FEED_URL || 'http://localhost:3007')
  .replace('host.docker.internal', 'localhost');
const KEY = process.env.BANK_FEED_API_KEY;
const VERBOSE = process.argv.includes('--verbose');

async function main() {
  if (!KEY) throw new Error('BANK_FEED_API_KEY is not set');
  const res = await fetch(`${BASE}/v1/holdings?app=fin`, { headers: { 'X-API-Key': KEY } });
  if (!res.ok) throw new Error(`bank-feed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const { holdings } = await res.json();

  const rows = [];
  for (const acct of holdings) {
    for (const p of acct.positions) {
      rows.push({ account_id: acct.account_id, ...p, ...classify(p) });
    }
  }

  const by = new Map();
  for (const r of rows) {
    const k = r.asset_class;
    if (!by.has(k)) by.set(k, { n: 0, value: 0, symbols: [] });
    const g = by.get(k);
    g.n += 1;
    g.value += Number(r.value) || 0;
    g.symbols.push(r.symbol);
  }

  const total = rows.reduce((s, r) => s + (Number(r.value) || 0), 0);
  console.log(`\n${rows.length} positions across ${holdings.length} accounts, $${total.toFixed(0)} total\n`);
  console.log('class        positions        value    share   price_basis');
  for (const [k, g] of [...by.entries()].sort((a, b) => b[1].value - a[1].value)) {
    const basis = [...new Set(rows.filter((r) => r.asset_class === k).map((r) => r.price_basis))].join(',');
    console.log(`  ${k.padEnd(12)}${String(g.n).padStart(4)}  $${g.value.toFixed(0).padStart(11)}  ${(100 * g.value / total).toFixed(1).padStart(5)}%   ${basis}`);
  }

  // The rules exist to prevent one failure: a non-per-share instrument reaching
  // an equity quote lookup. That is what this asserts.
  const quotable = rows.filter((r) => r.price_basis === 'per_share');
  const misbased = quotable.filter((r) => /^[0-9]{3}[0-9A-Z]{6}$/.test(r.symbol) || Number(r.price) === 1);
  console.log(`\nsafe to probe for a quote: ${quotable.length} positions, `
    + `$${quotable.reduce((s, r) => s + (+r.value || 0), 0).toFixed(0)} `
    + `(${(100 * quotable.reduce((s, r) => s + (+r.value || 0), 0) / total).toFixed(1)}% of value)`);
  console.log(misbased.length === 0
    ? '✓ no CUSIP-shaped or par-priced instrument is marked per_share'
    : `🔴 ${misbased.length} MIS-BASED: ${misbased.map((r) => r.symbol).join(', ')}`);

  const unknown = rows.filter((r) => r.asset_class === 'unknown');
  console.log(`\nunknown (never quoted, always warned): ${unknown.length}`);
  if (unknown.length) {
    console.log('  → each needs one manual classification; they are a finding, not a failure:');
    for (const u of unknown) console.log(`    ${u.symbol.padEnd(12)} ${u.reason}`);
  }

  if (VERBOSE) {
    console.log('\nper position:');
    for (const r of rows.sort((a, b) => (+b.value) - (+a.value))) {
      console.log(`  ${r.symbol.padEnd(12)} ${r.asset_class.padEnd(11)} ${String(r.price_basis).padEnd(11)} ${r.reason}`);
    }
  }
  process.exit(misbased.length === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e.message); process.exit(2); });
