'use strict';
/**
 * attribute-unrealized.test.js — CR058 §12.11 unrealized attribution.
 *
 * Pure tests only, matching the sibling script suites: the CSV contract, the
 * argument contract, and the bucket constants. The write path is exercised
 * end-to-end in the rollout, where the balance-neutrality invariant has a real
 * ledger to assert against.
 */

const path = require('node:path');
const fs = require('node:fs');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://unused/unused';
const {
  parseLevelsCsv, parseArgs, SOURCE,
  UNREALIZED_CATEGORY_ID, VALUATION_CATEGORY_ID,
} = require('../attribute-unrealized');

const FIXTURES = path.resolve(__dirname, '../../../../../Samples/quicken/fixtures');
const read = (f) => fs.readFileSync(path.join(FIXTURES, f), 'utf8');

describe('parseLevelsCsv', () => {
  test('parses the pinned Fidelity Stocks unrealized levels', () => {
    const rows = parseLevelsCsv(read('unrealized_levels_fid_stocks.csv'), 'stocks');
    expect(rows).toHaveLength(36);
    // The first row is a BASELINE and writes nothing. It is negative here, which
    // is the point: at 2016-03-31 the account was sitting on an embedded LOSS,
    // and treating that first level as a period's return would book -34,952.66
    // of market movement that never happened.
    expect(rows[0]).toEqual({ as_of_date: '2016-03-31', level: -34952.66 });
    expect(rows[rows.length - 1].as_of_date).toBe('2024-12-31');
  });

  test('stops before 2025 — where real Unrealized G/L postings already exist', () => {
    // Both Fidelity accounts carry PocketSmith's own unrealized entries from
    // 2025-01-31. Overlapping them would double-count the same market movement,
    // and the balance would be unchanged either way, so nothing downstream
    // would notice. The script guards this at run time; this guards the fixture.
    for (const f of ['unrealized_levels_fid_stocks.csv', 'unrealized_levels_fid_ira.csv']) {
      for (const r of parseLevelsCsv(read(f), f)) expect(r.as_of_date < '2025-01-01').toBe(true);
    }
  });

  test('sorts by date — periods are differences, so order is correctness', () => {
    const rows = parseLevelsCsv('as_of_date,level\n2024-12-31,100\n2024-09-30,40\n', 'x');
    expect(rows.map((r) => r.as_of_date)).toEqual(['2024-09-30', '2024-12-31']);
    // Unsorted, the same file would book -60 where the truth is +60.
    expect(rows[1].level - rows[0].level).toBe(60);
  });

  test('a missing level column is an error, never a silent zero', () => {
    expect(() => parseLevelsCsv('as_of_date,unrealized\n2024-12-31,100\n', 'bad'))
      .toThrow(/must contain 'as_of_date' and 'level'/);
  });

  test('rejects a non-numeric level and a malformed date', () => {
    expect(() => parseLevelsCsv('as_of_date,level\n2024-12-31,n/a\n', 'b')).toThrow(/bad level/);
    expect(() => parseLevelsCsv('as_of_date,level\n31/12/2024,100\n', 'b')).toThrow(/bad date/);
  });
});

describe('parseArgs', () => {
  test('requires --account and --targets, and defaults to a dry run', () => {
    expect(() => parseArgs(['--targets', 'x.csv'])).toThrow(/--account/);
    expect(() => parseArgs(['--account', 'A'])).toThrow(/--targets/);
    expect(parseArgs(['--account', 'A', '--targets', 'x.csv']).apply).toBe(false);
  });

  test('rejects an unknown flag rather than ignoring it', () => {
    expect(() => parseArgs(['--account', 'A', '--targets', 'x.csv', '--aply']))
      .toThrow(/unknown argument: --aply/);
  });
});

describe('the paired-entry contract', () => {
  test('the two legs land in DIFFERENT buckets, which is the whole point', () => {
    // CR056's bucketOf: category 88 → 'price'; anything is_transfer → 'flow'.
    // 229 (Valuation - Historical) carries is_transfer TRUE. If both legs used
    // the same category the pair would cancel inside one bucket and reclassify
    // nothing, while still passing the balance-neutrality check.
    expect(UNREALIZED_CATEGORY_ID).toBe(88);
    expect(VALUATION_CATEGORY_ID).toBe(229);
    expect(UNREALIZED_CATEGORY_ID).not.toBe(VALUATION_CATEGORY_ID);
  });

  test('rows are tagged with their own source so the set stays removable', () => {
    expect(SOURCE).toBe('statement-unrealized');
  });
});
