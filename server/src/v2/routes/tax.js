'use strict';
/**
 * tax.js — CR082. The Taxes section's API, mounted at /api/v2/tax.
 *
 * Every success response is `{ data: … }` (CR043 N8 — the bare/enveloped split
 * is what broke the Modify Transfer modal silently, and `check-api-envelope.sh`
 * only ratchets down).
 *
 * ── Account numbers ──
 * The list endpoint returns them MASKED. Full numbers come only from the
 * single-designation reveal, which the edit form calls when opened. That is not
 * a security boundary — this app has no auth, and CR082 §7.1 says so plainly —
 * it is blast-radius: the bulk payload that every page load fetches should not
 * carry 15 IBANs, because `/util/coa-traits` already taught us that a bulk dump
 * is the thing that leaks. The real control is the network binding (P0b).
 */

const express = require('express');
const router = express.Router();
const db = require('../db');
const { buildYear, freezeYear, filedVsRecomputed } = require('../../v2/services/fbarReport');

/** `PL61 1090 …3000` → `PL61 …3000`. Never reversible, never logged. */
function maskNumber(n) {
  if (!n) return null;
  const s = String(n).replace(/\s+/g, '');
  if (s.length <= 8) return `…${s.slice(-2)}`;
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

const DESIGNATION_FIELDS = [
  'label', 'review_state', 'fbar_part', 'account_kind', 'account_kind_other',
  'own_account_number', 'own_currency', 'institution_name', 'institution_street',
  'institution_city', 'institution_region', 'institution_postal', 'institution_country',
  'joint_owner_name', 'joint_owner_tin', 'joint_owner_address', 'notes', 'account_id',
];

// GET /api/v2/tax/designations — masked list
router.get('/designations', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT tfa.*, a.name AS account_name, a.currency AS account_currency,
              a.account_number AS ledger_account_number
         FROM tax_foreign_accounts tfa
         LEFT JOIN accounts a ON a.id = tfa.account_id
        ORDER BY tfa.fbar_part NULLS LAST, tfa.institution_name, tfa.label`
    );
    res.json({
      data: rows.map((r) => {
        const full = r.own_account_number || r.ledger_account_number;
        const { own_account_number, ledger_account_number, ...rest } = r;
        return { ...rest, account_number_masked: maskNumber(full), has_account_number: !!full };
      }),
    });
  } catch (e) { next(e); }
});

// GET /api/v2/tax/designations/:id/number — the explicit reveal
router.get('/designations/:id/number', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT tfa.own_account_number, a.account_number
         FROM tax_foreign_accounts tfa
         LEFT JOIN accounts a ON a.id = tfa.account_id
        WHERE tfa.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'designation not found' });
    res.json({ data: { account_number: rows[0].own_account_number || rows[0].account_number || '' } });
  } catch (e) { next(e); }
});

// GET /api/v2/tax/unlinked-candidates — fin accounts this designation could be
router.get('/unlinked-candidates', async (req, res, next) => {
  try {
    const { currency, taxYear, institution } = req.query;
    if (!currency) return res.status(400).json({ error: 'currency is required' });
    const year = Number(taxYear) || new Date().getFullYear() - 1;

    // Every unlinked account in the currency is returned — nothing is filtered
    // out. Filtering would need a rule for what counts as "a financial account",
    // and any such rule is hardcoded chart names that rot: reorganise the COA and
    // a legitimate candidate silently disappears.
    //
    // Instead each candidate carries its PARENT (the owner's own COA grouping),
    // which is the honest discriminator. `Santandar` sits under `PLN Bank
    // Accounts`; `PL - Niemena` under `PL - Properties`; `United Beverages` under
    // `PL Investments`. That distinction is obvious on sight and needs no logic.
    //
    // Name similarity alone does NOT solve this, which is why it is only a tie-
    // break: the case that exposed the problem is a designation reading "Erste"
    // (formerly Bank Zachodni WBK) whose fin account is called `Santandar` —
    // three names for one bank, zero token overlap between any of them.
    const { rows } = await db.query(
      `SELECT a.id, a.name, a.currency, p.name AS parent_name
         FROM accounts a
         LEFT JOIN accounts p ON p.id = a.parent_id
        WHERE a.is_active AND a.currency = $1
          AND a.account_type IN ('asset','liability')
          AND NOT EXISTS (SELECT 1 FROM accounts c WHERE c.parent_id = a.id)
          AND NOT EXISTS (SELECT 1 FROM tax_foreign_accounts t WHERE t.account_id = a.id)
        ORDER BY p.name NULLS LAST, a.name`,
      [currency]
    );

    // Each candidate carries its computed maximum, so the choice is made against
    // real figures rather than names — the three PKO PLN accounts are
    // indistinguishable by name and differ by over a million dollars.
    const { accountYearFigures } = require('../../v2/services/fbarMaxValue');
    const tokens = String(institution || '')
      .toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2);
    // A SORT hint, never a filter — and the distinction is the whole point. If
    // this pattern is wrong the account still appears, one row lower; a filter
    // built on the same guess would make it vanish. Ordering alphabetically by
    // group is worse than useless here: `PL - Properties` sorts above `PLN Bank
    // Accounts`, so the one real candidate for an Erste row landed 7th of 8,
    // below two properties and four company holdings.
    const BANKISH = /bank|cash|checking|saving|deposit|current/i;
    const out = [];
    for (const a of rows) {
      const f = await accountYearFigures(db, a.id, year);
      const hay = `${a.name} ${a.parent_name || ''}`.toLowerCase();
      out.push({
        ...a,
        max_native: f.refused ? null : f.reportable_max_native,
        refused: !!f.refused,
        refusal: f.refusal_reason || null,
        name_match: tokens.some((t) => hay.includes(t)),
        group_bankish: BANKISH.test(a.parent_name || ''),
      });
    }
    out.sort((x, y) => (y.name_match - x.name_match)
      || (y.group_bankish - x.group_bankish)
      || String(x.parent_name || '').localeCompare(String(y.parent_name || ''))
      || x.name.localeCompare(y.name));
    res.json({ data: out });
  } catch (e) { next(e); }
});

// POST /api/v2/tax/designations
router.post('/designations', async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!body.label) return res.status(400).json({ error: 'label is required' });
    const cols = DESIGNATION_FIELDS.filter((f) => body[f] !== undefined);
    const vals = cols.map((c) => body[c] === '' ? null : body[c]);
    const { rows } = await db.query(
      `INSERT INTO tax_foreign_accounts (${cols.join(',')})
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`,
      vals
    );
    res.status(201).json({ data: { id: rows[0].id } });
  } catch (e) { next(e); }
});

// PATCH /api/v2/tax/designations/:id
router.patch('/designations/:id', async (req, res, next) => {
  try {
    const body = req.body || {};
    const cols = DESIGNATION_FIELDS.filter((f) => body[f] !== undefined);
    if (!cols.length) return res.status(400).json({ error: 'no updatable fields supplied' });
    const patch = Object.fromEntries(cols.map((c) => [c, body[c] === '' ? null : body[c]]));

    // account_id and own_currency are the two halves of source_ck:
    //   (account_id IS NULL) = (own_currency IS NOT NULL)
    // A caller sending only one half writes a state the table forbids, which is
    // what "violates check constraint tax_foreign_accounts_source_ck" meant when
    // linking a report-only row to a fin account. The pairing is this table's
    // invariant, so the server completes the move rather than making every
    // caller remember it.
    const { rows: cur } = await db.query(
      `SELECT tfa.account_id, tfa.own_currency, tfa.own_account_number,
              a.currency AS linked_currency
         FROM tax_foreign_accounts tfa
         LEFT JOIN accounts a ON a.id = tfa.account_id
        WHERE tfa.id = $1`,
      [req.params.id]
    );
    if (!cur.length) return res.status(404).json({ error: 'designation not found' });
    const before = cur[0];
    const nextAccountId = 'account_id' in patch ? patch.account_id : before.account_id;

    if (nextAccountId != null) {
      // Linked: the ledger owns the currency. own_account_number is KEPT — it is
      // often the only full IBAN we hold, and it already outranks the ledger's
      // number for display.
      patch.own_currency = null;
    } else {
      const ccy = ('own_currency' in patch ? patch.own_currency : null)
        || before.own_currency || before.linked_currency;
      if (!ccy) {
        return res.status(400).json({
          error: 'own_currency is required when a designation has no linked account — '
               + 'a typed maximum has no tax_fx_rates key without one',
        });
      }
      patch.own_currency = ccy;
      const num = 'own_account_number' in patch ? patch.own_account_number : before.own_account_number;
      if (!num) {
        return res.status(400).json({
          error: 'own_account_number is required when a designation has no linked account',
        });
      }
    }

    const finalCols = Object.keys(patch);
    const sets = finalCols.map((c, i) => `${c} = $${i + 2}`);
    const vals = finalCols.map((c) => patch[c]);
    const { rows } = await db.query(
      `UPDATE tax_foreign_accounts SET ${sets.join(', ')}, updated_at = NOW()
        WHERE id = $1 RETURNING id`,
      [req.params.id, ...vals]
    );
    if (!rows.length) return res.status(404).json({ error: 'designation not found' });
    res.json({ data: { id: rows[0].id } });
  } catch (e) { next(e); }
});

// DELETE /api/v2/tax/designations/:id
router.delete('/designations/:id', async (req, res, next) => {
  try {
    const { rowCount } = await db.query(`DELETE FROM tax_foreign_accounts WHERE id = $1`, [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'designation not found' });
    res.json({ data: { deleted: true } });
  } catch (e) { next(e); }
});

// GET/PUT /api/v2/tax/fx-rates/:year
router.get('/fx-rates/:year', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT currency, rate_to_usd, source, note FROM tax_fx_rates
        WHERE tax_year = $1 ORDER BY currency`,
      [req.params.year]
    );
    res.json({ data: rows.map((r) => ({ ...r, rate_to_usd: Number(r.rate_to_usd) })) });
  } catch (e) { next(e); }
});

router.put('/fx-rates/:year', async (req, res, next) => {
  try {
    const { currency, rate_to_usd, source, note } = req.body || {};
    if (!currency || !(Number(rate_to_usd) > 0)) {
      return res.status(400).json({ error: 'currency and a positive rate_to_usd are required' });
    }
    // The direction guard. Treasury publishes foreign-per-USD; this column is
    // USD-per-foreign. For EUR and GBP both readings are plausible numbers of
    // the same order, so a reciprocal typo is invisible — and it moves the
    // reported maximum ~38% toward UNDER-reporting. Compared against whatever
    // reference rate we hold; refused past 25% unless explicitly confirmed.
    const { rows: ref } = await db.query(
      `SELECT rate FROM exchange_rates
        WHERE from_currency = $1 AND to_currency = 'USD'
          AND rate_date = make_date($2::int, 12, 31)`,
      [currency, req.params.year]
    );
    if (ref.length && !req.body.confirm_outlier) {
      const refRate = Number(ref[0].rate);
      const entered = Number(rate_to_usd);
      // A reciprocal typo is not detectable by MAGNITUDE, which is how the first
      // version of this guard got it wrong: a ±25% band caught EUR at 1.175
      // (whose inverse, 0.851, sits 28% away) and would have sailed past EUR at
      // 1.10 (inverse 0.909, only 17% away). The band shrinks to nothing as a
      // rate approaches parity — precisely where the two directions are hardest
      // for a human to tell apart.
      //
      // The right question is not "is this far from the reference" but "is this
      // closer to the reference or to its INVERSE". Compared in log space, so
      // the test is symmetric: a rate and its reciprocal are equidistant from 1.
      const dDirect = Math.abs(Math.log(entered / refRate));
      const dInverse = Math.abs(Math.log(entered * refRate));
      const inverted = dInverse < dDirect;
      const wayOff = entered / refRate > 1.25 || entered / refRate < 0.8;
      if (inverted || wayOff) {
        return res.status(409).json({
          error: 'rate_direction_suspect',
          message: inverted
            ? `${entered} looks INVERTED: it is closer to 1/${refRate} than to our ${currency} ` +
              `reference of ${refRate}. This column is USD per 1 ${currency}; Treasury publishes ` +
              `${currency} per USD. You probably meant ${(1 / entered).toFixed(6)}. ` +
              `Resend with confirm_outlier=true to store as typed.`
            : `${entered} is ${(entered / refRate).toFixed(2)}x our ${currency} reference ` +
              `(${refRate}) — outside the plausible band. Resend with confirm_outlier=true ` +
              `to store as typed.`,
          reference_rate: refRate,
          reciprocal_of_entered: Number((1 / entered).toFixed(6)),
          suspected: inverted ? 'inverted' : 'out_of_band',
        });
      }
    }
    await db.query(
      `INSERT INTO tax_fx_rates (tax_year, currency, rate_to_usd, source, note)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (tax_year, currency) DO UPDATE
         SET rate_to_usd = EXCLUDED.rate_to_usd, source = EXCLUDED.source, note = EXCLUDED.note`,
      [req.params.year, currency, rate_to_usd, source || 'manual', note || null]
    );
    res.json({ data: { tax_year: Number(req.params.year), currency, rate_to_usd: Number(rate_to_usd) } });
  } catch (e) { next(e); }
});

// GET /api/v2/tax/fbar/:year — the report
router.get('/fbar/:year', async (req, res, next) => {
  try {
    res.json({ data: await buildYear(db, Number(req.params.year)) });
  } catch (e) { next(e); }
});

// PUT /api/v2/tax/fbar/:year/line/:designationId — typed figure / per-year flags
router.put('/fbar/:year/line/:designationId', async (req, res, next) => {
  try {
    const { manual_value_native, manual_reason, max_unknown, closed_during_year } = req.body || {};
    const { ensureDraft } = require('../../v2/services/fbarReport');
    const filing = await ensureDraft(db, Number(req.params.year));
    if (filing.status === 'filed') {
      return res.status(409).json({ error: 'year is filed — reopen or amend rather than editing' });
    }
    await db.query(
      `INSERT INTO tax_fbar_filing_lines
         (filing_id, tax_foreign_account_id, label, manual_value_native, manual_reason,
          max_unknown, closed_during_year)
       VALUES ($1, $2, COALESCE((SELECT label FROM tax_foreign_accounts WHERE id = $2), '?'),
               $3, $4, COALESCE($5, FALSE), COALESCE($6, FALSE))`,
      [filing.id, req.params.designationId,
       manual_value_native === '' || manual_value_native === undefined ? null : manual_value_native,
       manual_reason || null, max_unknown, closed_during_year]
    );
    res.json({ data: { ok: true } });
  } catch (e) { next(e); }
});

// POST /api/v2/tax/fbar/:year/freeze
router.post('/fbar/:year/freeze', async (req, res, next) => {
  try {
    const out = await freezeYear(db, Number(req.params.year), {
      filedOn: req.body?.filed_on || null,
      note: req.body?.note || null,
      force: req.body?.force === true,
    });
    res.json({ data: out });
  } catch (e) {
    if (/already filed|without a figure/.test(e.message)) {
      return res.status(409).json({ error: e.message });
    }
    next(e);
  }
});

// GET /api/v2/tax/fbar/:year/diff — filed vs recomputed
router.get('/fbar/:year/diff', async (req, res, next) => {
  try {
    res.json({ data: await filedVsRecomputed(db, Number(req.params.year)) });
  } catch (e) { next(e); }
});

module.exports = router;
