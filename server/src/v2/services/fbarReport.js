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
 * A line that HAS a figure but should not be read as settled. Distinct from
 * `needs_figure` on purpose: a warned line still converts, still sums into the
 * aggregate and can still be filed. What it must not do is sit among the
 * computed rows looking like every other one.
 */
const WARN = {
  UNVERIFIED_CARRY_IN: 'unverified_carry_in',
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

  // ── review_state resolves PER YEAR (CR082 §7, migration 071) ──
  //
  // The standing column is the answer for every year that has no override. The
  // override exists because excluding an account opened in 2026 used to remove
  // it from TY2026 as well as TY2025, and the workaround was a capitalised note
  // asking a future reader to put it back.
  const { rows: designations } = await client.query(
    `SELECT tfa.*, a.name AS account_name, a.currency AS account_currency,
            COALESCE(ys.review_state, tfa.review_state) AS effective_review_state,
            ys.review_state AS year_review_state,
            ys.note          AS year_review_note
       FROM tax_foreign_accounts tfa
       LEFT JOIN accounts a ON a.id = tfa.account_id
       LEFT JOIN tax_foreign_account_year_states ys
              ON ys.tax_foreign_account_id = tfa.id AND ys.tax_year = $1
      WHERE COALESCE(ys.review_state, tfa.review_state) <> 'excluded'
      ORDER BY tfa.fbar_part NULLS LAST, tfa.institution_name, tfa.label`,
    [taxYear]
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
      review_state: d.effective_review_state,
      // Non-null when THIS year departs from the standing answer, so the page
      // can say which of the two it is showing rather than making them
      // indistinguishable — the failure the standing-only column was.
      year_review_state: d.year_review_state,
      year_review_note: d.year_review_note,
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
      warning: null,
      warning_detail: null,
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
    } else if (line.max_unknown) {
      // Form 114 item 15a. "The maximum value is unknown" is an ANSWER the form
      // provides for, not an outstanding task — it is the honest response when no
      // statement can be obtained, and it is better than a guess that reads as a
      // measurement. So it carries no figure, contributes nothing to the
      // aggregate (which stays a floor), and must NOT sit in `needs_attention`:
      // doing so made a year containing one impossible to freeze without `force`,
      // which would have meant the only way to file a legitimately-unknown
      // maximum was to override the guard protecting every other line.
      line.source = 'unknown_15a';
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
        // §12b.14 — the whole figure came from before the year, and the year
        // holds no rows to corroborate it. Either the account was genuinely
        // dormant all year, or it did not exist yet and a later calibration plug
        // is being projected backwards. The ledger cannot say which.
        if (f.carry_in_only) {
          line.warning = WARN.UNVERIFIED_CARRY_IN;
          line.warning_detail =
            `no ${taxYear} transactions — the figure is the carry-in from `
            + `${taxYear - 1}, which is also what an account opened AFTER ${taxYear} `
            + `reports. Confirm against a statement, or exclude the line for this year.`;
        }
      }
    } else {
      line.needs_figure = NEEDS.NO_LEDGER;
    }

    // 2. Convert. A missing rate is a refusal, never a guess.
    if (line.needs_figure === null && line.max_native !== null) {
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
  // A 15a line still has no figure, so the aggregate is still a FLOOR — the
  // verdict must not read as complete. What it no longer is, is an outstanding
  // task blocking the filing.
  const isFloor = missing.length > 0;
  const outstanding = missing.filter((l) => !l.max_unknown);

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
    needs_attention: outstanding.map((l) => ({
      designation_id: l.designation_id, label: l.label,
      reason: l.needs_figure, detail: l.detail,
    })),
    // Answered "unknown" under item 15a — reported separately so the export can
    // print them as such and the count is visible, rather than being silently
    // absent from both lists.
    unknown_15a: missing.filter((l) => l.max_unknown).map((l) => ({
      designation_id: l.designation_id, label: l.label,
    })),
    // Kept SEPARATE from needs_attention. Those lines have no figure and block
    // the verdict; these have one and do not. Folding them together would
    // either make a warned line un-fileable or make a missing one look
    // advisory, and both are worse than two lists.
    warnings: lines.filter((l) => l.warning).map((l) => ({
      designation_id: l.designation_id, label: l.label,
      warning: l.warning, detail: l.warning_detail,
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
 * Open an amendment: a NEW filing for the same year, `draft`, at the next
 * `amendment_seq`. The filed rows are untouched and stay readable beside it —
 * `(tax_year, amendment_seq)` rather than `tax_year UNIQUE` exists for exactly
 * this (§6).
 *
 * There is deliberately no "reopen" that flips a filed row back to draft. What
 * was sent to FinCEN was sent; a correction is a second filing, which is also
 * what an amended FBAR actually is. Un-filing would make the frozen figures
 * editable again and destroy the only record of what was filed — the thing the
 * freeze exists to prevent.
 */
async function amendYear(client, taxYear) {
  const { rows } = await client.query(
    `SELECT id, amendment_seq, status FROM tax_fbar_filings
      WHERE tax_year = $1 ORDER BY amendment_seq DESC LIMIT 1`,
    [taxYear]
  );
  if (!rows.length) {
    throw new Error(`${taxYear} has no filing to amend`);
  }
  if (rows[0].status !== 'filed') {
    throw new Error(
      `${taxYear} is already a draft (amendment ${rows[0].amendment_seq}) — edit it rather than amending`
    );
  }
  const ins = await client.query(
    `INSERT INTO tax_fbar_filings (tax_year, amendment_seq, status)
     VALUES ($1, $2, 'draft') RETURNING id, amendment_seq`,
    [taxYear, rows[0].amendment_seq + 1]
  );
  return { filing_id: ins.rows[0].id, amendment_seq: ins.rows[0].amendment_seq };
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

  const rows = filed.map((f) => {
    const cur = f.tax_foreign_account_id ? byId.get(f.tax_foreign_account_id) : null;
    const filedNative = f.max_value_native === null ? null : Number(f.max_value_native);
    const nowNative = cur?.max_native ?? null;
    return {
      label: f.label,
      currency: f.currency,
      // ── "Equal" and "never compared" are not the same answer ──
      // A filed line whose designation was deleted, or which never had one — a
      // historical return transcribed from paper stands alone by design
      // (migration 070: "the line must stand alone") — has nothing to compare
      // against. Reporting a null delta for it made it indistinguishable from a
      // figure that still reconciles, so a filing where NOTHING could be checked
      // read as a filing where nothing had moved. That is the "looks like an
      // answer" shape this whole feature is written against.
      comparable: !!cur,
      filed_native: filedNative,
      recomputed_native: nowNative,
      delta_native: filedNative !== null && nowNative !== null
        ? Math.round((nowNative - filedNative) * 100) / 100 : null,
      filed_usd: f.max_value_usd === null ? null : Number(f.max_value_usd),
      recomputed_usd: cur?.max_usd ?? null,
    };
  });

  return {
    tax_year: taxYear,
    filed: true,
    rows,
    comparable_count: rows.filter((r) => r.comparable).length,
    moved_count: rows.filter((r) => r.comparable && r.delta_native).length,
  };
}

module.exports = {
  buildYear, freezeYear, amendYear, filedVsRecomputed, ensureDraft, NEEDS, WARN,
};
