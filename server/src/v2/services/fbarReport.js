'use strict';
/**
 * fbarReport.js — CR082 P2. Assemble one tax year's FBAR working papers from the
 * designations (`tax_foreign_accounts`), the engine (`fbarMaxValue.js`) and the
 * rates (`tax_fx_rates`).
 *
 * The engine answers "what was this account's maximum". This answers "what goes
 * on the form", which is a different question with three extra failure modes:
 *
 *   - a designation with no fin account behind it (report-only: a company
 *     account under signature authority) has no computable maximum at all;
 *   - a currency with no rate for the year cannot be converted, and MUST NOT
 *     fall back to a rate nobody chose;
 *   - the $10,000 aggregate decides whether ANY of it is reportable, so an
 *     aggregate computed while rows are still missing figures is not a verdict.
 *     It is a floor, and it must say so.
 *
 * Every one of those resolves to `needs_figure` carrying a REASON, never to 0.
 * A zero on this report reads as "this account held nothing", which is a claim;
 * absence of a figure is not that claim.
 */

const { accountYearFigures, toUsdRoundedUp } = require('./fbarMaxValue');

const NEEDS = {
  NO_LEDGER: 'report_only_needs_typed_figure',
  NO_RATE: 'no_fx_rate_for_currency_year',
  ENGINE_REFUSED: 'engine_refused',
  NO_CURRENCY: 'no_currency_on_designation',
};

/**
 * @returns {Promise<object>} {
 *   tax_year, rates: [...], lines: [...],
 *   aggregate_usd,            sum of the lines that HAVE a figure
 *   aggregate_is_floor,       true when any line is missing one
 *   threshold_exceeded,       null when the aggregate is only a floor AND below 10k
 *   needs_attention: [...]
 * }
 */
async function buildYear(client, taxYear) {
  const { rows: rates } = await client.query(
    `SELECT currency, rate_to_usd, source, note FROM tax_fx_rates WHERE tax_year = $1`,
    [taxYear]
  );
  const rateFor = new Map(rates.map((r) => [r.currency.trim(), r]));

  const { rows: designations } = await client.query(
    `SELECT tfa.*, a.name AS account_name, a.currency AS account_currency
       FROM tax_foreign_accounts tfa
       LEFT JOIN accounts a ON a.id = tfa.account_id
      WHERE tfa.review_state <> 'excluded'
      ORDER BY tfa.fbar_part NULLS LAST, tfa.institution_name, tfa.label`,
    []
  );

  // Per-account-year overrides and flags live on the year's draft filing lines.
  const filing = await ensureDraft(client, taxYear);
  const { rows: overrides } = await client.query(
    `SELECT tax_foreign_account_id, manual_value_native, manual_reason,
            max_unknown, closed_during_year
       FROM tax_fbar_filing_lines WHERE filing_id = $1
      ORDER BY id`,          // last write wins, deterministically
    [filing.id]
  );
  const overrideFor = new Map(
    overrides.filter((o) => o.tax_foreign_account_id).map((o) => [o.tax_foreign_account_id, o])
  );

  const lines = [];
  for (const d of designations) {
    const ov = overrideFor.get(d.id) || {};
    const currency = (d.account_currency || d.own_currency || '').trim();
    const line = {
      designation_id: d.id,
      label: d.label,
      account_id: d.account_id,
      account_name: d.account_name,
      review_state: d.review_state,
      fbar_part: d.fbar_part,
      account_kind: d.account_kind,
      institution_name: d.institution_name,
      institution_country: d.institution_country,
      currency,
      closed_during_year: ov.closed_during_year === true,
      max_unknown: ov.max_unknown === true,
      source: null,
      max_native: null,
      year_end_native: null,
      max_on: null,
      rate_to_usd: null,
      rate_source: null,
      max_usd: null,
      needs_figure: null,
      detail: null,
    };

    // 1. Where does the native maximum come from?
    const typed = ov.manual_value_native === null || ov.manual_value_native === undefined
      ? null
      : Number(ov.manual_value_native);

    if (typed !== null) {
      line.source = 'typed';
      line.max_native = typed;
      line.detail = ov.manual_reason || null;
    } else if (d.account_id) {
      const f = await accountYearFigures(client, d.account_id, taxYear);
      if (f.refused) {
        line.needs_figure = NEEDS.ENGINE_REFUSED;
        line.detail = f.refusal_detail || f.refusal_reason;
      } else {
        line.source = 'computed';
        line.max_native = f.reportable_max_native;
        line.year_end_native = f.year_end_native;
        line.max_on = f.max_on;
        // Surfaced so a credit card reading 0 is legibly "never in credit"
        // rather than "we found nothing".
        if (f.max_native < 0) line.detail = `true maximum ${f.max_native}, reported 0`;
      }
    } else {
      line.needs_figure = NEEDS.NO_LEDGER;
    }

    // 2. Convert. A missing rate is a refusal, never a guess.
    if (line.needs_figure === null) {
      if (!currency) {
        line.needs_figure = NEEDS.NO_CURRENCY;
      } else {
        const r = rateFor.get(currency);
        if (!r) {
          line.needs_figure = NEEDS.NO_RATE;
          line.detail = `no ${currency} rate stored for ${taxYear}`;
        } else {
          line.rate_to_usd = Number(r.rate_to_usd);
          line.rate_source = r.source;
          line.max_usd = toUsdRoundedUp(line.max_native, line.rate_to_usd);
        }
      }
    }
    lines.push(line);
  }

  const withFigure = lines.filter((l) => l.max_usd !== null);
  const missing = lines.filter((l) => l.max_usd === null);
  const aggregate = withFigure.reduce((s, l) => s + l.max_usd, 0);
  const isFloor = missing.length > 0;

  return {
    tax_year: taxYear,
    filing_id: filing.id,
    filing_status: filing.status,
    rates: rates.map((r) => ({ ...r, rate_to_usd: Number(r.rate_to_usd) })),
    lines,
    aggregate_usd: aggregate,
    aggregate_is_floor: isFloor,
    // A verdict, or an honest refusal to give one. Over 10k the answer holds
    // however many figures are missing — more money cannot take it back under.
    // UNDER 10k with rows outstanding is NOT "no filing required"; that is the
    // "looks like an answer" failure one level up from a zeroed line.
    threshold_exceeded: aggregate > 10000 ? true : (isFloor ? null : false),
    needs_attention: missing.map((l) => ({
      designation_id: l.designation_id, label: l.label,
      reason: l.needs_figure, detail: l.detail,
    })),
  };
}

/** The draft is materialised on first view: per-account-YEAR data needs a home. */
async function ensureDraft(client, taxYear) {
  const { rows } = await client.query(
    `SELECT id, status FROM tax_fbar_filings
      WHERE tax_year = $1 ORDER BY amendment_seq DESC LIMIT 1`,
    [taxYear]
  );
  if (rows.length) return rows[0];
  const ins = await client.query(
    `INSERT INTO tax_fbar_filings (tax_year, status) VALUES ($1, 'draft')
     RETURNING id, status`,
    [taxYear]
  );
  return ins.rows[0];
}

/**
 * Freeze a year. Copies every figure onto the filing lines — label, account
 * number and institution COPIED, not joined — so a later rename, or a
 * `calibrate()` run rewriting `opening_balance` across all history, cannot
 * rewrite what was filed. See CR082 §6.
 *
 * Refuses a year that still has lines needing a figure: a filing frozen with
 * holes in it records a number nobody stands behind.
 */
async function freezeYear(client, taxYear, { filedOn = null, note = null, force = false } = {}) {
  const report = await buildYear(client, taxYear);
  if (report.filing_status === 'filed') {
    throw new Error(`${taxYear} is already filed — amend by creating the next amendment_seq`);
  }
  if (report.needs_attention.length && !force) {
    throw new Error(
      `${taxYear} has ${report.needs_attention.length} line(s) without a figure: ` +
      report.needs_attention.map((n) => n.label).join(', ')
    );
  }

  await client.query(`DELETE FROM tax_fbar_filing_lines WHERE filing_id = $1`, [report.filing_id]);
  for (const l of report.lines) {
    const { rows: d } = await client.query(
      `SELECT tfa.own_account_number, a.account_number
         FROM tax_foreign_accounts tfa
         LEFT JOIN accounts a ON a.id = tfa.account_id
        WHERE tfa.id = $1`,
      [l.designation_id]
    );
    const number = d[0]?.own_account_number || d[0]?.account_number || null;
    await client.query(
      `INSERT INTO tax_fbar_filing_lines
         (filing_id, tax_foreign_account_id, label, account_number, institution_name,
          institution_country, fbar_part, account_kind, currency, max_value_native,
          year_end_native, fx_rate_used, fx_rate_source, max_value_usd,
          max_unknown, closed_during_year, manual_value_native, manual_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [report.filing_id, l.designation_id, l.label, number, l.institution_name,
       l.institution_country, l.fbar_part, l.account_kind, l.currency, l.max_native,
       l.year_end_native, l.rate_to_usd, l.rate_source, l.max_usd,
       l.max_unknown, l.closed_during_year,
       l.source === 'typed' ? l.max_native : null, l.source === 'typed' ? l.detail : null]
    );
  }
  await client.query(
    `UPDATE tax_fbar_filings SET status = 'filed', filed_on = COALESCE($2::date, CURRENT_DATE),
            filed_note = $3 WHERE id = $1`,
    [report.filing_id, filedOn, note]
  );
  return { filing_id: report.filing_id, lines: report.lines.length };
}

/**
 * What was filed, beside what the same year computes today. The point of the
 * freeze: `calibrate()` moves history with no audit row, so these diverge for
 * reasons that are invisible in the ledger. Shows WHAT changed; it cannot show
 * WHY, and does not pretend to.
 */
async function filedVsRecomputed(client, taxYear) {
  const { rows: filings } = await client.query(
    `SELECT id FROM tax_fbar_filings WHERE tax_year = $1 AND status = 'filed'
      ORDER BY amendment_seq DESC LIMIT 1`,
    [taxYear]
  );
  if (!filings.length) return { tax_year: taxYear, filed: false, rows: [] };

  const { rows: filed } = await client.query(
    `SELECT tax_foreign_account_id, label, currency, max_value_native, max_value_usd
       FROM tax_fbar_filing_lines WHERE filing_id = $1`,
    [filings[0].id]
  );
  const now = await buildYear(client, taxYear);
  const byId = new Map(now.lines.map((l) => [l.designation_id, l]));

  return {
    tax_year: taxYear,
    filed: true,
    rows: filed.map((f) => {
      const cur = byId.get(f.tax_foreign_account_id);
      const filedNative = f.max_value_native === null ? null : Number(f.max_value_native);
      const nowNative = cur?.max_native ?? null;
      return {
        label: f.label,
        currency: f.currency,
        filed_native: filedNative,
        recomputed_native: nowNative,
        delta_native: filedNative !== null && nowNative !== null
          ? Math.round((nowNative - filedNative) * 100) / 100 : null,
        filed_usd: f.max_value_usd === null ? null : Number(f.max_value_usd),
        recomputed_usd: cur?.max_usd ?? null,
      };
    }),
  };
}

module.exports = { buildYear, freezeYear, filedVsRecomputed, ensureDraft, NEEDS };
