'use strict';
/**
 * tax.routes.test.js — CR082 P1/P2: the report assembler and the Taxes API.
 *
 * DB-backed (skip with SKIP_DB_TESTS=1). Seeds its own accounts, designations,
 * rates and filings, all prefixed `TestTax`, and cleans up by prefix.
 *
 * The suite is organised around what can produce a WRONG NUMBER THAT LOOKS
 * RIGHT, because every one of this feature's real defects has had that shape:
 *
 *   - a missing figure rendered as 0 (a zero claims the account held nothing);
 *   - a "no filing required" verdict computed from a partial set;
 *   - an FX rate pasted in Treasury's direction instead of ours, which moves the
 *     answer ~38% with nothing to flag it;
 *   - a filed year that silently moves when calibrate() rewrites history;
 *   - and the one that actually shipped: an upsert key that MERGED two
 *     reportable accounts, leaving a page that looked entirely correct.
 */

const db = require('../../db');
const { makeApp, request } = require('./_httpApp');
const taxRouter = require('../tax');
const { buildYear, freezeYear, filedVsRecomputed } = require('../../services/fbarReport');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;
const app = makeApp('/tax', taxRouter);
const PREFIX = 'TestTax';
const YEAR = 2019; // far from any real data in dev

dbDescribe('CR082 — Taxes API and report assembly (DB)', () => {
  let acctId;

  async function cleanup() {
    await db.query(
      `DELETE FROM tax_fbar_filing_lines WHERE filing_id IN
         (SELECT id FROM tax_fbar_filings WHERE tax_year = $1)`, [YEAR]);
    await db.query(`DELETE FROM tax_fbar_filings WHERE tax_year = $1`, [YEAR]);
    await db.query(`DELETE FROM tax_foreign_accounts WHERE label LIKE $1`, [`${PREFIX}%`]);
    await db.query(`DELETE FROM tax_fx_rates WHERE tax_year = $1`, [YEAR]);
    await db.query(
      `DELETE FROM transactions WHERE account_id IN
         (SELECT id FROM accounts WHERE name LIKE $1)`, [`${PREFIX}%`]);
    await db.query(`DELETE FROM accounts WHERE name LIKE $1`, [`${PREFIX}%`]);
    await db.query(`DELETE FROM exchange_rates WHERE source = 'test-fixture'`);
  }

  // buildYear() reads EVERY non-excluded designation, and dev carries 31 real
  // ones from the seeder — so the aggregate and freeze assertions below would be
  // measuring the owner's actual FBAR, not this fixture. That is the ambient-data
  // class Scripts/test-fresh-db.sh exists for, and it is what made the first run
  // of this suite fail. Park the real rows for the duration; restore as found.
  let parked = [];
  async function parkRealDesignations() {
    const { rows } = await db.query(
      `SELECT id, review_state FROM tax_foreign_accounts WHERE label NOT LIKE $1`, [`${PREFIX}%`]);
    parked = rows;
    await db.query(
      `UPDATE tax_foreign_accounts SET review_state='excluded' WHERE label NOT LIKE $1`, [`${PREFIX}%`]);
  }
  async function unparkRealDesignations() {
    for (const r of parked) {
      await db.query(`UPDATE tax_foreign_accounts SET review_state = $2 WHERE id = $1`,
        [r.id, r.review_state]);
    }
    parked = [];
  }

  beforeAll(async () => {
    await cleanup();
    await parkRealDesignations();
    const { rows } = await db.query(
      `INSERT INTO accounts (name, account_type, section, currency, opening_balance,
                             opening_balance_date, is_active, account_number)
       VALUES ($1,'asset','balance_sheet','PLN',0,'1990-01-01',TRUE,'PL99 1234 5678')
       RETURNING id`, [`${PREFIX}_Bank`]);
    acctId = rows[0].id;
    await db.query(
      `INSERT INTO transactions (transaction_date, description1, amount, currency, account_id, source)
       VALUES (make_date($1,6,1),'fixture',100000,'PLN',$2,'test')`, [YEAR, acctId]);
    await db.query(
      `INSERT INTO tax_fx_rates (tax_year, currency, rate_to_usd, source)
       VALUES ($1,'PLN',0.25,'treasury')`, [YEAR]);
  });

  afterAll(async () => { await cleanup(); await unparkRealDesignations(); await db.close(); });

  // account_id is UNIQUE on tax_foreign_accounts — one designation per ledger
  // account — so any test that links needs an account of its own.
  async function mkAccount(suffix) {
    const { rows } = await db.query(
      `INSERT INTO accounts (name, account_type, section, currency, opening_balance,
                             opening_balance_date, is_active)
       VALUES ($1,'asset','balance_sheet','PLN',0,'1990-01-01',TRUE) RETURNING id`,
      [`${PREFIX}_${suffix}`]);
    return rows[0].id;
  }

  async function mkDesignation(label, extra = {}) {
    const body = {
      label: `${PREFIX}_${label}`, fbar_part: 'III', account_kind: 'bank',
      institution_name: 'Test Bank', institution_country: 'PL', ...extra,
    };
    if (!body.account_id) { body.own_currency = body.own_currency || 'PLN'; body.own_account_number = 'MASKED'; }
    const r = await request(app, 'POST', '/tax/designations', body);
    expect(r.status).toBe(201);
    return r.body.data.id;
  }

  describe('designations', () => {
    test('the list masks account numbers; the reveal endpoint returns them in full', async () => {
      const id = await mkDesignation('Linked', { account_id: acctId });
      const list = await request(app, 'GET', '/tax/designations');
      expect(list.status).toBe(200);
      const row = list.body.data.find((r) => r.id === id);

      // The bulk payload every page load fetches must not carry the number:
      // /util/coa-traits is the standing lesson that a bulk dump is what leaks.
      expect(row.account_number_masked).toBe('PL99…5678');
      expect(JSON.stringify(list.body)).not.toContain('PL99 1234 5678');
      expect(row.has_account_number).toBe(true);

      const reveal = await request(app, 'GET', `/tax/designations/${id}/number`);
      expect(reveal.body.data.account_number).toBe('PL99 1234 5678');
    });

    test('a report-only line and a linked line cannot be the same row', async () => {
      // The schema CHECK pairs own_currency with a NULL account_id. Sending both
      // is a caller error and must fail loudly, not store a half-state.
      const r = await request(app, 'POST', '/tax/designations', {
        label: `${PREFIX}_Both`, account_id: acctId, own_currency: 'PLN', own_account_number: 'X',
      });
      expect(r.status).toBeGreaterThanOrEqual(400);
    });

    // The bug this suite missed: POST enforced the pairing, PATCH did not. Every
    // test above created designations already in their final shape, so nothing
    // ever MOVED a row between the two states — and the UI's whole purpose is
    // moving them. Linking a report-only row from the picker answered 500 with
    // the raw constraint name.
    test('linking a report-only row clears own_currency instead of violating source_ck', async () => {
      const linkTo = await mkAccount('LinkTarget');
      const id = await mkDesignation('ToLink');            // report-only: own_currency = PLN
      const r = await request(app, 'PATCH', `/tax/designations/${id}`, { account_id: linkTo });
      expect(r.status).toBe(200);

      const { rows } = await db.query(
        `SELECT account_id, own_currency, own_account_number
           FROM tax_foreign_accounts WHERE id = $1`, [id]);
      expect(rows[0].account_id).toBe(linkTo);
      expect(rows[0].own_currency).toBeNull();
      // KEPT: often the only full IBAN held, and it outranks the ledger number
      // for display, so clearing it would lose the better datum.
      expect(rows[0].own_account_number).toBe('MASKED');
    });

    test('unlinking restores a currency from the account it was linked to', async () => {
      const id = await mkDesignation('ToUnlink', { account_id: await mkAccount('UnlinkFrom') });
      const r = await request(app, 'PATCH', `/tax/designations/${id}`,
        { account_id: null, own_account_number: 'X123' });
      expect(r.status).toBe(200);
      const { rows } = await db.query(
        `SELECT account_id, own_currency FROM tax_foreign_accounts WHERE id = $1`, [id]);
      expect(rows[0].account_id).toBeNull();
      // Inherited from the ledger account rather than left NULL, which would be
      // a row with a typed maximum and no tax_fx_rates key to convert it.
      expect(rows[0].own_currency).toBe('PLN');
    });

    test('unlinking with no number to fall back on is refused, not half-written', async () => {
      const bare = await mkAccount('NoNumberAcct');
      const id = await mkDesignation('NoNumber', { account_id: bare });
      const r = await request(app, 'PATCH', `/tax/designations/${id}`, { account_id: null });
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/own_account_number/);
      const { rows } = await db.query(
        `SELECT account_id FROM tax_foreign_accounts WHERE id = $1`, [id]);
      expect(rows[0].account_id).toBe(bare);   // unchanged
    });

    test('a state change still patches cleanly and does not disturb the pairing', async () => {
      const id = await mkDesignation('StateOnly');
      const r = await request(app, 'PATCH', `/tax/designations/${id}`,
        { review_state: 'excluded' });
      expect(r.status).toBe(200);
      const { rows } = await db.query(
        `SELECT review_state, account_id, own_currency
           FROM tax_foreign_accounts WHERE id = $1`, [id]);
      expect(rows[0].review_state).toBe('excluded');
      expect(rows[0].account_id).toBeNull();
      expect(rows[0].own_currency).toBe('PLN');
    });
  });

  describe('typed figures', () => {
    // There is no unique key on (filing_id, tax_foreign_account_id), so the PUT
    // used to INSERT a second override row on every edit — and buildYear folds
    // them into a Map from a query with no ORDER BY, so which one won was
    // whatever Postgres returned last. Correcting a figure and getting the old
    // one back is the arbitrary-tie-break shape from §12.1, in the one place
    // where the number is entered by hand and nothing recomputes it.
    test('editing a typed figure REPLACES it rather than stacking a second override', async () => {
      const id = await mkDesignation('Typed');
      const put = (v) => request(app, 'PUT', `/tax/fbar/${YEAR}/line/${id}`,
        { manual_value_native: v, manual_reason: `set to ${v}` });

      expect((await put(1000)).status).toBe(200);
      expect((await put(2500)).status).toBe(200);

      const { rows } = await db.query(
        `SELECT l.manual_value_native FROM tax_fbar_filing_lines l
           JOIN tax_fbar_filings f ON f.id = l.filing_id
          WHERE f.tax_year = $1 AND l.tax_foreign_account_id = $2`, [YEAR, id]);
      expect(rows).toHaveLength(1);
      expect(Number(rows[0].manual_value_native)).toBe(2500);

      const report = await buildYear(db, YEAR);
      const line = report.lines.find((l) => l.designation_id === id);
      expect(line.source).toBe('typed');
      expect(Number(line.max_native)).toBe(2500);
    });

    test('clearing a typed figure returns the line to NEEDS FIGURE, not to zero', async () => {
      const id = await mkDesignation('Cleared');
      await request(app, 'PUT', `/tax/fbar/${YEAR}/line/${id}`, { manual_value_native: 500 });
      await request(app, 'PUT', `/tax/fbar/${YEAR}/line/${id}`, { manual_value_native: '' });

      const report = await buildYear(db, YEAR);
      const line = report.lines.find((l) => l.designation_id === id);
      // A zero would claim the account held nothing all year. An empty box is
      // the absence of a claim, and the two must not collapse into each other.
      expect(line.max_usd).toBeNull();
      expect(line.max_native).toBeNull();
      expect(line.needs_figure).toBeTruthy();
    });

    test('15a — an unknown maximum is recorded as unknown, and carries no amount', async () => {
      const id = await mkDesignation('Unknown15a');
      const r = await request(app, 'PUT', `/tax/fbar/${YEAR}/line/${id}`,
        { max_unknown: true, manual_value_native: null });
      expect(r.status).toBe(200);

      const report = await buildYear(db, YEAR);
      const line = report.lines.find((l) => l.designation_id === id);
      expect(line.max_unknown).toBe(true);
      expect(line.max_usd).toBeNull();

      // 15a is an ANSWER the form provides for, not an outstanding task. It used
      // to sit in `needs_attention`, which made a year containing one impossible
      // to freeze without `force` — i.e. the only way to file a legitimately
      // unknown maximum was to override the guard protecting every other line.
      expect(report.needs_attention.map((n) => n.designation_id)).not.toContain(id);
      expect(report.unknown_15a.map((n) => n.designation_id)).toContain(id);
      // It still has no figure, so the aggregate is still a floor.
      expect(report.aggregate_is_floor).toBe(true);

      await request(app, 'DELETE', `/tax/designations/${id}`);
    });
  });

  // ── Part I (§3, §7.1) ──
  // The TIN and DOB get the same treatment as an account number, and the
  // interesting assertions are about where they must NOT appear.
  describe('the filer block', () => {
    const psdata = require('../../repositories').psdata;
    let priorFiler;

    beforeAll(async () => {
      priorFiler = await psdata.getAppData('tax_filer');
    });
    afterAll(async () => {
      if (priorFiler) await psdata.setAppData('tax_filer', priorFiler);
      else await db.query(`DELETE FROM app_data WHERE key = 'tax_filer'`);
    });

    test('stores the block, and serves it MASKED', async () => {
      const put = await request(app, 'PUT', '/tax/filer', {
        name_last: 'Testerson', name_first: 'Chris', tin_type: 'SSN',
        tin: '123-45-6789', dob: '1970-03-14',
        address_city: 'Warsaw', address_country: 'PL',
      });
      expect(put.status).toBe(200);

      const got = await request(app, 'GET', '/tax/filer');
      expect(got.status).toBe(200);
      expect(got.body.data.name_last).toBe('Testerson');
      // The two that matter: recognisable, not reconstructable.
      expect(got.body.data.tin_masked).toBe('•••-••-6789');
      expect(got.body.data.dob_masked).toBe('1970-••-••');
      expect(got.body.data.has_tin).toBe(true);
      expect(JSON.stringify(got.body)).not.toContain('123-45-6789');
      expect(JSON.stringify(got.body)).not.toContain('1970-03-14');
    });

    test('the reveal returns them in full, and nothing else', async () => {
      const r = await request(app, 'GET', '/tax/filer/reveal');
      expect(r.status).toBe(200);
      expect(r.body.data.tin).toBe('123-45-6789');
      expect(r.body.data.dob).toBe('1970-03-14');
      expect(Object.keys(r.body.data).sort()).toEqual(['dob', 'tin']);
    });

    test('an omitted TIN leaves the stored one alone; an empty string clears it', async () => {
      // The COA account-number shape P0a had to unpick: a form that could not
      // read the value must not be able to save a blank over it.
      await request(app, 'PUT', '/tax/filer', { name_last: 'Renamed' });
      let r = await request(app, 'GET', '/tax/filer/reveal');
      expect(r.body.data.tin).toBe('123-45-6789');

      await request(app, 'PUT', '/tax/filer', { tin: '' });
      r = await request(app, 'GET', '/tax/filer/reveal');
      expect(r.body.data.tin).toBe('');

      await request(app, 'PUT', '/tax/filer', { tin: '123-45-6789' });
    });

    // The gate this whole CR keeps having to relearn: the bulk payload is what
    // leaks. `GET /util/appdata` merges the entire app_data TABLE into its
    // response, so without an explicit exclusion the TIN would be served on
    // every page load that touches appdata — /util/coa-traits, one table over.
    test('GET /util/appdata does NOT serve the filer block', async () => {
      const utilRouter = require('../util');
      const utilApp = makeApp('/util', utilRouter);
      const r = await request(utilApp, 'GET', '/util/appdata');
      expect(r.status).toBe(200);
      const body = JSON.stringify(r.body);
      expect(body).not.toContain('123-45-6789');
      expect(body).not.toContain('tax_filer');
      expect(body).not.toContain('Testerson');
    });

    test('POST /util/appdata REFUSES the key — that handler writes to a file', async () => {
      const utilRouter = require('../util');
      const utilApp = makeApp('/util', utilRouter);
      const r = await request(utilApp, 'POST', '/util/appdata', {
        updates: [{ key: 'tax_filer', value: { tin: '999-99-9999' } }],
      });
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/not writable here/);
    });
  });

  describe('the FX direction guard', () => {
    test('refuses a rate pasted in Treasury’s direction, and returns the reciprocal', async () => {
      // Treasury publishes foreign-per-USD; this column is USD-per-foreign. For
      // EUR/GBP both are plausible numbers of the same order, so the typo is
      // invisible and costs ~38% toward under-reporting.
      // Near parity a reciprocal sits only ~17% from the true rate, so a ±25%
      // magnitude band cannot see it. This is the case the first guard missed.
      // SEEDED, not borrowed. This read dev's own FX series first — which goes
      // back to 1999 and made the test pass locally while dying on a from-scratch
      // database, where ci-seed.sql creates no exchange_rates at all. Same
      // ambient-data class this file's header is about, committed inside it.
      const trueRate = 1.12;
      await db.query(
        `INSERT INTO exchange_rates (from_currency,to_currency,rate,rate_date,source)
         VALUES ('EUR','USD',$2,make_date($1,12,31),'test-fixture')
         ON CONFLICT (from_currency,to_currency,rate_date)
           DO UPDATE SET rate = EXCLUDED.rate, source = 'test-fixture'`,
        [YEAR, trueRate]);
      const inverted = Number((1 / trueRate).toFixed(6));
      expect(Math.abs(inverted / trueRate - 1)).toBeLessThan(0.25);  // inside the OLD band

      const r = await request(app, 'PUT', `/tax/fx-rates/${YEAR}`,
        { currency: 'EUR', rate_to_usd: inverted, source: 'treasury' });
      expect(r.status).toBe(409);
      expect(r.body.error).toBe('rate_direction_suspect');
      expect(r.body.suspected).toBe('inverted');
      expect(r.body.reciprocal_of_entered).toBeCloseTo(trueRate, 2);
    });

    test('accepts the correct direction, and stores it', async () => {
      const r = await request(app, 'PUT', `/tax/fx-rates/${YEAR}`,
        { currency: 'GBP', rate_to_usd: 1.27, source: 'treasury' });
      expect(r.status).toBe(200);
      const got = await request(app, 'GET', `/tax/fx-rates/${YEAR}`);
      expect(got.body.data.find((x) => x.currency.trim() === 'GBP').rate_to_usd).toBe(1.27);
    });

    test('a non-positive rate is refused', async () => {
      const r = await request(app, 'PUT', `/tax/fx-rates/${YEAR}`, { currency: 'PLN', rate_to_usd: 0 });
      expect(r.status).toBe(400);
    });
  });

  describe('the assembled report', () => {
    test('a linked account is computed; a report-only line is NEVER zero', async () => {
      const rep = await buildYear(db, YEAR);
      const linked = rep.lines.find((l) => l.label === `${PREFIX}_Linked`);
      expect(linked.source).toBe('computed');
      expect(linked.max_native).toBe(100000);
      expect(linked.max_usd).toBe(25000); // 100000 * 0.25, rounded up

      const orphan = rep.lines.find((l) => l.label.endsWith('_Orphan'));
      expect(orphan).toBeUndefined();
      const id = await mkDesignation('Orphan');
      const rep2 = await buildYear(db, YEAR);
      const o = rep2.lines.find((l) => l.designation_id === id);
      expect(o.max_usd).toBeNull();
      expect(o.max_native).toBeNull();       // NOT 0 — absence is not a claim
      expect(o.needs_figure).toBe('report_only_needs_typed_figure');
    });

    test('a currency with no stored rate refuses rather than guessing one', async () => {
      const id = await mkDesignation('NoRate', { own_currency: 'SEK' });
      const rep = await buildYear(db, YEAR);
      const l = rep.lines.find((x) => x.designation_id === id);
      // Report-only wins first, so give it a typed figure to reach the FX step.
      await request(app, 'PUT', `/tax/fbar/${YEAR}/line/${id}`, { manual_value_native: 500 });
      const rep2 = await buildYear(db, YEAR);
      const l2 = rep2.lines.find((x) => x.designation_id === id);
      expect(l.needs_figure).toBeTruthy();
      expect(l2.needs_figure).toBe('no_fx_rate_for_currency_year');
      expect(l2.max_usd).toBeNull();
    });

    test('an excluded designation leaves the report entirely', async () => {
      const id = await mkDesignation('Excluded');
      await request(app, 'PATCH', `/tax/designations/${id}`, { review_state: 'excluded' });
      const rep = await buildYear(db, YEAR);
      expect(rep.lines.find((l) => l.designation_id === id)).toBeUndefined();
    });

    // ── §7 / migration 071 ──
    // The defect: excluding an account that was opened in 2026 removed it from
    // TY2026 as well as from TY2025. Two live rows carried a capitalised note
    // asking a future reader to undo it by hand.
    test('excluding a designation FOR ONE YEAR leaves every other year alone', async () => {
      const id = await mkDesignation('YearScoped');
      const r = await request(app, 'PUT', `/tax/designations/${id}/year-state/${YEAR}`,
        { review_state: 'excluded', note: 'opened after this year' });
      expect(r.status).toBe(200);

      // Gone from the year it was excluded for...
      const excludedYear = await buildYear(db, YEAR);
      expect(excludedYear.lines.find((l) => l.designation_id === id)).toBeUndefined();

      // ...and still present in the next one, which is the whole point.
      const nextYear = await buildYear(db, YEAR + 1);
      const still = nextYear.lines.find((l) => l.designation_id === id);
      expect(still).toBeDefined();
      expect(still.review_state).toBe('unreviewed');   // the standing answer
      expect(still.year_review_state).toBeNull();      // no override for that year

      // The standing answer is untouched — a year override is not an edit to it.
      const { rows } = await db.query(
        `SELECT review_state FROM tax_foreign_accounts WHERE id = $1`, [id]);
      expect(rows[0].review_state).toBe('unreviewed');

      await db.query(`DELETE FROM tax_fbar_filings WHERE tax_year = $1`, [YEAR + 1]);
    });

    test('clearing a year override restores the standing answer', async () => {
      const id = await mkDesignation('YearCleared');
      await request(app, 'PUT', `/tax/designations/${id}/year-state/${YEAR}`,
        { review_state: 'excluded' });
      expect(
        (await buildYear(db, YEAR)).lines.find((l) => l.designation_id === id)
      ).toBeUndefined();

      const del = await request(app, 'DELETE', `/tax/designations/${id}/year-state/${YEAR}`);
      expect(del.status).toBe(200);
      expect(del.body.data.cleared).toBe(true);
      expect(
        (await buildYear(db, YEAR)).lines.find((l) => l.designation_id === id)
      ).toBeDefined();
    });

    test('a year override can also REPORT a designation that is excluded standing', async () => {
      // The reverse direction, and the one a from_year/to_year range could not
      // express: a standing "excluded" with one year saying otherwise.
      const id = await mkDesignation('YearReinstated');
      await request(app, 'PATCH', `/tax/designations/${id}`, { review_state: 'excluded' });
      expect(
        (await buildYear(db, YEAR)).lines.find((l) => l.designation_id === id)
      ).toBeUndefined();

      await request(app, 'PUT', `/tax/designations/${id}/year-state/${YEAR}`,
        { review_state: 'reportable', note: 'held during this year only' });
      const line = (await buildYear(db, YEAR)).lines.find((l) => l.designation_id === id);
      expect(line).toBeDefined();
      expect(line.year_review_state).toBe('reportable');
      expect(line.year_review_note).toBe('held during this year only');

      await request(app, 'DELETE', `/tax/designations/${id}/year-state/${YEAR}`);
    });

    test('a year override refuses a state that is not one of the three', async () => {
      const id = await mkDesignation('YearBadState');
      const r = await request(app, 'PUT', `/tax/designations/${id}/year-state/${YEAR}`,
        { review_state: 'maybe' });
      expect(r.status).toBe(400);
      const missing = await request(app, 'PUT', `/tax/designations/99999999/year-state/${YEAR}`,
        { review_state: 'excluded' });
      expect(missing.status).toBe(404);
    });

    test('the $10,000 verdict is THREE-valued, and refuses to say "no" on a partial set', async () => {
      const rep = await buildYear(db, YEAR);
      // Over 10k holds however many rows are missing — more money cannot take it
      // back under — so a true verdict is safe even while incomplete.
      expect(rep.aggregate_usd).toBeGreaterThan(10000);
      expect(rep.aggregate_is_floor).toBe(true);
      expect(rep.threshold_exceeded).toBe(true);
    });

    test('UNDER $10,000 with rows outstanding is null, not false', async () => {
      // The dangerous direction: "no filing required" concluded from a set that
      // is still missing figures. One level up from a zeroed line.
      const small = await db.query(
        `INSERT INTO accounts (name, account_type, section, currency, opening_balance,
                               opening_balance_date, is_active)
         VALUES ($1,'asset','balance_sheet','PLN',100,'1990-01-01',TRUE) RETURNING id`,
        [`${PREFIX}_Small`]);
      await db.query(`UPDATE tax_foreign_accounts SET review_state='excluded' WHERE label LIKE $1`,
        [`${PREFIX}%`]);
      const linkedId = await mkDesignation('SmallLinked', { account_id: small.rows[0].id });
      const orphanId = await mkDesignation('SmallOrphan');

      const rep = await buildYear(db, YEAR);
      expect(rep.aggregate_usd).toBeLessThan(10000);
      expect(rep.aggregate_is_floor).toBe(true);
      expect(rep.threshold_exceeded).toBeNull();   // <- the whole point

      // Complete the set; only then may it answer false.
      await request(app, 'PATCH', `/tax/designations/${orphanId}`, { review_state: 'excluded' });
      const rep2 = await buildYear(db, YEAR);
      expect(rep2.aggregate_is_floor).toBe(false);
      expect(rep2.threshold_exceeded).toBe(false);

      await request(app, 'PATCH', `/tax/designations/${linkedId}`, { review_state: 'excluded' });
    });
  });

  describe('freeze and the filed-vs-recomputed diff', () => {
    test('refuses to freeze a year with lines still missing a figure', async () => {
      await db.query(`UPDATE tax_foreign_accounts SET review_state='unreviewed' WHERE label LIKE $1`,
        [`${PREFIX}%`]);
      const r = await request(app, 'POST', `/tax/fbar/${YEAR}/freeze`, {});
      expect(r.status).toBe(409);
      expect(r.body.error).toMatch(/without a figure/);
    });

    test('a filed year survives calibrate() rewriting history — the §6 hazard', async () => {
      // Leave only the linked account, freeze, then move opening_balance the way
      // calibrate() does: one constant across EVERY historical date, no audit
      // row. The recomputed figure must move and the FILED one must not.
      await db.query(`UPDATE tax_foreign_accounts SET review_state='excluded' WHERE label LIKE $1`,
        [`${PREFIX}%`]);
      await db.query(
        `UPDATE tax_foreign_accounts SET review_state='reportable' WHERE label = $1`,
        [`${PREFIX}_Linked`]);

      const froze = await freezeYear(db, YEAR, { note: 'test' });
      expect(froze.lines).toBe(1);

      await db.query(`UPDATE accounts SET opening_balance = 50000 WHERE id = $1`, [acctId]);

      const diff = await filedVsRecomputed(db, YEAR);
      expect(diff.filed).toBe(true);
      const row = diff.rows[0];
      expect(row.filed_native).toBe(100000);        // frozen, unmoved
      expect(row.recomputed_native).toBe(150000);   // history moved under it
      expect(row.delta_native).toBe(50000);

      await db.query(`UPDATE accounts SET opening_balance = 0 WHERE id = $1`, [acctId]);
    });

    test('a filed year refuses further line edits, and cannot be re-frozen', async () => {
      const edit = await request(app, 'PUT', `/tax/fbar/${YEAR}/line/1`, { manual_value_native: 1 });
      expect(edit.status).toBe(409);
      const again = await request(app, 'POST', `/tax/fbar/${YEAR}/freeze`, {});
      expect(again.status).toBe(409);
      expect(again.body.error).toMatch(/already filed/);
    });

    test('the frozen line COPIES the number, so a later rename cannot rewrite it', async () => {
      await db.query(`UPDATE accounts SET account_number = 'CHANGED-LATER' WHERE id = $1`, [acctId]);
      const { rows } = await db.query(
        `SELECT account_number FROM tax_fbar_filing_lines
          WHERE filing_id = (SELECT id FROM tax_fbar_filings WHERE tax_year = $1)`, [YEAR]);
      expect(rows[0].account_number).toBe('PL99 1234 5678');
    });

    test('a filed line with nothing behind it reads as UNCHECKED, not as unchanged', async () => {
      // A historical return transcribed from paper stands alone: migration 070
      // makes `tax_foreign_account_id` a soft reference precisely so a filed line
      // survives its designation. Such a line has nothing to recompute from, and
      // reporting a null delta for it made it indistinguishable from a figure
      // that still reconciles — so a filing where NOTHING could be checked read
      // as one where nothing had moved.
      const { rows: f } = await db.query(
        `SELECT id FROM tax_fbar_filings WHERE tax_year = $1 AND status = 'filed'
          ORDER BY amendment_seq DESC LIMIT 1`, [YEAR]);
      await db.query(
        `INSERT INTO tax_fbar_filing_lines
           (filing_id, tax_foreign_account_id, label, max_value_usd)
         VALUES ($1, NULL, $2, 12345)`,
        [f[0].id, `${PREFIX}_PaperOnly`]);

      const d = await filedVsRecomputed(db, YEAR);
      const paper = d.rows.find((r) => r.label === `${PREFIX}_PaperOnly`);
      expect(paper.comparable).toBe(false);
      expect(paper.recomputed_native).toBeNull();
      expect(d.comparable_count).toBeLessThan(d.rows.length);
      // It must not be counted as a line that moved, either.
      expect(d.moved_count).toBe(0);
    });

    // Runs LAST in this block: it creates a second filing for the year, and the
    // assertions above use a single-row subquery on `tax_fbar_filings`.
    test('an amendment is a SECOND filing — the filed one is never unfiled', async () => {
      const amend = await request(app, 'POST', `/tax/fbar/${YEAR}/amend`, {});
      expect(amend.status).toBe(200);
      expect(amend.body.data.amendment_seq).toBe(1);

      // The original is untouched and still readable — the whole reason the key
      // is (tax_year, amendment_seq) and not tax_year UNIQUE.
      const { rows: filings } = await db.query(
        `SELECT amendment_seq, status FROM tax_fbar_filings
          WHERE tax_year = $1 ORDER BY amendment_seq`, [YEAR]);
      expect(filings).toHaveLength(2);
      expect(filings[0]).toMatchObject({ amendment_seq: 0, status: 'filed' });
      expect(filings[1]).toMatchObject({ amendment_seq: 1, status: 'draft' });

      // The year edits again, against the amendment.
      const rep = await buildYear(db, YEAR);
      expect(rep.filing_status).toBe('draft');

      // And the diff still reads the FILED one, not the open draft.
      const d = await filedVsRecomputed(db, YEAR);
      expect(d.filed).toBe(true);
      expect(d.rows.length).toBeGreaterThan(0);

      // A second amend while one is open is refused rather than stacking drafts.
      const twice = await request(app, 'POST', `/tax/fbar/${YEAR}/amend`, {});
      expect(twice.status).toBe(409);
      expect(twice.body.error).toMatch(/already a draft/);
    });

    test('a year with no filing at all cannot be amended', async () => {
      const r = await request(app, 'POST', `/tax/fbar/${YEAR - 5}/amend`, {});
      expect(r.status).toBe(409);
      expect(r.body.error).toMatch(/no filing to amend/);
    });
  });
});
