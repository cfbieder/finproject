'use strict';
/**
 * restate-mtm.test.js — CR061 month-end mark restatement.
 *
 * Pure tests only, matching quicken-anchor.test.js: the CSV contract and the
 * argument contract. The write path is exercised end-to-end against prod in
 * the rollout (restate → re-read balance → assert it equals the custodian
 * target, inside the same transaction), where there is a real ledger to tie
 * out against.
 */

const path = require('node:path');
const fs = require('node:fs');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://unused/unused';
const {
  parseTargetsCsv, parseArgs,
  MTM_SOURCE, MTM_DESCRIPTION, UNREALIZED_GL_CATEGORY_ID,
} = require('../restate-mtm');

const FIXTURES = path.resolve(__dirname, '../../../../../Samples/quicken/fixtures');

const read = (f) => fs.readFileSync(path.join(FIXTURES, f), 'utf8');

describe('parseTargetsCsv', () => {
  test('parses the pinned Fidelity Stocks June restatement', () => {
    // 2026-06-30's mark was written against a feed balance that had been flat
    // for three days (1,155,916.26 on 06-28/29/30). The custodian's own
    // statement puts the account at 1,184,333.58, and the feed's 07-02 row
    // carries that same figure to a penny — the settled close, delivered late.
    expect(parseTargetsCsv(read('restate_targets_fid_stocks_2026.csv'), 'stocks'))
      .toEqual([{ as_of_date: '2026-06-30', target: 1184333.58 }]);
  });

  test('parses the pinned Fidelity IRA June restatement', () => {
    expect(parseTargetsCsv(read('restate_targets_fid_ira_2026.csv'), 'ira'))
      .toEqual([{ as_of_date: '2026-06-30', target: 292622.2 }]);
  });

  test('Bond carries BOTH 2026 quarter-ends, not just June', () => {
    // Bond and Cash Mgt have no Quicken history, so their anchors stop at
    // 2025-12-31 with a reversal at 2026-01-01 — from there their balances run
    // on the raw ledger with nothing correcting them. Bond was already 1,859.57
    // adrift at 2026-03-31, BEFORE June's stale mark. Restating June alone
    // would pin the level correctly but dump Q1's drift into June's unrealized
    // figure, overstating that month's move. Pinning both quarter-ends keeps
    // each quarter's movement inside its own quarter.
    expect(parseTargetsCsv(read('restate_targets_fid_bond_2026.csv'), 'bond'))
      .toEqual([
        { as_of_date: '2026-03-31', target: 997450.51 },
        { as_of_date: '2026-06-30', target: 1221053.96 },
      ]);
  });

  test('sorts by date regardless of file order', () => {
    // Not cosmetic. Each target is restated against the balance AS IT STANDS,
    // so an out-of-order file would compute June against a pre-March-correction
    // ledger and land on the wrong number — while still reporting success,
    // because the per-row assertion only checks the row it just wrote.
    const rows = parseTargetsCsv(
      'as_of_date,target\n2026-06-30,1221053.96\n2026-03-31,997450.51\n', 'unsorted'
    );
    expect(rows.map((r) => r.as_of_date)).toEqual(['2026-03-31', '2026-06-30']);
  });

  test('tolerates header case and surrounding whitespace', () => {
    const rows = parseTargetsCsv(' AS_OF_DATE , Target \n 2026-06-30 , 100.25 \n', 'ws');
    expect(rows).toEqual([{ as_of_date: '2026-06-30', target: 100.25 }]);
  });

  test('rejects a missing target column rather than defaulting to zero', () => {
    // A silent 0 here would restate the mark so the balance lands on zero —
    // wiping the account. Money columns fail loud (data-import rules).
    expect(() => parseTargetsCsv('as_of_date,value\n2026-06-30,100\n', 'bad'))
      .toThrow(/must contain 'as_of_date' and 'target'/);
  });

  test('rejects a non-numeric target', () => {
    expect(() => parseTargetsCsv('as_of_date,target\n2026-06-30,n/a\n', 'bad'))
      .toThrow(/bad target "n\/a" on 2026-06-30/);
  });

  test('rejects a malformed date', () => {
    expect(() => parseTargetsCsv('as_of_date,target\n30/06/2026,100\n', 'bad'))
      .toThrow(/bad date "30\/06\/2026"/);
  });

  test('rejects a header-only file', () => {
    expect(() => parseTargetsCsv('as_of_date,target\n', 'empty'))
      .toThrow(/expected a header and at least one row/);
  });
});

describe('parseArgs', () => {
  test('requires --account', () => {
    expect(() => parseArgs(['--targets', 'x.csv'])).toThrow(/--account <name> is required/);
  });

  test('requires --targets', () => {
    expect(() => parseArgs(['--account', 'Fidelity Bond'])).toThrow(/--targets <csv> is required/);
  });

  test('defaults to a dry run — writing is opt-in', () => {
    expect(parseArgs(['--account', 'Fidelity Bond', '--targets', 'x.csv']).apply).toBe(false);
    expect(parseArgs(['--account', 'Fidelity Bond', '--targets', 'x.csv', '--apply']).apply).toBe(true);
  });

  test('rejects an unknown flag rather than ignoring it', () => {
    // A typo'd --apply must not silently roll back a run the operator believes
    // committed, nor the reverse.
    expect(() => parseArgs(['--account', 'X', '--targets', 'x.csv', '--aply']))
      .toThrow(/unknown argument: --aply/);
  });
});

describe('written row shape', () => {
  test('restates into the same bucket the original mark used', () => {
    // The correction belongs in Unrealized G/L, not CR058's
    // `Valuation - Historical`: a stale feed understates exactly one thing,
    // market movement. The anchors avoid that bucket because they also absorb
    // flows and liquidation timing; a stale mark has no such ambiguity.
    expect(MTM_SOURCE).toBe('mtm');
    expect(MTM_DESCRIPTION).toBe('Unrealized G/L (feed MTM)');
    expect(UNREALIZED_GL_CATEGORY_ID).toBe(88);
  });
});
