'use strict';
/**
 * quicken-anchor.test.js — CR058 valuation anchors.
 *
 * Pure tests only: the CSV contract and the sequential anchor maths. The
 * write/verify path is exercised end-to-end against dev in the CR's rollout
 * (promote → anchor → --check), where the invariants have a real ledger to
 * tie out against.
 */

const path = require('node:path');
const fs = require('node:fs');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://unused/unused';
const {
  parseTargetsCsv, computeAnchors, parseArgs,
  resolveOrCreateValuationBatch, VALUATION_BATCH_STATUS,
} = require('../quicken-anchor');

const FIXTURES = path.resolve(__dirname, '../../../../../Samples/quicken/fixtures');

describe('parseTargetsCsv', () => {
  test('parses the pinned Fidelity Brokerage series', () => {
    const rows = parseTargetsCsv(
      fs.readFileSync(path.join(FIXTURES, 'valuation_targets_fid_brokerage.csv'), 'utf8'),
      'fid'
    );
    // 47 rows from two sources:
    //   19  Quicken annual, 1998-03-20 → 2015-12-31 — no custodian statement
    //       exists for that era, and the 2016-2021 agreement (below) is what
    //       licenses trusting Quicken there.
    //   28  Fidelity statement QUARTERLY, 2016-03-31 → 2022-12-31 — the
    //       custodian is authoritative, and quarterly cuts the maximum drift
    //       window between anchors from 12 months to 3.
    //
    // 2022 was briefly held back to a single annual anchor, on the theory that
    // its large quarterly anchors (+187,681 / -467,227 / +514,765, against
    // 2016-2021 values mostly under 30K) were absorbing a data defect. That
    // was WRONG, and the reconciliation is worth recording because the mistake
    // is easy to repeat: fin's Jan-Sep 2022 flows net +559,234.08 against the
    // custodian's +258,046.88, and the difference is 301,187.20 — exactly the
    // 2022-09-30 gap, to the cent. The cause is the custodian's
    // -1,166,021.87 "change in investment value", which its own footnote says
    // includes journaled securities as well as price movement. A cash-flow
    // ledger has NO market component between anchors, so on an account taking
    // 1.46M of additions while losing 1.17M of value, mid-year points are
    // expected to be wildly off. Large 2022 anchors are the anchors WORKING.
    expect(rows).toHaveLength(47);
    // The first row is the opening anchor, dated the day BEFORE the account's
    // first transaction (1998-03-21): the account was worth nothing before it
    // existed. Anchoring the 1998 year-end value at March would misdate it.
    expect(rows[0]).toEqual({ as_of_date: '1998-03-20', target: 0 });
    expect(rows[1]).toEqual({ as_of_date: '1998-12-31', target: 29436.0 });
    // The last row was 2022-12-28 / 1,160,619.23, taken from Quicken's report
    // ("as of 12/28/2022"). Fidelity's own statement puts the account at
    // 997,171.99 on 2022-12-31 — a 163,447.24 gap, 16.4%.
    //
    // The custodian wins, and the reason is mechanical rather than a judgement
    // call: the QIF's last transaction is 2022-11-25, so Quicken stopped being
    // maintained and its 12/28 figure prices stale holdings. The custodian
    // trajectory makes the old number impossible on its face — 1,133,114.89 at
    // 09-30 falling to 997,171.99 at 12-31 cannot pass through 1,160,619 on
    // 12/28 without a 27K rise and a 163K fall inside three days.
    //
    // Every OTHER overlapping year-end validates Quicken to within 0.09%
    // (2016 −0.024%, 2017 +0.006%, 2018 −0.087%, 2019 +0.003%, 2020 −0.009%,
    // 2021 −0.037%), so this is one bad year in a source that is otherwise
    // independently confirmed — not grounds to distrust the series.
    expect(rows[rows.length - 1]).toEqual({ as_of_date: '2022-12-31', target: 997171.99 });
  });

  test('header is matched case-insensitively, with BOM and whitespace tolerated', () => {
    const rows = parseTargetsCsv('﻿  AS_OF_DATE , Target \n2020-12-31, 1234.50\n');
    expect(rows).toEqual([{ as_of_date: '2020-12-31', target: 1234.5 }]);
  });

  test('a thousands separator is rejected, not silently truncated to its first digit', () => {
    // "1,234.50" splits into extra cells; taking cells[1] would read 1 — a
    // wrong money value that no later check could catch.
    expect(() => parseTargetsCsv('as_of_date,target\n2020-12-31,"1,234.50"\n'))
      .toThrow(/expected 2 columns, got 3/);
  });

  test('rows are returned in date order regardless of file order', () => {
    const rows = parseTargetsCsv('as_of_date,target\n2021-12-31,2\n2019-12-31,1\n');
    expect(rows.map((r) => r.as_of_date)).toEqual(['2019-12-31', '2021-12-31']);
  });

  // Fail-loud contract (.claude/rules/data-import.md): never a silent 0 on a
  // money field, never a silent success over an empty series.
  test('a missing target is a hard error, not a silent zero', () => {
    expect(() => parseTargetsCsv('as_of_date,target\n2020-12-31,\n'))
      .toThrow(/missing target for 2020-12-31/);
  });

  test('a non-numeric target is a hard error', () => {
    expect(() => parseTargetsCsv('as_of_date,target\n2020-12-31,n\/a\n'))
      .toThrow(/non-numeric target/);
  });

  test('a bad date is a hard error', () => {
    expect(() => parseTargetsCsv('as_of_date,target\n31-12-2020,5\n'))
      .toThrow(/bad as_of_date/);
  });

  test('a missing column is a hard error', () => {
    expect(() => parseTargetsCsv('date,value\n2020-12-31,5\n'))
      .toThrow(/must contain as_of_date and target/);
  });

  test('an empty file and a header-only file both throw', () => {
    expect(() => parseTargetsCsv('')).toThrow(/is empty/);
    expect(() => parseTargetsCsv('as_of_date,target\n')).toThrow(/no data rows/);
  });

  test('a duplicate date is a hard error (two anchors on one day cannot both tie)', () => {
    expect(() => parseTargetsCsv('as_of_date,target\n2020-12-31,1\n2020-12-31,2\n'))
      .toThrow(/duplicate as_of_date 2020-12-31/);
  });
});

describe('computeAnchors', () => {
  test('each anchor is measured AFTER all prior anchors, so every target ties', () => {
    const targets = [
      { as_of_date: '2020-12-31', target: 100 },
      { as_of_date: '2021-12-31', target: 250 },
      { as_of_date: '2022-12-31', target: 200 },
    ];
    // A ledger that drifts away from the targets in both directions.
    const ledger = { '2020-12-31': 400, '2021-12-31': 500, '2022-12-31': 300 };
    const { anchors, sigma } = computeAnchors(targets, ledger);

    // Replay the way the ledger will: balance(D) = ledger(D) + Σ anchors ≤ D.
    let cum = 0;
    for (let i = 0; i < targets.length; i++) {
      cum += anchors[i].anchor;
      expect(ledger[targets[i].as_of_date] + cum).toBeCloseTo(targets[i].target, 2);
    }
    expect(sigma).toBeCloseTo(cum, 2);
  });

  test('Σ equals target − ledger at the LAST date, so the reversal neutralizes exactly', () => {
    const targets = [
      { as_of_date: '2020-12-31', target: 10 },
      { as_of_date: '2021-12-31', target: 40 },
    ];
    const ledger = { '2020-12-31': 100, '2021-12-31': 90 };
    const { sigma } = computeAnchors(targets, ledger);
    expect(sigma).toBeCloseTo(40 - 90, 2);
    // Σ + reversal must be exactly zero or the handoff moves today's balance.
    expect(sigma + -sigma).toBe(0);
  });

  test('a ledger already on target needs no anchors', () => {
    const targets = [{ as_of_date: '2020-12-31', target: 100 }];
    const { anchors, sigma } = computeAnchors(targets, { '2020-12-31': 100 });
    expect(anchors[0].anchor).toBe(0);
    expect(sigma).toBe(0);
  });

  test('amounts are rounded to 2dp so the written rows cannot accrue a residual', () => {
    const targets = [{ as_of_date: '2020-12-31', target: 100 }];
    const { anchors } = computeAnchors(targets, { '2020-12-31': 33.333333 });
    expect(anchors[0].anchor).toBe(66.67);
  });
});

// ---------------------------------------------------------------------------
// Valuation-only sets — anchoring an account with NO Quicken import behind it.
//
// CR058's original design took the anchors' owning batch for free from the
// import. Fidelity Cash Mgt, Bond and Options have no Quicken history, so they
// had nothing to inherit and could not be anchored at all. A batch row carrying
// only anchors closes that, and the argument contract is where a caller could
// otherwise write a set to the wrong owner without noticing.
// ---------------------------------------------------------------------------
describe('parseArgs — anchor ownership', () => {
  const base = ['--account', 'X', '--targets', 't.csv', '--handoff', '2026-01-01'];

  test('a set must have exactly one owner — neither is an error', () => {
    expect(() => parseArgs(base)).toThrow(/one of --batch .* or --valuation-set/);
  });

  test('…and both is an error, because a row can carry only one import_batch_id', () => {
    expect(() => parseArgs([...base, '--batch', 'u', '--valuation-set', 'v']))
      .toThrow(/mutually exclusive/);
  });

  test('either owner alone is accepted', () => {
    expect(parseArgs([...base, '--batch', 'u']).batch).toBe('u');
    expect(parseArgs([...base, '--valuation-set', 'v']).valuationSet).toBe('v');
  });

  test('--clear needs no targets and no handoff — it only removes', () => {
    const a = parseArgs(['--account', 'X', '--valuation-set', 'v', '--clear']);
    expect(a.clear).toBe(true);
    expect(a.targets).toBeNull();
  });

  test('--clear and --check are mutually exclusive: one writes, one must not', () => {
    expect(() => parseArgs(['--account', 'X', '--valuation-set', 'v', '--clear', '--check']))
      .toThrow(/mutually exclusive/);
  });

  test('--apply and --check remain mutually exclusive', () => {
    expect(() => parseArgs([...base, '--batch', 'u', '--apply', '--check']))
      .toThrow(/mutually exclusive/);
  });
});

const { Pool } = require('pg');
const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;

dbDescribe('resolveOrCreateValuationBatch (DB-backed)', () => {
  let pool;
  const LABEL = '_anchor_test_valset_';

  beforeAll(() => { pool = new Pool({ connectionString: process.env.DATABASE_URL }); });
  afterAll(async () => { if (pool) await pool.end(); });

  test('creates once, then resolves the SAME batch by label', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const first = await resolveOrCreateValuationBatch(client, LABEL);
      expect(first.created).toBe(true);
      expect(first.id).toMatch(/^[0-9a-f-]{36}$/);

      const second = await resolveOrCreateValuationBatch(client, LABEL);
      // Idempotent by label — a re-run must UPDATE a set in place, never
      // accumulate orphaned ones that no --clear would ever find.
      expect({ id: second.id, created: second.created }).toEqual({ id: first.id, created: false });

      const { rows } = await client.query(
        `SELECT status FROM quicken_import_batches WHERE id = $1`, [first.id]
      );
      expect(rows[0].status).toBe(VALUATION_BATCH_STATUS);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  test('REFUSES to attach a valuation set to a real Quicken import batch', async () => {
    // The dangerous confusion: a label that happens to match an imported batch
    // would otherwise write anchors onto it, entangling them with an import
    // whose rollback would then take them — silently, and only on rollback.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO quicken_import_batches (id, label, status)
         VALUES (gen_random_uuid(), $1, 'promoted')`, [LABEL]
      );
      await expect(resolveOrCreateValuationBatch(client, LABEL))
        .rejects.toThrow(/is a Quicken IMPORT batch, not a valuation set/);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  test('an ambiguous label is a hard error, not a silent pick', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (let i = 0; i < 2; i++) {
        await client.query(
          `INSERT INTO quicken_import_batches (id, label, status)
           VALUES (gen_random_uuid(), $1, $2)`, [LABEL, VALUATION_BATCH_STATUS]
        );
      }
      await expect(resolveOrCreateValuationBatch(client, LABEL))
        .rejects.toThrow(/ambiguous --valuation-set/);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
