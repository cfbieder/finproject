'use strict';
/**
 * income.js — CR093 P3. What this portfolio PAYS, and when.
 *
 * ⚠️ SCHEDULED AND ESTIMATED INCOME ARE NOT ONE NUMBER, and adding them without
 * saying which is which is the failure this CR keeps catching in new costumes.
 *
 *   scheduled  a bond's coupon. CONTRACTUAL and DATED — the issuer owes it, and
 *              we know the day. Derived from the custodian's own terms.
 *   estimated  a dividend. A PROJECTION from what was paid over the last twelve
 *              months. Nobody owes it and the next one can be cut.
 *
 * A portfolio "income" figure that merges them tells the owner a fund's
 * distribution is as reliable as a Treasury coupon.
 *
 * ⚠️ AND ANNUAL INCOME IS NOT `face x coupon`. It is the coupons that actually
 * fall inside the next twelve months, which is fewer as a bond approaches
 * maturity. CR093 §4 measured this on the custodian's own statement: BLACKSTONE
 * PRIVATE CREDIT FUND maturing 2026-12-15 shows EAI **$196.87** against a
 * coupon-implied **$393.75** — exactly half, because only one coupon remains.
 * Dividing the naive figure by market value gives a "yield" that does not fall
 * as a bond runs off, which is how a maturing holding looks like a yield cut
 * that never happened.
 */

const db = require('../v2/db');

/** Payments per year, by the frequency the statements print. `at_maturity` pays
 *  once, on the maturity date, and is handled by the schedule walk rather than
 *  by a rate. */
const PERIODS_PER_YEAR = {
  monthly: 12, quarterly: 4, semiannually: 2, annually: 1, at_maturity: null,
};

/** Par per quantity unit — a bond quoted per $100 of face prices $100 per unit. */
const PAR_PER_UNIT = { per_100_face: 100, per_1_face: 1 };

function addMonths(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  // Anchor on the day-of-month of MATURITY and clamp to the month's length, so
  // a bond maturing on the 31st pays on the 30th in a 30-day month rather than
  // rolling into the next one.
  const target = new Date(Date.UTC(y, (m - 1) + n, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/**
 * The coupon dates falling in `(from, to]`.
 *
 * ⚠️ WALKED BACKWARDS FROM MATURITY, which is how a bond's schedule is actually
 * defined: the final coupon lands with the principal and every earlier one is a
 * whole period before it. Walking FORWARDS from today would need an issue date
 * we do not have, and would put the payments on the wrong days of the month.
 *
 * ⚠️ Nothing is generated after maturity. A bond that matures inside the window
 * stops paying, which is the entire reason this function exists rather than a
 * multiplication.
 */
function couponDates(maturity, frequency, from, to) {
  if (!maturity) return [];
  const per = PERIODS_PER_YEAR[frequency];
  const end = maturity < to ? maturity : to;
  if (per === null || per === undefined) {
    // `at_maturity`: one payment, on the day the principal comes back.
    return maturity > from && maturity <= to ? [maturity] : [];
  }
  const step = 12 / per;
  const out = [];
  // 🔴 EVERY DATE IS COMPUTED FROM MATURITY, never from the previous one.
  //
  // Stepping back one period at a time makes the month-end clamp STICKY: a bond
  // maturing on the 31st clamps to Nov 30, and the next step back then anchors
  // on the 30th, then on the 28th after February — so a December-31 bond ended
  // up paying on the 28th of every month. The anchor is the maturity day and it
  // has to survive every hop, so the offset is multiplied instead of accumulated.
  for (let k = 0; k < 600; k += 1) {
    const d = addMonths(maturity, -step * k);
    if (d <= from) break;
    if (d <= end) out.push(d);
  }
  return out.sort();
}

/**
 * The dollars of face behind a bond position.
 *
 * 🔴 DERIVED FROM PRICE AND MARKET VALUE, **NOT** FROM `quantity` — because
 * `quantity` does not mean the same thing in every row.
 *
 * Measured 2026-09-05 on BLACKSTONE PRIVATE CREDIT FUND, one security,
 * `price_basis = 'per_100_face'` on both:
 *   bank-feed  quantity     150 x price 99.409  = 14,911.35   (units of $100)
 *   statement  quantity 100,000 x price 100.083 / 100 = 100,082.61  (dollars)
 * Each source's arithmetic is internally consistent and each market value is
 * correct — which is exactly why nothing ever complained. `market_value` is the
 * column the reconciliation gate reads, and it was right in both.
 *
 * `face = market_value x par / price` uses only the two fields that ARE
 * consistent within a row, so it gives 15,000 and 100,000 respectively — the
 * right answer from either source, with no assumption about which wrote it.
 * A coupon computed off `quantity` alone is wrong by 100x on half the corpus.
 */
function faceOf(position) {
  const par = PAR_PER_UNIT[position.price_basis];
  const price = Number(position.price);
  if (!par || !Number.isFinite(price) || price <= 0) return null;
  const mv = Number(position.market_value);
  if (!Number.isFinite(mv) || mv <= 0) return null;
  return (mv * par) / price;
}

/** One bond's income inside the window, and the dates it arrives on. */
function bondIncome(position, from, to) {
  const par = PAR_PER_UNIT[position.price_basis];
  if (!par || position.coupon_rate === null || position.coupon_rate === undefined) return null;
  const face = faceOf(position);
  if (face === null) return null;
  const per = PERIODS_PER_YEAR[position.payment_frequency];
  const dates = couponDates(position.maturity_date, position.payment_frequency, from, to);
  // `at_maturity` pays the whole annual rate once for each year held; with no
  // period we can only state the single payment's rate, so the coupon is applied
  // once. Flagged rather than guessed at.
  const perPayment = per ? (face * position.coupon_rate) / 100 / per : (face * position.coupon_rate) / 100;
  return {
    face: Number(face.toFixed(2)),
    per_payment: Number(perPayment.toFixed(2)),
    dates,
    total: Number((perPayment * dates.length).toFixed(2)),
    // ⚠️ A bond callable before maturity may simply stop paying. We cannot
    // predict a call, so the schedule runs to maturity and the fact is carried.
    callable_before: position.next_call_date && position.next_call_date <= to
      ? position.next_call_date : null,
  };
}

/**
 * The whole picture, from rows already fetched. Pure — no db, no clock.
 *
 * @param positions bond and equity rows (see buildIncome's query)
 * @param from      exclusive start of the window (today)
 * @param to        inclusive end (a year out)
 */
function summariseIncome(positions, from, to, portfolioValue) {
  const scheduled = [];
  const estimated = [];
  const noAnswer = [];
  const byMonth = new Map();
  const bump = (month, key, amount) => {
    if (!byMonth.has(month)) byMonth.set(month, { month, scheduled: 0, estimated: 0 });
    byMonth.get(month)[key] += amount;
  };

  for (const p of positions) {
    const b = bondIncome(p, from, to);
    if (b) {
      if (b.dates.length) {
        scheduled.push({
          security_id: p.id,
          name: p.name,
          face: b.face,
          coupon_rate: p.coupon_rate,
          payment_frequency: p.payment_frequency,
          maturity_date: p.maturity_date,
          payments: b.dates.length,
          per_payment: b.per_payment,
          total: b.total,
          callable_before: b.callable_before,
          matures_in_window: p.maturity_date && p.maturity_date <= to,
        });
        for (const d of b.dates) bump(d.slice(0, 7), 'scheduled', b.per_payment);
      }
      continue;
    }

    // ⚠️ CASH IS ESTIMATED, NOT SCHEDULED. A money-market 7-day yield and an FDIC
    // sweep rate both FLOAT — neither is owed on a date, and both can move the
    // week after the statement that printed them. This corpus runs 0.06% (2016)
    // to 5.30% (2023), so the rate's own date is carried with it.
    if (p.cash_rate !== null && p.cash_rate !== undefined && Number(p.cash_rate) > 0
        && Number(p.market_value) > 0) {
      const total = (Number(p.market_value) * Number(p.cash_rate)) / 100;
      estimated.push({
        security_id: p.id,
        ticker: p.ticker,
        name: p.name,
        basis: 'cash_rate',
        rate: Number(p.cash_rate),
        rate_kind: p.rate_kind,
        rate_as_of: p.cash_rate_as_of,
        market_value: Number(p.market_value).toFixed(2),
        total: Number(total.toFixed(2)),
      });
      const months = monthsBetween(from, to);
      for (const m of months) bump(m, 'estimated', total / months.length);
      continue;
    }

    // Not a bond: a dividend projection, if we have a run rate.
    if (p.ttm_income !== null && p.ttm_income !== undefined && Number(p.ttm_income) > 0) {
      const total = Number(p.ttm_income) * Number(p.quantity);
      estimated.push({
        security_id: p.id,
        ticker: p.ticker,
        name: p.name,
        basis: 'distribution',
        quantity: Number(p.quantity),
        ttm_per_share: Number(p.ttm_income),
        total: Number(total.toFixed(2)),
      });
      // ⚠️ SPREAD EVENLY, and the page says so. We know what was paid over the
      // last year, not when the next payments land — projecting last year's
      // dates forward would assert a calendar nobody published.
      const months = monthsBetween(from, to);
      for (const m of months) bump(m, 'estimated', total / months.length);
      continue;
    }

    // Everything else: no coupon, no distribution history. Named and GROUPED,
    // never dropped — the three reasons mean different things and only one of
    // them is a hole in our data.
    if (Number(p.market_value) > 0) {
      noAnswer.push({
        security_id: p.id,
        ticker: p.ticker,
        name: p.name,
        market_value: Number(p.market_value).toFixed(2),
        group: absenceGroup(p),
      });
    }
  }

  const sum = (rows) => Number(rows.reduce((a, r) => a + r.total, 0).toFixed(2));
  const scheduledTotal = sum(scheduled);
  const estimatedTotal = sum(estimated);
  const total = Number((scheduledTotal + estimatedTotal).toFixed(2));

  return {
    window: { from, to },
    // ⚠️ Reported separately FIRST and combined second, because the two are not
    // equally reliable and a single figure hides that.
    scheduled: {
      total: scheduledTotal,
      holdings: scheduled.sort((a, b) => b.total - a.total),
      callable_total: Number(scheduled.filter((s) => s.callable_before)
        .reduce((a, s) => a + s.total, 0).toFixed(2)),
      maturing_total: Number(scheduled.filter((s) => s.matures_in_window)
        .reduce((a, s) => a + s.total, 0).toFixed(2)),
    },
    estimated: {
      total: estimatedTotal,
      holdings: estimated.sort((a, b) => b.total - a.total),
    },
    total,
    // Income against what the portfolio is worth. Named "on the portfolio" so it
    // is not read as a yield on the income-producing part alone.
    yield_on_portfolio: portfolioValue ? total / portfolioValue : null,
    by_month: monthlyRows(byMonth, scheduledTotal, estimatedTotal),
    // ⚠️ GROUPED, because "we cannot say" covers three unrelated situations and
    // one lump would make the largest of them look like a defect.
    no_answer: ABSENCE_GROUPS.map((g) => {
      const rows = noAnswer.filter((r) => r.group === g.key)
        .sort((a, b) => Number(b.market_value) - Number(a.market_value));
      return {
        ...g,
        holdings: rows,
        value: rows.reduce((a, r) => a + Number(r.market_value), 0).toFixed(2),
      };
    }).filter((g) => g.holdings.length),
    no_answer_value: noAnswer.reduce((a, r) => a + Number(r.market_value), 0).toFixed(2),
  };
}

/**
 * ⚠️ THREE REASONS THIS PORTFOLIO CANNOT STATE AN INCOME, and they are not one
 * bucket:
 *   pays_nothing   measured. BRK/B, KD and SPCX pay no distribution — a fact
 *                  about the company, and it will never change into data.
 *   awaiting_terms a bond bought since the last quarter-end. It pays a coupon we
 *                  simply have not read yet, and the next statement closes it.
 *   rate_unknown   cash, money-market and FDIC deposits. These DO pay interest —
 *                  the statements print `7-day yield: 3.47%` and
 *                  `Interest rate: 1.82%` — and the parser discards it, so this
 *                  is the one genuine gap and it UNDERSTATES the total.
 */
const ABSENCE_GROUPS = [
  { key: 'awaiting_terms', label: 'Bonds with no statement yet', note: 'They pay a coupon; the next quarterly statement supplies it.' },
  { key: 'rate_unknown', label: 'Cash with no rate on any statement', note: 'It pays interest we cannot state — this holding appears in the feed but on no statement, so the total understates by whatever it earns.' },
  { key: 'no_coverage', label: 'No distribution history available', note: 'An open-end fund the price provider does not cover.' },
  { key: 'pays_nothing', label: 'Pays no distribution', note: 'Measured, not missing.' },
];

function absenceGroup(p) {
  if (PAR_PER_UNIT[p.price_basis]) return 'awaiting_terms';
  // `par` is the structural tell for cash-like instruments, the same signal
  // services/exposure.js reads.
  if (p.price_basis === 'par') return 'rate_unknown';
  if (p.dividends_asked) return 'pays_nothing';
  return 'no_coverage';
}

/**
 * The monthly rows, rounded so that each column SUMS TO ITS OWN TOTAL.
 *
 * ⚠️ Rounding thirteen buckets independently loses cents: an estimate of $200
 * spread evenly comes back as $199.94, and a table whose column does not add up
 * to the figure printed above it invites the reader to wonder which is wrong.
 * The residual goes to the LARGEST bucket, where a few cents cannot change what
 * the row says, rather than to the last one, where it would show up on a small
 * partial month.
 */
function monthlyRows(byMonth, scheduledTotal, estimatedTotal) {
  const rows = [...byMonth.values()]
    .sort((a, b) => (a.month < b.month ? -1 : 1))
    .map((m) => ({
      month: m.month,
      scheduled: Number(m.scheduled.toFixed(2)),
      estimated: Number(m.estimated.toFixed(2)),
    }));
  if (!rows.length) return rows;

  for (const [key, target] of [['scheduled', scheduledTotal], ['estimated', estimatedTotal]]) {
    const got = rows.reduce((a, r) => a + r[key], 0);
    const residual = Number((target - got).toFixed(2));
    if (residual === 0) continue;
    const biggest = rows.reduce((best, r) => (r[key] > best[key] ? r : best), rows[0]);
    biggest[key] = Number((biggest[key] + residual).toFixed(2));
  }
  return rows.map((r) => ({ ...r, total: Number((r.scheduled + r.estimated).toFixed(2)) }));
}

function monthsBetween(from, to) {
  const out = [];
  let d = `${from.slice(0, 7)}-01`;
  for (let i = 0; i < 24 && d <= to; i += 1) {
    out.push(d.slice(0, 7));
    d = addMonths(d, 1);
  }
  return out;
}

/**
 * CR103 — merge per-account rows back into one row per security, so the
 * all-accounts view is computed from exactly the rows it always was (§4.1: no
 * per-account rounding leaks into the total). Prices are identical across
 * accounts (measured: SPAXX, QQQ, DIA are the only multi-account holdings).
 */
function mergeBySecurity(positions) {
  const by = new Map();
  for (const p of positions) {
    const m = by.get(p.id);
    if (!m) { by.set(p.id, { ...p }); continue; }
    m.quantity = Number(m.quantity) + Number(p.quantity);
    m.market_value = Number(m.market_value) + Number(p.market_value);
    m.price = Math.max(Number(m.price) || 0, Number(p.price) || 0);
  }
  return [...by.values()];
}

const CATEGORY = { interest: 'Interest Income', dividend: 'Financial Income - Dividend' };
const BASIS = {
  coupon: { category: 'interest', label: 'bond coupons' },
  cash_deposit: { category: 'interest', label: 'FDIC deposit interest' },
  money_market: { category: 'dividend', label: 'money-market income' },
  reinvestment: { category: 'dividend', label: 'reinvested maturities' },
  distribution_fund: { category: 'dividend', label: 'bond-fund distributions' },
  distribution_stock: { category: 'dividend', label: 'stock & equity-fund dividends' },
};

/** Round twelve months to the cent so they SUM to the row's rounded total; the
 *  residual goes to the largest month (the monthlyRows rule). */
function roundMonths(months) {
  const out = months.map((v) => Number(v.toFixed(2)));
  const target = Number(months.reduce((a, v) => a + v, 0).toFixed(2));
  const residual = Number((target - out.reduce((a, v) => a + v, 0)).toFixed(2));
  if (residual !== 0) {
    let k = 0;
    out.forEach((v, i) => { if (Math.abs(v) > Math.abs(out[k])) k = i; });
    out[k] = Number((out[k] + residual).toFixed(2));
  }
  return { months: out, total: target };
}

/**
 * CR103 P1 — calendar year `year` from TODAY's holdings, per account × basis,
 * Jan–Dec. Pure: no db, no clock (`today` is passed).
 *
 * ⚠️ THREE BOUNDARIES, KEPT APART (§4.3): the months are 1–12 of `year`; the
 * coupon walk is exclusive of its start, so it starts on 31 Dec of the year
 * before (a 1 January coupon counts); and the dividend window was already
 * anchored per security in the query (D6), never on this window.
 *
 * Categories follow how the ledger BOOKS each kind (D7): coupons and FDIC
 * deposits → Interest; money-market income, reinvestment and every
 * distribution → Dividend.
 */
function budgetYear(positions, year, { today, reinvestRate = null } = {}) {
  const yStart = `${year - 1}-12-31`;
  const yEnd = `${year}-12-31`;
  const rows = new Map();
  const noData = new Map();
  const acct = (p) => ({ account_id: p.account_id, account_name: p.account_name });
  const add = (p, basis, months, extra = {}) => {
    const key = `${p.account_id}|${basis}|${extra.rate ?? ''}`;
    if (!rows.has(key)) rows.set(key, { ...acct(p), basis, ...extra, raw: Array(12).fill(0) });
    const r = rows.get(key);
    months.forEach((v, i) => { r.raw[i] += v; });
  };
  const even = (total) => Array(12).fill(total / 12);

  // Default reinvestment rate: the account's own money-market 7-day yield, else
  // the portfolio's highest (§4.5).
  const mmf = positions.filter((p) => p.rate_kind === 'seven_day_yield' && Number(p.cash_rate) > 0);
  const portfolioRate = mmf.reduce((best, p) => (Number(p.cash_rate) > (best?.rate ?? -1)
    ? { rate: Number(p.cash_rate), as_of: p.cash_rate_as_of, source: p.ticker } : best), null);
  const rateFor = (accountId) => {
    if (reinvestRate !== null && reinvestRate !== undefined) return { rate: Number(reinvestRate), as_of: null, source: 'entered' };
    const own = mmf.filter((p) => p.account_id === accountId)
      .reduce((best, p) => (Number(p.cash_rate) > (best?.rate ?? -1)
        ? { rate: Number(p.cash_rate), as_of: p.cash_rate_as_of, source: p.ticker } : best), null);
    return own || portfolioRate;
  };
  const rates = new Map();

  for (const p of positions) {
    const b = bondIncome(p, yStart, yEnd);
    if (b) {
      const months = Array(12).fill(0);
      for (const d of b.dates) months[Number(d.slice(5, 7)) - 1] += b.per_payment;
      if (b.dates.length) add(p, 'coupon', months);
      // D4: principal maturing after today and by year-end is reinvested from
      // the month after maturity (January for a maturity before the year).
      if (p.maturity_date && p.maturity_date > today && p.maturity_date <= yEnd && b.face) {
        const r = rateFor(p.account_id);
        if (r && r.rate > 0) {
          rates.set(p.account_id, { ...r, account_name: p.account_name });
          const startM = p.maturity_date < `${year}-01-01` ? 0 : Number(p.maturity_date.slice(5, 7));
          const m = Array(12).fill(0);
          for (let i = startM; i < 12; i += 1) m[i] = (b.face * r.rate) / 100 / 12;
          if (startM < 12) add(p, 'reinvestment', m, { rate: r.rate });
        }
      }
      continue;
    }
    if (p.cash_rate !== null && p.cash_rate !== undefined && Number(p.cash_rate) > 0 && Number(p.market_value) > 0) {
      const total = (Number(p.market_value) * Number(p.cash_rate)) / 100;
      add(p, p.rate_kind === 'interest_rate' ? 'cash_deposit' : 'money_market', even(total));
      continue;
    }
    if (p.ttm_income !== null && p.ttm_income !== undefined && Number(p.ttm_income) > 0) {
      const total = Number(p.ttm_income) * Number(p.quantity);
      const basis = p.asset_class === 'bond' && p.price_basis === 'per_share' ? 'distribution_fund'
        : p.asset_class === 'mmf' ? 'money_market' : 'distribution_stock';
      // D5: last year's PAY months as the shape, weighted by amount.
      const w = Array(12).fill(0);
      (p.pay_months || []).forEach((m, i) => { if (m) w[m - 1] += Number((p.pay_amounts || [])[i]) || 0; });
      const sumW = w.reduce((a, v) => a + v, 0);
      add(p, basis, sumW > 0 ? w.map((v) => (total * v) / sumW) : even(total));
      continue;
    }
    if (Number(p.market_value) > 0 && absenceGroup(p) !== 'pays_nothing') {
      noData.set(p.account_id, (noData.get(p.account_id) || 0) + Number(p.market_value));
    }
  }

  const order = Object.keys(BASIS);
  const out = [...rows.values()].map((r) => {
    const { months, total } = roundMonths(r.raw);
    const meta = BASIS[r.basis];
    const label = r.basis === 'reinvestment' ? `${meta.label} @ ${r.rate.toFixed(2)}%` : meta.label;
    return {
      account_id: r.account_id,
      account_name: r.account_name,
      basis: r.basis,
      category: meta.category,
      category_name: CATEGORY[meta.category],
      description: `${r.account_name} — ${label}`,
      months,
      total,
    };
  }).filter((r) => r.total !== 0)
    .sort((a, b) => a.account_name.localeCompare(b.account_name) || order.indexOf(a.basis) - order.indexOf(b.basis));

  return {
    year,
    rows: out,
    reinvest_rates: [...rates.entries()].map(([account_id, r]) => ({ account_id, ...r })),
    default_reinvest_rate: portfolioRate,
    no_data: [...noData.entries()].map(([account_id, value]) => ({ account_id, value: Number(value.toFixed(2)) })),
  };
}

async function buildIncome({ asOf, year, reinvestRate } = {}) {
  const from = asOf || new Date().toISOString().slice(0, 10);
  const to = addMonths(from, 12);

  // CR103: one row per (ACCOUNT, security). D6/D8: each security's dividend
  // window ends at min(today, its own dividends_as_of), so a stale load still
  // gives a full year instead of ~10 months.
  const { rows: positions } = await db.query(`
    WITH latest AS (
      SELECT DISTINCT ON (account_id) id FROM security_position_snapshots
       WHERE source = 'bank-feed' AND status = 'fetched'
       ORDER BY account_id, polled_on DESC),
    ttm AS (
      SELECT d.security_id, SUM(d.cash_amount)::float AS income,
             array_agg(EXTRACT(MONTH FROM COALESCE(d.pay_date, d.ex_date))::int ORDER BY d.ex_date) AS pay_months,
             array_agg(d.cash_amount::float ORDER BY d.ex_date) AS pay_amounts
        FROM security_dividends d
        JOIN securities s ON s.id = d.security_id
       WHERE d.dividend_type = 'CD'
         AND d.ex_date > (LEAST($1::date, COALESCE(s.dividends_as_of, $1::date)) - INTERVAL '1 year')
         AND d.ex_date <= LEAST($1::date, COALESCE(s.dividends_as_of, $1::date))
       GROUP BY d.security_id)
    SELECT snap.account_id, a.name AS account_name,
           s.id, s.ticker, s.name, s.price_basis, s.asset_class,
           s.dividends_as_of IS NOT NULL AS dividends_asked, s.dividends_as_of::text AS dividends_as_of,
           SUM(p.quantity)::float AS quantity,
           SUM(p.market_value)::float AS market_value,
           MAX(p.price)::float AS price,
           t.coupon_rate::float AS coupon_rate, t.payment_frequency,
           t.maturity_date::text AS maturity_date, t.next_call_date::text AS next_call_date,
           d.income AS ttm_income, d.pay_months, d.pay_amounts,
           c.rate::float AS cash_rate, c.rate_kind, c.as_of::text AS cash_rate_as_of
      FROM security_positions p
      JOIN security_position_snapshots snap ON snap.id = p.snapshot_id
      JOIN accounts a ON a.id = snap.account_id
      JOIN securities s ON s.id = p.security_id
      LEFT JOIN security_bond_terms t ON t.security_id = s.id
      LEFT JOIN ttm d ON d.security_id = s.id
      LEFT JOIN security_cash_rates c ON c.security_id = s.id
     WHERE p.snapshot_id IN (SELECT id FROM latest)
     GROUP BY snap.account_id, a.name, s.id, s.ticker, s.name, s.price_basis, s.asset_class, s.dividends_as_of,
              t.coupon_rate, t.payment_frequency, t.maturity_date, t.next_call_date,
              d.income, d.pay_months, d.pay_amounts, c.rate, c.rate_kind, c.as_of`,
  [from]);

  // The OLDEST load among held securities: a partial reload of a few tickers must
  // not make the page say "loaded today" while other holdings' windows end months back.
  const loads = positions.map((p) => p.dividends_as_of).filter(Boolean).sort();
  const asof = { dividends_as_of: loads[0] || null };

  const mv = (rows) => rows.reduce((a, p) => a + (p.market_value || 0), 0);
  const all = mergeBySecurity(positions);
  const byAccount = new Map();
  for (const p of positions) {
    if (!byAccount.has(p.account_id)) byAccount.set(p.account_id, []);
    byAccount.get(p.account_id).push(p);
  }
  const accounts = [...byAccount.entries()].map(([account_id, rows]) => ({
    account_id,
    account_name: rows[0].account_name,
    ...summariseIncome(rows, from, to, mv(rows)),
  })).sort((a, b) => a.account_name.localeCompare(b.account_name));

  return {
    ...summariseIncome(all, from, to, mv(all)),
    dividends_as_of: asof.dividends_as_of,
    // Days between the oldest held load and the window start (the page warns past 35).
    dividends_age_days: asof.dividends_as_of
      ? Math.round((Date.parse(from) - Date.parse(asof.dividends_as_of)) / 86400000) : null,
    accounts,
    budget: year ? budgetYear(positions, year, { today: from, reinvestRate }) : null,
  };
}

module.exports = {
  buildIncome, summariseIncome, bondIncome, couponDates, addMonths, faceOf, absenceGroup,
  monthlyRows, mergeBySecurity, budgetYear, roundMonths,
  PERIODS_PER_YEAR, PAR_PER_UNIT,
};
