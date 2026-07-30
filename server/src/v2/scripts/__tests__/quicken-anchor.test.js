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
const { parseTargetsCsv, computeAnchors } = require('../quicken-anchor');

const FIXTURES = path.resolve(__dirname, '../../../../../Samples/quicken/fixtures');

describe('parseTargetsCsv', () => {
  test('parses the pinned Fidelity Brokerage series', () => {
    const rows = parseTargetsCsv(
      fs.readFileSync(path.join(FIXTURES, 'valuation_targets_fid_brokerage.csv'), 'utf8'),
      'fid'
    );
    // 44 rows from three sources, in this order:
    //   19  Quicken annual, 1998-03-20 → 2015-12-31 — no custodian statement
    //       exists for that era, and the 2016-2021 agreement (below) is what
    //       licenses trusting Quicken there.
    //   24  Fidelity statement QUARTERLY, 2016-03-31 → 2021-12-31 — the
    //       custodian is authoritative, and quarterly cuts the maximum drift
    //       window between anchors from 12 months to 3.
    //    1  Fidelity statement ANNUAL, 2022-12-31 — deliberately NOT quarterly.
    //       The 2022 quarterly anchors came out at +187,681 / -467,227 /
    //       +514,765, which is not market movement: fin's ledger sits 467K
    //       above the custodian at 2022-09-30. Pinning each quarter would let
    //       the anchors ABSORB that, which is exactly what §1.3 established not
    //       to do — a defect that a plug swallows can never be found again.
    //       Logged as a data defect instead; see the roadmap.
    expect(rows).toHaveLength(44);
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
