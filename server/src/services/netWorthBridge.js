/**
 * Net-Worth Bridge service — CR092.
 *
 * Answers "why did net worth change" for the window the Home hero draws, by
 * decomposing the change into drivers a person recognises: things re-valued,
 * money earned, money spent, money moved, and the exchange rate.
 *
 * ── Why this can be exact rather than estimated ──────────────────────────────
 *
 * Net worth on this app is, per account, `opening_balance + Σ transactions`,
 * converted at the as-of-date rate (`reports.js` → `fetchAccountBalances`).
 * CR024's feed-balance override is the one thing that would break additivity,
 * and it has ZERO rows on prod. So every dollar of change is either a
 * transaction or a rate move — there is nothing left over to estimate, and
 * `meta.tie` is asserted to be ~0 rather than hoped for.
 *
 * ── The FX convention, and why it is the one that chains ─────────────────────
 *
 * Every transaction is translated at the rate on `toDate` — the SAME rate that
 * values the ending net worth. Owner decision (2026-09-05), measured against
 * three alternatives:
 *
 *   - stored `base_amount`: matches the Cash Flow page to the dollar, but
 *     inherits a real defect. 271 of 2,169 non-USD rows in the measured window
 *     carry a rate off by >1% from the book rate for their own date; the
 *     United Beverages write-down alone was stored at 0.266042 when the book
 *     rate that day was 0.278373 — $85,780, landing in the revaluation line
 *     with the offsetting error hidden in the currency line.
 *   - book rate on each transaction's own date: defensible and chains, but its
 *     currency line reported +$5,830 for a year in which the zloty fell — the
 *     translation loss nets against "the write-down happened at a stronger
 *     rate", and the reader learns nothing.
 *   - each sub-period's own ending rate: the month-by-month figures then do NOT sum
 *     to the headline (measured: currency −1,608 chained vs −81,899 for the
 *     period), which is this repo's most expensive failure shape.
 *
 * Fixing the translation rate at `toDate` for EVERY sub-period is what makes
 * the months sum to the year exactly — verified on all 11 steps of the live
 * 12-month window, every column to the dollar. The stated cost: income here is
 * "in today's dollars" and so differs from the Cash Flow page (which uses
 * `base_amount`) by ~1.5%. `meta.basis` says so; the modal prints it.
 *
 * ── Two drivers this CANNOT see, by construction ─────────────────────────────
 *
 * Both are disclosed in `meta.caveats` rather than quietly absent:
 *
 *   1. `calibrate()` rewrites `accounts.opening_balance` retroactively. Both
 *      endpoints read today's value, so a re-anchor never appears as a driver —
 *      it silently reshapes the whole history curve instead. Migration 074 gave
 *      it an audit trail, but only from 2026-08-24.
 *   2. The balance query filters `is_active = TRUE` at BOTH dates, so
 *      deactivating an account rewrites its history rather than showing as a
 *      fall.
 *
 * Sits in services/ beside reports.js and investmentReturns.js, for the same
 * reason: it is a report builder consumed by the v2 reports route.
 */

const db = require('../v2/db');
const accountsRepo = require('../v2/repositories').accounts;
const reportsService = require('./reports');

// The mark category, matched on EITHER id or name — same convention as
// investmentReturns.js. `reconcileToFeed` pins id 88; matching only on name
// stops seeing marks after a rename, matching only on id after a re-seed.
const UNREALIZED_CATEGORY = 'Unrealized G/L';
const UNREALIZED_CATEGORY_ID = 88;

// The hero sums exactly these two top-level nodes (frontend useReports.js).
// Anything else under the balance-sheet root is reported in `meta.excluded`
// rather than dropped in silence.
const HERO_SECTIONS = ['assets', 'liabilities'];

const MAX_PERIODS = 60;
const MAX_MOVERS = 12;
// A named item is listed under its driver when it is worth at least this share
// of it, up to MAX_CONTRIBUTORS. 15% keeps "one thing did this" legible and
// stays silent where a driver is genuinely diffuse — measured on prod, spending
// has no item above 13.5%, and that silence is itself the answer.
const CONTRIBUTOR_FLOOR = 0.15;
const MAX_CONTRIBUTORS = 4;
// Below this ratio of net-to-gross a driver is CANCELLING, and naming its
// biggest legs under its net figure misleads rather than explains. Transfers
// net to −23,621 out of ~2.0M gross (0.012); a re-valuation of −1,741,398 out
// of ~2.1M gross (0.83) genuinely IS its largest item.
const NET_OF_GROSS_FLOOR = 0.4;
// A tie worse than this is a bug in this file, not a rounding artefact: the
// decomposition is exact, and the live 12-month window ties to 1.2e-10.
const TIE_TOLERANCE = 0.01;

const DRIVERS = [
  { key: 'revaluation', label: 'Investments & property re-valued' },
  { key: 'income', label: 'Money earned' },
  { key: 'spending', label: 'Money spent' },
  { key: 'currency', label: 'Exchange-rate moves' },
  { key: 'transfers', label: "Transfers that didn't net out" },
  { key: 'other', label: 'Other balance-sheet postings' },
  { key: 'uncategorised', label: 'Uncategorised' },
];
const DRIVER_KEYS = DRIVERS.map((d) => d.key);

// ---------------------------------------------------------------------------
// Dates — UTC-only arithmetic (CR037: a local-time Date shifts by ±1 day)
// ---------------------------------------------------------------------------

const toUtc = (s) => new Date(`${s}T00:00:00Z`);
const iso = (d) => d.toISOString().slice(0, 10);

function isValidDateString(str) {
  if (typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  return !Number.isNaN(toUtc(str).getTime());
}

const monthLabel = (isoDate) => {
  const d = toUtc(isoDate);
  return `${d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })} ${d.getUTCFullYear()}`;
};

/**
 * Period ends strictly inside (fromDate, toDate], on the requested cadence,
 * always closing on toDate itself.
 *
 * The last period is usually SHORT — the hero's window ends today, not on a
 * month-end — and that is deliberate: the bridge must close on the same date
 * the hero's ending value is read at, or the headline would not be the number
 * the button sits next to.
 */
function periodEnds(fromDate, toDate, granularity) {
  if (granularity === 'none') return [toDate];
  const step = granularity === 'quarter' ? 3 : granularity === 'year' ? 12 : 1;
  const from = toUtc(fromDate);
  const out = [];
  let y = from.getUTCFullYear();
  let m = Math.floor(from.getUTCMonth() / step) * step;
  for (let guard = 0; guard <= MAX_PERIODS + 1; guard += 1) {
    const end = iso(new Date(Date.UTC(y, m + step, 0))); // day 0 = last of prev month
    if (end >= toDate) break;
    if (end > fromDate) out.push(end);
    m += step;
    if (m > 11) { m -= 12; y += 1; }
  }
  out.push(toDate);
  return out;
}

/** Does `date` land on the last day of its own month? (i.e. a full period.) */
function isPeriodEnd(date, granularity) {
  if (granularity === 'none') return true;
  const d = toUtc(date);
  return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))) === date;
}

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

/**
 * The leaf accounts the hero's net worth is actually built from.
 *
 * Mirrors `buildBalanceSheetNode` exactly, including its one surprising rule:
 * a node WITH children contributes only the sum of its children, so a parent
 * account holding its own transactions has them dropped. Reproducing that here
 * is not an endorsement of it — it is what makes the bridge tie to the number
 * on screen instead of to a better one nobody is looking at.
 */
async function fetchHeroLeaves() {
  const tree = await accountsRepo.getNestedTree({ section: 'balance_sheet' });
  const root = (tree || []).find((n) => n.name === 'Balance Sheet Accounts');
  const sections = root && root.children.length ? root.children : tree || [];

  const leaves = [];
  const excluded = [];
  const walk = (node, section, path) => {
    const here = [...path, node.name];
    if (!node.children || node.children.length === 0) {
      leaves.push({ id: node.id, name: node.name, section, path: here.join(' / ') });
      return;
    }
    for (const child of node.children) walk(child, section, here);
  };

  for (const section of sections) {
    if (!HERO_SECTIONS.includes((section.name || '').toLowerCase())) {
      excluded.push(section.name);
      continue;
    }
    walk(section, section.name, []);
  }
  return { leaves, excluded };
}

// ---------------------------------------------------------------------------
// Balances
// ---------------------------------------------------------------------------

/**
 * Per-leaf USD balance and local balance at each boundary, read through
 * `fetchAccountBalances` — the SAME function the Home hero's balance report
 * calls. Reused rather than re-derived: a second query computing "the same"
 * balance is exactly how a bridge starts disagreeing with the chart it explains.
 */
async function fetchBoundaryBalances(leaves, boundaries) {
  const snapshots = await Promise.all(
    boundaries.map((d) => reportsService.fetchAccountBalances(d))
  );
  const byBoundary = new Map();
  boundaries.forEach((date, i) => {
    const snap = snapshots[i];
    const usd = new Map();
    const local = new Map();
    for (const leaf of leaves) {
      const entry = snap[leaf.name];
      // [currency, balance, exchangeRate, balanceInUSD]
      usd.set(leaf.id, Array.isArray(entry) ? Number(entry[3]) || 0 : 0);
      local.set(leaf.id, Array.isArray(entry) ? Number(entry[1]) || 0 : 0);
    }
    byBoundary.set(date, { usd, local });
  });
  return { byBoundary, endingSnapshot: snapshots[snapshots.length - 1] };
}

/**
 * currency → USD-per-unit, DERIVED from the ending snapshot rather than
 * re-queried.
 *
 * `fetchAccountBalances` stores `exchangeRate` as units-per-USD and divides by
 * it, so USD-per-unit is its reciprocal. Deriving it here means the bridge and
 * the balance sheet cannot pick different rates for the same day — including
 * when the report's own API fallback supplied one that is not in the table.
 */
function ratesFromSnapshot(snapshot) {
  const rates = { USD: 1 };
  for (const entry of Object.values(snapshot)) {
    if (!Array.isArray(entry)) continue;
    const [currency, , exchangeRate] = entry;
    const ccy = typeof currency === 'string' ? currency.trim() : 'USD';
    const r = Number(exchangeRate);
    if (!rates[ccy] && Number.isFinite(r) && r > 0) rates[ccy] = 1 / r;
  }
  return rates;
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

/**
 * Every transaction in the window, in LOCAL currency, grouped by
 * (account, period, driver).
 *
 * Buckets are exhaustive by construction — the CASE has no fall-through — which
 * is what lets `currency` be a residual that means something instead of a bin
 * for everything unexamined.
 *
 * Carries the balance sheet's own `opening_balance_date` clause: without it a
 * transaction predating that date counts as a driver but not in the balance,
 * and the tie silently breaks.
 */
async function fetchDriverSums(accountIds, fromDate, boundaries) {
  const sql = `
    SELECT t.account_id,
           pd.i AS period_index,
           CASE
             WHEN t.category_id IS NULL THEN 'uncategorised'
             WHEN c.name = $4 OR c.id = $5 THEN 'revaluation'
             WHEN c.is_transfer THEN 'transfers'
             WHEN c.section <> 'profit_loss' THEN 'other'
             WHEN c.account_type = 'income' THEN 'income'
             ELSE 'spending'
           END AS driver,
           c.name AS category_name,
           SUM(t.amount) AS local_amount
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id
      LEFT JOIN accounts c ON c.id = t.category_id
      JOIN LATERAL (
        SELECT b.i
          FROM UNNEST($3::date[]) WITH ORDINALITY AS b(d, i)
         WHERE t.transaction_date <= b.d
         ORDER BY b.d
         LIMIT 1
      ) pd ON TRUE
     WHERE t.account_id = ANY($1)
       AND t.transaction_date >= a.opening_balance_date
       AND t.transaction_date > $2
     GROUP BY 1, 2, 3, 4
  `;
  const { rows } = await db.query(sql, [
    accountIds, fromDate, boundaries, UNREALIZED_CATEGORY, UNREALIZED_CATEGORY_ID,
  ]);
  return rows;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

const round = (n) => Math.round((Number(n) || 0) * 100) / 100;
const emptyDrivers = () => Object.fromEntries(DRIVER_KEYS.map((k) => [k, 0]));

// Drivers whose named item is the CATEGORY rather than the account it moved
// through. See the note at `contributions`.
const CATEGORY_LABELLED = new Set(['income', 'spending']);

const labelFor = (driver, categoryName, accountName) =>
  (CATEGORY_LABELLED.has(driver) ? categoryName : accountName) || accountName;

/**
 * The named items worth printing under a driver.
 *
 * A driver line on its own says a re-valuation cost 1.74M; it does not say the
 * re-valuation WAS United Beverages. Only items that carry their own weight are
 * listed — a list of every account is the table further down the modal, not an
 * answer.
 *
 * ⚠️ **Weight is judged against the GROSS, never the net**, and the difference
 * is not academic. `Transfers that didn't net out` nets to −23,621 out of ~2.0M
 * of movement, so a net-relative floor cleared everything and printed four
 * items of ±$500K under a −$23,621 line — figures that are individually true
 * and collectively a lie about what that line means. Same shape on
 * `Uncategorised`: −$39 net, ±$27K of legs.
 *
 * A driver whose net is small against its gross is a CANCELLING driver, and its
 * biggest legs are not "what it was made of". Those report `offsetting` with
 * the gross instead — which is the actual answer to "did I lose that money?",
 * and the thing the owner asked this modal to say.
 *
 * ⚠️ A listed contributor may still exceed its driver's total (UB is −1,873,619
 * against a −1,741,398 driver, because other marks were positive). That is real,
 * and is why no percentage is emitted: "108%" reads as an error rather than as
 * "the rest offset it".
 */
function topContributors(byLabel, driverTotal) {
  if (!byLabel || !byLabel.size) return { contributors: [] };

  const entries = [...byLabel.entries()];
  const gross = entries.reduce((a, [, v]) => a + Math.abs(v), 0);
  if (!gross) return { contributors: [] };

  if (Math.abs(driverTotal) < gross * NET_OF_GROSS_FLOOR) {
    return { contributors: [], offsetting: true, gross: round(gross / 2) };
  }

  const floor = gross * CONTRIBUTOR_FLOOR;
  return {
    contributors: entries
      .filter(([, amount]) => Math.abs(amount) >= floor)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .slice(0, MAX_CONTRIBUTORS)
      .map(([label, amount]) => ({ label, amount: round(amount) })),
  };
}

async function buildNetWorthBridge({
  fromDate, toDate, granularity = 'month', moverLimit = MAX_MOVERS,
}) {
  if (!(fromDate < toDate)) {
    const err = new Error("'fromDate' must be earlier than 'toDate'");
    err.status = 400;
    throw err;
  }

  const ends = periodEnds(fromDate, toDate, granularity);
  if (ends.length > MAX_PERIODS) {
    const err = new Error(
      `This span is ${ends.length} ${granularity} periods; it needs a coarser granularity (max ${MAX_PERIODS}).`
    );
    err.status = 400;
    throw err;
  }

  const { leaves, excluded } = await fetchHeroLeaves();
  if (!leaves.length) {
    const err = new Error('No balance-sheet accounts to explain');
    err.status = 400;
    throw err;
  }
  const leafById = new Map(leaves.map((l) => [l.id, l]));
  const accountIds = leaves.map((l) => l.id);

  const boundaries = [fromDate, ...ends];
  const [{ byBoundary, endingSnapshot }, driverRows] = await Promise.all([
    fetchBoundaryBalances(leaves, boundaries),
    fetchDriverSums(accountIds, fromDate, ends),
  ]);

  const rates = ratesFromSnapshot(endingSnapshot);
  const currencyOf = (leafName) => {
    const entry = endingSnapshot[leafName];
    const c = Array.isArray(entry) && typeof entry[0] === 'string' ? entry[0].trim() : 'USD';
    return c || 'USD';
  };

  // Transaction drivers, translated at the ENDING rate — the same rate the
  // ending net worth is read at, which is what makes the periods sum.
  const cell = new Map(); // `${accountId}|${periodIndex}` → drivers
  const cellFor = (accountId, periodIndex) => {
    const key = `${accountId}|${periodIndex}`;
    if (!cell.has(key)) cell.set(key, emptyDrivers());
    return cell.get(key);
  };
  // Named contributors per driver — "which ONE thing was this?".
  //
  // The label differs by driver on purpose, because the answer does. For a
  // re-valuation or a rate move the ACCOUNT is the item: `United Beverages`.
  // For money spent it is the CATEGORY — measured on prod, the top spending
  // ACCOUNT is `PKO` and `Chase Checking`, i.e. which card paid, while the top
  // spending item is `Kasia Spending`; naming the account there answers a
  // question nobody asked.
  const contributions = new Map(); // driver → Map(label → usd)
  const contribute = (driver, label, amount) => {
    if (!label) return;
    const byLabel = contributions.get(driver) || new Map();
    byLabel.set(label, (byLabel.get(label) || 0) + amount);
    contributions.set(driver, byLabel);
  };

  for (const row of driverRows) {
    const leaf = leafById.get(row.account_id);
    if (!leaf) continue; // a P&L or parent account — not part of the hero's sum
    const rate = rates[currencyOf(leaf.name)] ?? 1;
    const usd = (Number(row.local_amount) || 0) * rate;
    cellFor(row.account_id, Number(row.period_index))[row.driver] += usd;
    contribute(row.driver, labelFor(row.driver, row.category_name, leaf.name), usd);
  }

  // `currency` is the residual per (account, period): the part of the USD move
  // that no transaction accounts for. With every transaction already valued at
  // the ending rate, what is left is the revaluation of the OPENING balance by
  // the rate move — i.e. translation. It is computed, not assumed: `meta.tie`
  // is what proves the residual has nothing else in it.
  const periods = [];
  const totals = emptyDrivers();
  const moverTotals = new Map();

  ends.forEach((end, idx) => {
    const start = boundaries[idx];
    const periodIndex = idx + 1; // WITH ORDINALITY is 1-based
    const prev = byBoundary.get(start).usd;
    const now = byBoundary.get(end).usd;
    const drivers = emptyDrivers();
    let change = 0;

    for (const leaf of leaves) {
      const delta = (now.get(leaf.id) || 0) - (prev.get(leaf.id) || 0);
      const tx = cell.get(`${leaf.id}|${periodIndex}`) || emptyDrivers();
      const explained = DRIVER_KEYS.reduce((a, k) => (k === 'currency' ? a : a + tx[k]), 0);
      const perLeaf = { ...tx, currency: delta - explained };

      change += delta;
      for (const k of DRIVER_KEYS) drivers[k] += perLeaf[k];

      // `currency` has no transactions to group — it is the residual — so its
      // contributors are accumulated here, from the per-account residual itself.
      contribute('currency', leaf.name, perLeaf.currency);

      const mover = moverTotals.get(leaf.id) || { change: 0, drivers: emptyDrivers() };
      mover.change += delta;
      for (const k of DRIVER_KEYS) mover.drivers[k] += perLeaf[k];
      moverTotals.set(leaf.id, mover);
    }

    for (const k of DRIVER_KEYS) totals[k] += drivers[k];
    periods.push({
      key: end,
      label: granularity === 'none' ? `${monthLabel(start)} – ${monthLabel(end)}` : monthLabel(end),
      start,
      end,
      // A short closing period is not comparable to the full ones beside it,
      // so it says so rather than being read as a weak month.
      partial: !isPeriodEnd(end, granularity),
      openingNetWorth: round(sumMap(prev)),
      closingNetWorth: round(sumMap(now)),
      change: round(change),
      drivers: mapValues(drivers, round),
    });
  });

  const openingNetWorth = sumMap(byBoundary.get(fromDate).usd);
  const closingNetWorth = sumMap(byBoundary.get(toDate).usd);
  const change = closingNetWorth - openingNetWorth;
  const tie = change - DRIVER_KEYS.reduce((a, k) => a + totals[k], 0);

  const movers = [...moverTotals.entries()]
    .map(([id, m]) => ({
      account: leafById.get(id).name,
      path: leafById.get(id).path,
      section: leafById.get(id).section,
      currency: currencyOf(leafById.get(id).name),
      openingUSD: round(byBoundary.get(fromDate).usd.get(id) || 0),
      closingUSD: round(byBoundary.get(toDate).usd.get(id) || 0),
      change: round(m.change),
      drivers: mapValues(m.drivers, round),
    }))
    .filter((m) => Math.abs(m.change) >= 1)
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    // Capped for the modal, uncappable enough for a test: a fixture account on
    // a database full of real ones never ranks in a fixed top 12, so asserting
    // the per-account split would silently assert nothing.
    .slice(0, Math.min(Math.max(1, Number(moverLimit) || MAX_MOVERS), 500));

  const data = {
    from: { date: fromDate, netWorth: round(openingNetWorth) },
    to: { date: toDate, netWorth: round(closingNetWorth) },
    change: round(change),
    drivers: DRIVERS
      .map((d) => ({
        ...d,
        amount: round(totals[d.key]),
        // What the driver WAS, named. `namedBy` says which kind of name it is,
        // so the page can label the list rather than leaving the reader to
        // infer whether "Kasia Spending" is an account.
        namedBy: CATEGORY_LABELLED.has(d.key) ? 'category' : 'account',
        ...topContributors(contributions.get(d.key), totals[d.key]),
      }))
      .filter((d) => Math.abs(d.amount) >= 1)
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)),
    periods,
    movers,
  };
  data.summary = buildSummary(data);

  return {
    data,
    meta: {
      basis: 'ending-rate',
      basisNote:
        `Every figure is in today's dollars — each amount is converted at the exchange rate on ` +
        `${toDate}, the same rate the closing net worth uses. That is what makes the periods ` +
        `add up to the total. Income and spending here will differ slightly from the Cash Flow ` +
        `page, which converts each transaction at its own date's rate.`,
      granularity,
      rates: mapValues(rates, (r) => Math.round(r * 1e6) / 1e6),
      accountsExplained: leaves.length,
      excludedSections: excluded,
      // Not a formality: the decomposition is exact, so a non-zero tie means
      // this file is wrong. It is reported rather than swallowed.
      tie: round(tie),
      tieOk: Math.abs(tie) <= TIE_TOLERANCE,
      caveats: buildCaveats(excluded),
    },
  };
}

function sumMap(m) {
  let total = 0;
  for (const v of m.values()) total += v;
  return total;
}

function mapValues(obj, fn) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, fn(v)]));
}

/**
 * The always-true caveats, plus any conditional one. Stated in the payload
 * rather than hardcoded in the modal so the server stays the single source of
 * what this measurement cannot see.
 */
function buildCaveats(excluded) {
  const out = [
    'Re-anchoring an account\'s opening balance rewrites its whole history, so it never shows ' +
      'up here as a cause — it moves the chart instead. Changes have been recorded only since ' +
      '2026-08-24.',
    'Closing an account removes it from every date at once, so it appears as if it was never ' +
      'there rather than as a fall.',
  ];
  if (excluded.length) {
    out.push(
      `Net worth here is Assets plus Liabilities only. Not included: ${excluded.join(', ')}.`
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Plain-English summary (deterministic)
// ---------------------------------------------------------------------------

const usd = (n) => {
  const abs = Math.abs(Math.round(n));
  return `$${abs.toLocaleString('en-US')}`;
};

const longDate = (isoDate) => {
  const d = toUtc(isoDate);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString('en-US', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
};

/**
 * The sentences the modal leads with, generated from the figures — never a
 * separate calculation.
 *
 * Deliberately deterministic. CR092 P1 adds an LLM narration on top of exactly
 * this payload (narration-only, local route), but the explanation must not
 * depend on a gateway being up, and the numbers must never come from a model.
 */
function buildSummary(data) {
  const lines = [];
  const dir = data.change >= 0 ? 'rose' : 'fell';
  const by = (key) => data.drivers.find((d) => d.key === key)?.amount ?? 0;

  // Written out, not ISO: the modal's own header already reads "Oct 31, 2025 to
  // Sep 5, 2026", and a raw 2025-10-31 in the sentence beneath it looked like a
  // different, more technical claim about the same window.
  lines.push(
    `Net worth ${dir} ${usd(data.change)} between ${longDate(data.from.date)} and ` +
      `${longDate(data.to.date)}.`
  );

  // The share language is graded against what was actually measured. An earlier
  // version said "almost all of it United Beverages" for a mover worth 64% of
  // its driver, and "most of it is one thing" where that thing was the ONLY
  // driver — prose asserting more than the arithmetic supports, on a page whose
  // entire claim is that the arithmetic is exact.
  //
  // 🔴 Two rules here, and the SECOND was found by rendering a different window
  // (CR092 P2, year-to-date rather than 12 months):
  //
  //   1. The leading driver must share the CHANGE's sign. `drivers[0]` is the
  //      largest by absolute value, which on a YTD window was `income +368,591`
  //      against a net FALL of 96,705 — so the page read "Net worth fell
  //      $96,705. Almost all of it is one thing: money earned added $368,591."
  //      Earning money does not cause a fall.
  //   2. When the drivers largely CANCEL, no single one is the story at all.
  //      Same net-of-gross test the contributor lists use: that window's change
  //      is 7.7% of its 1,259,734 of gross driver movement, and picking any
  //      "leading" driver from it overstates by an order of magnitude.
  const grossDrivers = data.drivers.reduce((a, d) => a + Math.abs(d.amount), 0);
  const dominated =
    grossDrivers > 0 && Math.abs(data.change) >= grossDrivers * NET_OF_GROSS_FLOOR;
  const top = dominated
    ? data.drivers.find((d) => Math.sign(d.amount) === Math.sign(data.change))
    : null;

  let ledWith = null;
  if (!dominated && data.drivers.length > 1) {
    const gains = data.drivers.filter((d) => d.amount > 0).reduce((a, d) => a + d.amount, 0);
    const losses = data.drivers.filter((d) => d.amount < 0).reduce((a, d) => a + d.amount, 0);
    lines.push(
      `No single thing accounts for that — ${usd(gains)} of gains against ` +
        `${usd(losses)} of losses, and the change is what is left over.`
    );
  } else if (top && Math.abs(top.amount) > Math.abs(data.change) * 0.4) {
    ledWith = top.key;
    const soleDriver = data.drivers.length === 1;
    const verb = top.amount < 0 ? 'took' : 'added';
    const share = Math.abs(top.amount) / Math.abs(data.change || top.amount);

    const mover = data.movers.find(
      (m) => Math.sign(m.drivers[top.key]) === Math.sign(top.amount)
        && Math.abs(m.drivers[top.key]) > Math.abs(top.amount) * 0.5
    );
    const moverShare = mover
      ? Math.abs(mover.drivers[top.key]) / Math.abs(top.amount)
      : 0;
    const attribution = !mover
      ? ''
      : moverShare >= 0.8
        ? `, almost all of it ${mover.account}`
        : `, most of that ${mover.account}`;

    const lead = soleDriver
      ? 'That is all one thing'
      : share >= 0.8
        ? 'Almost all of it is one thing'
        : 'The largest part is one thing';
    lines.push(
      `${lead}: ${top.label.toLowerCase()} ${verb} ${usd(top.amount)}${attribution}.`
    );
  }

  const income = by('income');
  const spending = by('spending');
  if (income || spending) {
    const net = income + spending;
    lines.push(
      `Day to day, ${usd(income)} came in and ${usd(spending)} went out — ` +
        `${net >= 0 ? `${usd(net)} more earned than spent` : `${usd(net)} more spent than earned`}.`
    );
  }

  // Skipped when the lead sentence is already about currency — on a short
  // window the rate move IS the whole change, and the two lines then said the
  // same thing twice with different words.
  const fx = by('currency');
  if (Math.abs(fx) >= 1000 && ledWith !== 'currency') {
    lines.push(
      `Exchange rates moved ${fx < 0 ? 'against' : 'in favour of'} the foreign holdings by ` +
        `${usd(fx)} — nothing was bought or sold to cause it.`
    );
  }

  const transfers = by('transfers');
  const bigMove = data.movers.find((m) => Math.abs(m.drivers.transfers) > Math.abs(data.change) * 0.2);
  if (bigMove) {
    lines.push(
      `${usd(bigMove.drivers.transfers)} moved ${bigMove.drivers.transfers < 0 ? 'out of' : 'into'} ` +
        `${bigMove.account}. Money moved between accounts does not change net worth — only the ` +
        `${usd(transfers)} that did not find its matching side does.`
    );
  }

  return lines;
}

module.exports = {
  buildNetWorthBridge,
  // Pure, and exported for its own tests: its two hardest rules (a leading
  // driver must share the change's sign; cancelling drivers have no leader)
  // depend on driver MIXES that whichever data a DB happens to hold may not
  // contain, so they are tested directly rather than hoped for.
  buildSummary,
  isValidDateString,
  periodEnds,
  DRIVERS,
  DRIVER_KEYS,
};
