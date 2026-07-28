/**
 * Investment Returns service — CR056 P1.
 *
 * Realized income and price return per interval for an account (or a parent
 * rolled up over its descendants), absolute and as a percentage of the average
 * capital employed.
 *
 * Ledger-derived: the CR019/CR022 securities tables are empty, so the numerator
 * is the ledger's own `Unrealized G/L` postings plus auto-derived income
 * categories, and market value is the Balance Sheet's additive basis
 * (`opening_balance + SUM(amount)`).
 *
 * The one invariant everything else hangs off:
 *
 *   Ending MV − Beginning MV − Net external flows
 *     = income + price return + FX effect + unattributed
 *
 * It holds because the four buckets are EXHAUSTIVE over every transaction that
 * moves MV — that is why `unattributed` exists rather than being tidied away.
 * Rev 1 of the CR asserted this identity instead of constructing it, left
 * category 206 and NULL-category rows in no bucket at all, and was silently off
 * by $8,781.87 on Fidelity IRA 2025.
 *
 * Sits beside reports.js in services/ (not v2/services/) because it is a report
 * builder consumed by the v2 reports route, exactly like reports.js.
 */

const db = require('../v2/db');
const accountsRepo = require('../v2/repositories').accounts;
const { rateAsOf } = require('../v2/services/fx');

// The mark category, matched on EITHER id or name. reconcileToFeed.js — which
// writes these postings — pins id 88; matching only on name would stop seeing
// marks if the account were renamed, and matching only on id would miss them
// after a re-seed. Reader and writer must not be able to drift apart.
const UNREALIZED_CATEGORY = 'Unrealized G/L';
const UNREALIZED_CATEGORY_ID = 88;
const MAX_COLUMNS = 60;
const COVERAGE_FULL = 0.9;   // >= renders plainly
const COVERAGE_FLOOR = 0.5;  // < suppresses the % entirely
const MARK_TOLERANCE_DAYS = 5;
const DENOMINATOR_FLOOR = 0.01; // |denominator| must exceed 1% of |EMV|

// ---------------------------------------------------------------------------
// Dates — UTC-only arithmetic (CR037: a local-time Date shifts by ±1 day)
// ---------------------------------------------------------------------------

const toUtc = (str) => new Date(`${str}T00:00:00Z`);
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (str, n) => {
  const d = toUtc(str);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};
const dayDiff = (a, b) => Math.round((toUtc(b) - toUtc(a)) / 86400000);

function isValidDateString(str) {
  if (typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  return !Number.isNaN(toUtc(str).getTime());
}

/**
 * Split [fromDate, toDate] into month / quarter / year spans, each clipped to
 * the requested range so a partial first or last span keeps its own length,
 * and is flagged `partial` so it is not read as a full period.
 */
function splitIntervals(fromDate, toDate, interval) {
  const step = interval === 'year' ? 12 : interval === 'quarter' ? 3 : 1;
  const from = toUtc(fromDate);
  const to = toUtc(toDate);
  if (to < from) return [];

  const out = [];
  // Anchor to the calendar boundary containing `from`, so quarters are Q1..Q4
  // and years are calendar years regardless of where the period starts.
  let m = Math.floor(from.getUTCMonth() / step) * step;
  let y = from.getUTCFullYear();

  for (;;) {
    const spanStart = new Date(Date.UTC(y, m, 1));
    const spanEnd = new Date(Date.UTC(y, m + step, 0)); // day 0 = last of prev month
    if (spanStart > to) break;

    const start = spanStart < from ? from : spanStart;
    const end = spanEnd > to ? to : spanEnd;
    // A clipped span covers less calendar than its label implies. Left
    // unlabelled, a half-month return sits beside twelve full ones and is read
    // as comparable — so the column says so.
    const partial = start > spanStart || end < spanEnd;
    out.push({
      key: intervalKey(y, m, interval),
      label: intervalLabel(y, m, interval),
      start: iso(start),
      end: iso(end),
      partial,
    });

    m += step;
    if (m > 11) { m -= 12; y += 1; }
  }
  return out;
}

/**
 * Spans running mark → mark, for holdings valued on their own schedule rather
 * than the calendar.
 *
 * United Beverages is marked once a year on 31 March, so every calendar-year
 * boundary sits ~90 days from a valuation and the whole series suppressed. The
 * period *between valuations* is the only period such a holding has an honest
 * return for. Each span is `(mᵢ, mᵢ₊₁]`: `start = mᵢ + 1` so the builder's
 * `MV(start − 1)` lands exactly on `mᵢ`, and `end = mᵢ₊₁` lands on the next —
 * both boundaries are marks by construction, so nothing is suppressed.
 *
 * A missing mark (UB has none for 2021) becomes one visibly longer span rather
 * than two blank columns.
 */
function splitByMarks(markDates, fromDate, toDate) {
  const marks = [...new Set(markDates)]
    .filter((m) => m >= fromDate && m <= toDate)
    .sort();
  const out = [];
  for (let i = 0; i + 1 < marks.length; i += 1) {
    const start = addDays(marks[i], 1);
    const end = marks[i + 1];
    if (start > end) continue;
    out.push({
      key: `${marks[i]}_${end}`,
      label: `${monthYear(start)} – ${monthYear(end)}`,
      start,
      end,
      partial: false,
      days: dayDiff(start, end) + 1,
    });
  }
  return out;
}

const monthYear = (isoDate) => {
  const d = toUtc(isoDate);
  return `${d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })} ${d.getUTCFullYear()}`;
};

function intervalKey(year, month, interval) {
  if (interval === 'year') return String(year);
  if (interval === 'quarter') return `${year}-Q${Math.floor(month / 3) + 1}`;
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

function intervalLabel(year, month, interval) {
  if (interval === 'year') return String(year);
  if (interval === 'quarter') return `Q${Math.floor(month / 3) + 1} ${year}`;
  const name = new Date(Date.UTC(year, month, 1))
    .toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  return `${name} ${year}`;
}

// ---------------------------------------------------------------------------
// Return maths
// ---------------------------------------------------------------------------

/**
 * Average capital employed over the period: (opening + closing) / 2.
 *
 * Owner's call (2026-07-27), replacing Modified Dietz: a denominator you can
 * reproduce from two numbers on the same screen is worth more here than one
 * that weights each flow by its exact day. The trade-off, stated: the closing
 * balance already contains the period's flows, so a period with a large
 * withdrawal (Fidelity Stock 2024, −566,014) divides by a figure that money has
 * already left. Read a flow-heavy period's % as an approximation.
 *
 * Returns null — rendered `—` — when the denominator is non-positive or too
 * small to divide by. `Fidelity Stocks` carries opening_balance −302,785.91 at
 * 1990-01-01 with no transactions until 2020, so the average crosses zero and
 * an unguarded division yields a five-digit percentage.
 */
function averageCapital(bmv, emv) {
  const denominator = (bmv + emv) / 2;
  if (denominator <= 0) return null;
  if (Math.abs(denominator) < Math.abs(emv) * DENOMINATOR_FLOOR) return null;
  return denominator;
}

/**
 * XIRR — the money-weighted annualized return, solved on the ACTUAL dated cash
 * flows rather than on the per-column aggregates.
 *
 * Complements the average-capital percentages rather than replacing them: those
 * answer "what did the assets do", this answers "what did my money earn", and
 * they diverge exactly when contributions are large or badly timed.
 *
 * Bisection, not Newton — the objective is monotone-ish but Newton diverges on
 * the sign patterns real ledgers produce, and 200 halvings on [-99.99%, +1000%]
 * is both fast and incapable of running away.
 */
function xirr(flows) {
  if (flows.length < 2) return null;
  // Needs money in and money out, or there is nothing to solve for.
  if (!flows.some((f) => f.amount > 0) || !flows.some((f) => f.amount < 0)) return null;

  const t0 = flows[0].date;
  const spanDays = dayDiff(t0, flows[flows.length - 1].date);
  if (spanDays < 30) return null; // annualizing a few weeks is noise amplification

  const npv = (r) =>
    flows.reduce((a, f) => a + f.amount / (1 + r) ** (dayDiff(t0, f.date) / 365), 0);

  let lo = -0.9999;
  let hi = 10;
  let flo = npv(lo);
  if (!Number.isFinite(flo) || !Number.isFinite(npv(hi))) return null;
  if (flo * npv(hi) > 0) return null; // no sign change ⇒ no root in range

  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (!Number.isFinite(fm)) return null;
    if (Math.abs(fm) < 1e-9) return mid;
    if (flo * fm < 0) hi = mid;
    else {
      lo = mid;
      flo = fm;
    }
  }
  return (lo + hi) / 2;
}

/** A component's return on that average capital; null when it isn't divisible. */
function returnOn(component, bmv, emv) {
  const denominator = averageCapital(bmv, emv);
  if (denominator === null) return null;
  return component / denominator;
}

/**
 * Geometric chain of interval returns — linked time-weighted return. A single
 * unsupported interval breaks the chain; the caller then falls back to the
 * longest contiguous supported run rather than to a whole-period Dietz, which
 * degenerates badly (United Beverages over the full history: +2,064%).
 */
function chainReturns(returns) {
  if (!returns.length || returns.some((r) => r === null || r === undefined)) return null;
  return returns.reduce((acc, r) => acc * (1 + r), 1) - 1;
}

/** Longest run of consecutive non-null returns; [startIdx, endIdx] inclusive. */
function longestSupportedRun(returns) {
  let best = null;
  let runStart = null;
  for (let i = 0; i <= returns.length; i += 1) {
    const ok = i < returns.length && returns[i] !== null && returns[i] !== undefined;
    if (ok && runStart === null) runStart = i;
    if (!ok && runStart !== null) {
      const len = i - runStart;
      if (!best || len > best.len) best = { start: runStart, end: i - 1, len };
      runStart = null;
    }
  }
  return best;
}

/** Annualize a cumulative return over `days`; null unless the span exceeds a year. */
function annualize(cumulative, days) {
  if (cumulative === null || cumulative === undefined) return null;
  if (!(days > 366)) return null;
  const growth = 1 + cumulative;
  if (growth <= 0) return null;
  return growth ** (365 / days) - 1;
}

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

/**
 * How far from a boundary a mark may sit and still value it: a sixth of the
 * period, floored at 5 days.
 *
 * A flat tolerance cannot serve both ends of the range. At ±5 days a monthly
 * column is judged correctly, but an ANNUAL column was discarded because its
 * opening mark landed 31 days late — a 365-day return thrown away over a
 * rounding error, which is what the owner (rightly) rejected. Scaling keeps the
 * pathological case out: United Beverages anchors on 31 March, so its nearest
 * marks sit ~90 days from a calendar year's boundaries and stay outside a
 * ±61-day window — the FY-Mar-2024 appreciation still cannot be presented as
 * 2024's.
 */
function markTolerance(start, end) {
  const days = dayDiff(start, end) + 1;
  return Math.max(MARK_TOLERANCE_DAYS, Math.floor(days / 6));
}

/**
 * An account is covered for `[s, e]` when a valuation falls inside the span (its
 * opening boundary counts) — that is, when the period contains an actual
 * `Unrealized G/L` posting.
 *
 * Earlier revisions demanded a mark within tolerance of BOTH boundaries, and
 * that was incoherent with what the table already prints: United Beverages'
 * 2020 column *displays* +1,151,997 of Unrealized G/L while suppressing the
 * percentage that same posting implies. If a figure is good enough to show, it
 * is good enough to divide. Suppression now means only "this period was never
 * valued" — which still catches UB's missing 2021 and every Fidelity year
 * before 2025, the cases where there genuinely is no number.
 *
 * The misdating risk that motivated the stricter rule is handled by disclosure
 * (`boundaryAligned`) plus `interval=marks`, which is correct by construction,
 * rather than by hiding the row.
 */
function isCovered(markDates, start, end) {
  // Strictly within the period — the opening boundary does NOT count. A mark
  // sitting only at `start − 1` values the period's *opening*, so the period
  // itself is unvalued and its price movement would render as a confident
  // 0.00% (UB's 2026-YTD column, whose only mark is 2025-12-31).
  return markDates.some((m) => m >= start && m <= end);
}

/**
 * Whether the valuations sit ON the period's boundaries (within tolerance) or
 * merely somewhere inside it. False ⇒ the column's figure is dated to the
 * valuation rather than to the calendar period: UB's calendar-2020 column is
 * really Apr 2019 → Mar 2020, and the page says so instead of implying
 * otherwise.
 */
function boundaryAligned(markDates, start, end) {
  const tol = markTolerance(start, end);
  const near = (target) => markDates.some((m) => Math.abs(dayDiff(m, target)) <= tol);
  return near(addDays(start, -1)) && near(end);
}

/**
 * How far the marks valuing each boundary actually sit from it, so the page can
 * disclose that an "annual" figure opens on a mark a month into the year rather
 * than implying the boundary was measured exactly.
 */
function boundaryDrift(markDates, start, end) {
  if (!markDates.length) return null;
  const nearest = (target) =>
    Math.min(...markDates.map((m) => Math.abs(dayDiff(m, target))));
  return { start: nearest(addDays(start, -1)), end: nearest(end) };
}

/**
 * Coverage = share of |Beginning MV| held by covered constituents.
 *
 * Deliberately not a binary: `Fidelity Fixed Income` is Cash Mgt $778,982
 * (never marked, and correctly so — cash) plus Bond $1,229,468, i.e. 61%. A
 * hard 90% cut-off would hide the whole fixed-income sleeve forever, so
 * 50–90% renders the % with a badge and only <50% suppresses it.
 */
function coverageShare(members, marksByAccount, bmvByAccount, start, end) {
  let total = 0;
  let covered = 0;
  const uncovered = [];
  for (const m of members) {
    const weight = Math.abs(Number(bmvByAccount[m.id]) || 0);
    if (weight === 0) continue;
    total += weight;
    const marks = marksByAccount[m.id] || [];
    if (isCovered(marks, start, end)) covered += weight;
    else uncovered.push({ account: m.name, weight, firstMark: marks[0] || null });
  }
  if (total === 0) return { share: 0, uncovered: [] };
  return {
    share: covered / total,
    uncovered: uncovered.map((u) => ({
      account: u.account,
      shareOfBMV: round(u.weight / total, 4),
      firstMark: u.firstMark,
    })),
  };
}

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

const round = (n, dp = 2) => {
  const f = 10 ** dp;
  return Math.round((Number(n) || 0) * f) / f;
};

/**
 * Cumulative MV per account at each boundary date, in the account's own
 * currency. One pass over the transactions rather than one balance-sheet build
 * per boundary (which would be ~320 full builds on the widest span).
 *
 * Carries the same `opening_balance_date` clause as the Balance Sheet: without
 * it a transaction predating that date counts in a component but not in MV, and
 * the identity silently breaks (prod has one — Chase Checking, +$1,950.61).
 */
async function fetchMvByBoundary(accountIds, boundaries) {
  const sql = `
    SELECT a.id AS account_id,
           b.d   AS boundary,
           a.opening_balance + COALESCE(SUM(t.amount), 0) AS mv
      FROM accounts a
      CROSS JOIN UNNEST($2::date[]) AS b(d)
      LEFT JOIN transactions t
        ON t.account_id = a.id
       AND t.transaction_date >= a.opening_balance_date
       AND t.transaction_date <= b.d
     WHERE a.id = ANY($1)
     GROUP BY a.id, a.opening_balance, b.d
  `;
  const { rows } = await db.query(sql, [accountIds, boundaries]);
  const out = {};
  for (const r of rows) {
    const key = r.boundary instanceof Date ? iso(r.boundary) : String(r.boundary).slice(0, 10);
    out[r.account_id] = out[r.account_id] || {};
    out[r.account_id][key] = Number(r.mv) || 0;
  }
  return out;
}

/**
 * Every transaction in the window, bucketed. The buckets are exhaustive by
 * construction — `bucket` has no fall-through — which is what makes the
 * identity close instead of merely being asserted.
 *
 * `is_transfer` (the column, not a name match) classifies flows, and that
 * INCLUDES `Transfer - Securities Trades`: its legs pair exactly and cancel, so
 * what survives is the unpaired remainder, which historically is real deposits
 * (Fidelity Stocks 2020: two $100K "Fid Bkg Svc" ACH transfers, +$200,460.86).
 */
async function fetchTransactions(accountIds, fromDate, toDate) {
  const sql = `
    SELECT t.transaction_date,
           t.account_id,
           t.amount,
           t.base_amount,
           t.currency,
           c.id          AS category_id,
           c.name        AS category_name,
           c.is_transfer AS is_transfer,
           c.section     AS category_section
      FROM transactions t
      JOIN accounts a ON a.id = t.account_id
      LEFT JOIN accounts c ON c.id = t.category_id
     WHERE t.account_id = ANY($1)
       AND t.transaction_date >= a.opening_balance_date
       AND t.transaction_date BETWEEN $2 AND $3
     ORDER BY t.transaction_date
  `;
  const { rows } = await db.query(sql, [accountIds, fromDate, toDate]);
  return rows.map((r) => ({
    date: r.transaction_date instanceof Date
      ? iso(r.transaction_date)
      : String(r.transaction_date).slice(0, 10),
    accountId: r.account_id,
    amount: Number(r.amount) || 0,
    baseAmount: Number(r.base_amount) || 0,
    currency: r.currency ? r.currency.trim() : 'USD',
    category: r.category_name,
    bucket: bucketOf(r),
  }));
}

function bucketOf(row) {
  if (!row.category_name) return 'unattributed';
  if (row.category_name === UNREALIZED_CATEGORY || row.category_id === UNREALIZED_CATEGORY_ID) {
    return 'price';
  }
  if (row.is_transfer) return 'flow';
  if (row.category_section !== 'profit_loss') return 'unattributed';
  return 'income';
}

/** Mark dates per account — the `Unrealized G/L` postings, ascending. */
async function fetchMarkDates(accountIds) {
  const { rows } = await db.query(
    `SELECT t.account_id, t.transaction_date
       FROM transactions t
       JOIN accounts c ON c.id = t.category_id
      WHERE t.account_id = ANY($1) AND (c.name = $2 OR c.id = $3)
      ORDER BY t.transaction_date`,
    [accountIds, UNREALIZED_CATEGORY, UNREALIZED_CATEGORY_ID]
  );
  const out = {};
  for (const r of rows) {
    const d = r.transaction_date instanceof Date
      ? iso(r.transaction_date)
      : String(r.transaction_date).slice(0, 10);
    (out[r.account_id] = out[r.account_id] || []).push(d);
  }
  return out;
}

/** Accounts where CR024's feed-balance override would diverge from this report. */
async function fetchFeedBalanceOverrides(accountIds) {
  const { rows } = await db.query(
    `SELECT a.name
       FROM account_source_mappings m
       JOIN accounts a ON a.id = m.account_id
      WHERE m.account_id = ANY($1) AND m.balance_from_feed = TRUE`,
    [accountIds]
  );
  return rows.map((r) => r.name);
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

async function buildInvestmentReturns({
  accountId,
  fromDate,
  toDate,
  interval = 'month',
  currency = 'usd',
}) {
  const mode = currency === 'lc' ? 'lc' : 'usd';
  const root = await accountsRepo.findById(accountId);
  if (!root) {
    const err = new Error(`Unknown account id ${accountId}`);
    err.status = 400;
    throw err;
  }

  // getDescendants excludes the node itself and prunes inactive subtrees — union
  // the root back in, or an account that is both a parent and holds transactions
  // silently drops its own.
  const descendants = await accountsRepo.getDescendants(accountId);
  const members = [
    { id: root.id, name: root.name, currency: (root.currency || 'USD').trim() },
    ...descendants.map((d) => ({
      id: d.id, name: d.name, currency: (d.currency || 'USD').trim(),
    })),
  ];
  const memberIds = members.map((m) => m.id);

  // Marks first: the "between marks" layout is derived from them.
  const marksByAccount = await fetchMarkDates(memberIds);
  const intervals =
    interval === 'marks'
      ? splitByMarks(
          members.flatMap((m) => marksByAccount[m.id] || []),
          fromDate,
          toDate
        )
      : splitIntervals(fromDate, toDate, interval);

  if (interval === 'marks' && intervals.length === 0) {
    const err = new Error(
      'This account needs at least two "Unrealized G/L" postings in the period to measure between marks.'
    );
    err.status = 400;
    throw err;
  }
  if (intervals.length > MAX_COLUMNS) {
    const err = new Error(
      `This span is ${intervals.length} ${interval} columns; it needs quarterly or annual intervals (max ${MAX_COLUMNS}).`
    );
    err.status = 400;
    throw err;
  }
  if (!intervals.length) return emptyReport(root, members, mode);

  const boundaries = [addDays(intervals[0].start, -1), ...intervals.map((i) => i.end)];
  const [mvByAccount, transactions, feedOverrides] = await Promise.all([
    fetchMvByBoundary(memberIds, boundaries),
    fetchTransactions(memberIds, intervals[0].start, intervals[intervals.length - 1].end),
    fetchFeedBalanceOverrides(memberIds),
  ]);

  // FX: one rate per (currency, boundary). USD selections skip the table entirely.
  const currencies = [...new Set(members.map((m) => m.currency))];
  const rates = await fetchRates(currencies, boundaries, mode);

  const mvAt = (boundary) => {
    let total = 0;
    for (const m of members) {
      const lc = (mvByAccount[m.id] || {})[boundary] || 0;
      total += mode === 'lc' ? lc : lc * (rates[`${m.currency}|${boundary}`] ?? 1);
    }
    return total;
  };
  const amountOf = (t) => (mode === 'lc' ? t.amount : t.baseAmount);

  const categoriesIn = (bucket) => [...new Set(
    transactions.filter((t) => t.bucket === bucket).map((t) => t.category)
  )].sort();

  const rows = {
    beginningMV: [], netFlows: [], incomeTotal: [], priceReturn: [],
    fxEffect: [], unattributed: [], totalReturn: [],
    returnPctRealized: [], returnPctUnrealized: [], returnPct: [],
    annualizedPct: [], avgCapital: [], coverage: [], boundaryDrift: [],
    boundaryAligned: [], markDates: [], endingMV: [],
    income: categoriesIn('income').map((c) => ({ category: c, values: [] })),
    // Flows break down too, so "where did $460K of 'external flows' come from?"
    // is answerable on the page instead of in psql.
    flows: categoriesIn('flow').map((c) => ({ category: c, values: [] })),
  };
  const markCoverage = [];

  for (const span of intervals) {
    const bmvBoundary = addDays(span.start, -1);
    const bmv = mvAt(bmvBoundary);
    const emv = mvAt(span.end);
    const inSpan = transactions.filter((t) => t.date >= span.start && t.date <= span.end);

    const sum = (pred) => inSpan.filter(pred).reduce((a, t) => a + amountOf(t), 0);
    const netFlows = sum((t) => t.bucket === 'flow');
    const price = sum((t) => t.bucket === 'price');
    const unattributed = sum((t) => t.bucket === 'unattributed');
    const incomeTotal = sum((t) => t.bucket === 'income');

    // FX effect is the plug, so the column ties by construction: any divergence
    // we did not enumerate lands here visibly instead of vanishing. Exactly 0
    // for an all-USD selection.
    const totalReturn = emv - bmv - netFlows;
    const fxEffect = totalReturn - (incomeTotal + price + unattributed);

    // BMV per account, for the coverage weighting.
    const bmvByAccount = {};
    for (const m of members) bmvByAccount[m.id] = (mvByAccount[m.id] || {})[bmvBoundary] || 0;
    const cov = coverageShare(members, marksByAccount, bmvByAccount, span.start, span.end);
    markCoverage.push({ interval: span.key, share: round(cov.share, 4), uncovered: cov.uncovered });

    // Realized income needs no mark — it is cash that actually arrived — so it
    // is reported whatever the coverage. Only the price-movement components
    // depend on the account having been valued at both ends.
    const pctRealized = returnOn(incomeTotal, bmv, emv);
    const marked = cov.share >= COVERAGE_FLOOR;
    const pctUnrealized = marked ? returnOn(price, bmv, emv) : null;
    const pct = marked ? returnOn(totalReturn, bmv, emv) : null;

    rows.beginningMV.push(round(bmv));
    rows.netFlows.push(round(netFlows));
    rows.incomeTotal.push(round(incomeTotal));
    rows.priceReturn.push(round(price));
    rows.fxEffect.push(round(fxEffect));
    rows.unattributed.push(round(unattributed));
    rows.totalReturn.push(round(totalReturn));
    rows.returnPctRealized.push(pctRealized === null ? null : round(pctRealized, 6));
    rows.returnPctUnrealized.push(pctUnrealized === null ? null : round(pctUnrealized, 6));
    rows.returnPct.push(pct === null ? null : round(pct, 6));
    // "Between marks" spans are irregular — a missing mark makes one column
    // cover two years — so a column longer than a year also reports its
    // annualized rate, or the columns cannot be compared to each other.
    rows.annualizedPct.push(
      nullableRound(annualize(pct, dayDiff(span.start, span.end) + 1), 6)
    );
    rows.avgCapital.push(round(averageCapital(bmv, emv) ?? 0));
    rows.coverage.push(round(cov.share, 4));
    const allMarks = members.flatMap((m) => marksByAccount[m.id] || []).sort();
    rows.boundaryDrift.push(boundaryDrift(allMarks, span.start, span.end));
    // Dated to the valuation rather than to the calendar period? The page marks
    // the column so a fiscal-year figure is not read as a calendar-year one.
    rows.boundaryAligned.push(
      cov.share > 0 ? boundaryAligned(allMarks, span.start, span.end) : null
    );
    rows.markDates.push(allMarks.filter((m) => m >= addDays(span.start, -1) && m <= span.end));
    rows.endingMV.push(round(emv));
    for (const row of rows.income) {
      row.values.push(round(sum((t) => t.bucket === 'income' && t.category === row.category)));
    }
    for (const row of rows.flows) {
      row.values.push(round(sum((t) => t.bucket === 'flow' && t.category === row.category)));
    }
  }

  const total = buildTotal(rows, intervals);

  // IRR over the whole period, from the real dated flows. Sign convention is the
  // investor's: money INTO the account is an outflow (negative), so a ledger
  // contribution of +X becomes −X here. Opening value is the initial investment,
  // closing value the final proceeds.
  const firstBoundary = addDays(intervals[0].start, -1);
  const lastEnd = intervals[intervals.length - 1].end;
  const irrFlows = [
    { date: firstBoundary, amount: -mvAt(firstBoundary) },
    ...transactions
      .filter((t) => t.bucket === 'flow')
      .map((t) => ({ date: t.date, amount: -amountOf(t) })),
    { date: lastEnd, amount: mvAt(lastEnd) },
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // A period nothing valued has no ending MARKET value — only a cost basis — so
  // an IRR off it would report ~0% as if the asset had genuinely not moved.
  // Same rule the percentages already follow.
  total.irr = rows.coverage.some((c) => c > 0)
    ? nullableRound(xirr(irrFlows), 6)
    : null;

  return {
    data: {
      account: {
        id: root.id, name: root.name, isRollup: descendants.length > 0, members,
      },
      intervals,
      rows,
      total,
    },
    meta: {
      currency: mode,
      currencies,
      mixedCurrency: mode === 'lc' && currencies.length > 1,
      markCoverage,
      markCadence: buildCadence(members, marksByAccount, mvByAccount, boundaries),
      chainBrokenBy: intervals
        .filter((_, i) => rows.returnPct[i] === null)
        .map((s) => s.key),
      feedBalanceOverrides: feedOverrides,
      // The span over which marks actually exist. A period reaching outside it
      // produces columns that fail the boundary test by a few weeks — which
      // reads as "no return" when the truth is "you asked outside the data".
      // The page offers this as a one-click re-run.
      markedWindow: markedWindow(members, marksByAccount),
      unattributedTotal: round(rows.unattributed.reduce((a, b) => a + b, 0)),
    },
  };
}

/**
 * Totals. Absolutes sum; the % is the linked chain. When the chain breaks, we
 * report the longest contiguous supported run LABELLED WITH ITS REAL DATES
 * rather than a whole-period Dietz — without this the default view is a wall of
 * dashes, because no Fidelity calendar-year column is computable at all.
 */
function buildTotal(rows, intervals) {
  const sumRow = (r) => round(r.reduce((a, b) => a + b, 0));
  const chain = chainReturns(rows.returnPct);
  const base = {
    beginningMV: rows.beginningMV[0] ?? 0,
    endingMV: rows.endingMV[rows.endingMV.length - 1] ?? 0,
    netFlows: sumRow(rows.netFlows),
    // Per-category totals belong here, not re-derived client-side: a single
    // null in a values array would make a client reduce() emit "$NaN".
    income: rows.income.map((r) => ({ category: r.category, value: sumRow(r.values) })),
    flows: rows.flows.map((r) => ({ category: r.category, value: sumRow(r.values) })),
    incomeTotal: sumRow(rows.incomeTotal),
    priceReturn: sumRow(rows.priceReturn),
    fxEffect: sumRow(rows.fxEffect),
    unattributed: sumRow(rows.unattributed),
    totalReturn: sumRow(rows.totalReturn),
    cumulative: true,
  };

  // All three percentages chain over the SAME intervals, or they cannot be read
  // against each other: chaining realized over three years while the total
  // covers two would put unrelated figures in one column.
  if (chain !== null) {
    const days = dayDiff(intervals[0].start, intervals[intervals.length - 1].end) + 1;
    return {
      ...base,
      returnPctRealized: nullableRound(chainReturns(rows.returnPctRealized), 6),
      returnPctUnrealized: nullableRound(chainReturns(rows.returnPctUnrealized), 6),
      returnPct: round(chain, 6),
      annualizedPct: nullableRound(annualize(chain, days), 6),
      chainBroken: false,
      clippedSpan: null,
    };
  }

  const run = longestSupportedRun(rows.returnPct);
  if (!run) {
    return {
      ...base,
      returnPctRealized: null,
      returnPctUnrealized: null,
      returnPct: null,
      annualizedPct: null,
      chainBroken: true,
      clippedSpan: null,
    };
  }
  const over = (r) => nullableRound(chainReturns(r.slice(run.start, run.end + 1)), 6);
  const span = { start: intervals[run.start].start, end: intervals[run.end].end };
  const clipped = chainReturns(rows.returnPct.slice(run.start, run.end + 1));
  return {
    ...base,
    returnPctRealized: over(rows.returnPctRealized),
    returnPctUnrealized: over(rows.returnPctUnrealized),
    returnPct: nullableRound(clipped, 6),
    annualizedPct: nullableRound(annualize(clipped, dayDiff(span.start, span.end) + 1), 6),
    chainBroken: true,
    clippedSpan: span,
  };
}

const nullableRound = (n, dp) => (n === null || n === undefined ? null : round(n, dp));

/**
 * Mark cadence per member, for the page's banners.
 *
 * "Never revalued" is gated on the account actually HOLDING value: a parent
 * container like `Fidelity Stock` carries no transactions and no balance of its
 * own, so naming it is noise. `Fidelity Cash Mgt` holds $779K and is still
 * named, which is the point.
 */
/**
 * Earliest and latest mark across every mark-bearing member. Not the intersection
 * of all members' windows: coverage is BMV-weighted, so a small late-marked
 * member (Fidelity Options, 4.4% of the Fidelity Stock roll-up, first marked
 * 2026-05) must not shrink the usable window to nothing.
 */
function markedWindow(members, marksByAccount) {
  const firsts = [];
  const lasts = [];
  for (const m of members) {
    const marks = marksByAccount[m.id] || [];
    if (!marks.length) continue;
    firsts.push(marks[0]);
    lasts.push(marks[marks.length - 1]);
  }
  if (!firsts.length) return null;
  return {
    start: firsts.sort()[0],
    end: lasts.sort()[lasts.length - 1],
  };
}

function buildCadence(members, marksByAccount, mvByAccount, boundaries) {
  return members
    .map((m) => {
      const marks = marksByAccount[m.id] || [];
      if (!marks.length) {
        const holdsValue = boundaries.some(
          (b) => Math.abs((mvByAccount[m.id] || {})[b] || 0) >= 1
        );
        return holdsValue
          ? { account: m.name, cadence: 'never', anchor: null, marks: [] }
          : null;
      }
      // Modal anchor, not "all marks agree": United Beverages marks on 31 March
      // but carries one stray 2025-12-31, and a banner that cannot name the
      // anchor is exactly the information the owner needs to see.
      const tally = {};
      for (const d of marks) tally[d.slice(5)] = (tally[d.slice(5)] || 0) + 1;
      const [topAnchor, topCount] = Object.entries(tally)
        .sort((a, b) => b[1] - a[1])[0];
      const gaps = marks.slice(1).map((d, i) => dayDiff(marks[i], d));
      const median = gaps.length ? gaps.slice().sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : null;
      let cadence = 'ad hoc';
      if (median === null) cadence = 'one-off';
      else if (median <= 40) cadence = 'monthly';
      else if (median <= 120) cadence = 'quarterly';
      else if (median <= 400) cadence = 'annual';
      return {
        account: m.name,
        cadence,
        anchor: topCount / marks.length >= 0.5 ? topAnchor : null,
        marks,
      };
    })
    .filter(Boolean);
}

async function fetchRates(currencies, boundaries, mode) {
  const rates = {};
  if (mode === 'lc') return rates;
  const foreign = currencies.filter((c) => c !== 'USD');
  for (const cur of currencies) {
    for (const b of boundaries) rates[`${cur}|${b}`] = 1;
  }
  if (!foreign.length) return rates;
  await Promise.all(
    foreign.flatMap((cur) =>
      boundaries.map(async (b) => {
        const r = await rateAsOf(db, cur, b);
        rates[`${cur}|${b}`] = r === null ? 1 : r;
      })
    )
  );
  return rates;
}

function emptyReport(root, members, mode) {
  return {
    data: {
      account: { id: root.id, name: root.name, isRollup: members.length > 1, members },
      intervals: [],
      rows: {
        beginningMV: [], netFlows: [], income: [], flows: [], incomeTotal: [],
        priceReturn: [], fxEffect: [], unattributed: [], totalReturn: [],
        returnPctRealized: [], returnPctUnrealized: [], returnPct: [],
        annualizedPct: [], avgCapital: [], coverage: [], boundaryDrift: [],
        boundaryAligned: [], markDates: [], endingMV: [],
      },
      total: null,
    },
    meta: {
      currency: mode, currencies: [], mixedCurrency: false, markCoverage: [],
      markCadence: [], chainBrokenBy: [], feedBalanceOverrides: [],
      markedWindow: null, unattributedTotal: 0,
    },
  };
}

module.exports = {
  buildInvestmentReturns,
  // exported for unit tests — the arithmetic must be testable without a DB
  splitIntervals,
  splitByMarks,
  boundaryAligned,
  xirr,
  averageCapital,
  returnOn,
  markTolerance,
  chainReturns,
  longestSupportedRun,
  annualize,
  isCovered,
  coverageShare,
  bucketOf,
  isValidDateString,
  MAX_COLUMNS,
  COVERAGE_FULL,
  COVERAGE_FLOOR,
};
