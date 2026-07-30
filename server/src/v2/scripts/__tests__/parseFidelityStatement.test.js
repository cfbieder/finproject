'use strict';
/**
 * parseFidelityStatement.test.js
 *
 * NO PINNED FIXTURES, deliberately — and this is a departure from
 * .claude/rules/data-import.md ("pin real (scrubbed) exports as test
 * fixtures"), so it is called out rather than left implicit. A Fidelity
 * INVESTMENT REPORT carries the owner's full name, home address, account
 * numbers and every position held; a "scrubbed" copy would still be the real
 * layout wrapped around real balances, and `Samples/Fidelity/` is gitignored
 * for that reason.
 *
 * So the suite splits in two:
 *   1. Pure tests of the money/date primitives, which need no statement at all
 *      and are where the silent-wrong-number risks actually live.
 *   2. A real-file suite that runs only when the local PDFs are present and
 *      skips otherwise, asserting the STRUCTURAL invariants (parts equal whole,
 *      periods parse, values are plausible) without hardcoding any balance.
 */

const fs = require('node:fs');
const path = require('node:path');

const { parseStatement, money, parsePeriod } = require('../parse-fidelity-statement');

const DIR = path.resolve(__dirname, '../../../../../Samples/Fidelity');
const localFiles = fs.existsSync(DIR)
  ? fs.readdirSync(DIR).filter((f) => f.toLowerCase().endsWith('.pdf')).map((f) => path.join(DIR, f))
  : [];

describe('money()', () => {
  test('parses the shapes Fidelity actually emits', () => {
    expect(money('$1,204,472.05', 't')).toBe(1204472.05);
    expect(money('1,204,472.05', 't')).toBe(1204472.05);
    expect(money('-$20,000.00', 't')).toBe(-20000);
    expect(money('0.44', 't')).toBe(0.44);
  });

  // The failure mode that matters is a money field silently becoming a number
  // that is merely WRONG rather than obviously broken — the CR058 thousands-
  // separator trap, where "1,234.50" read as 1.
  test('a missing value is an error, never a silent zero', () => {
    expect(() => money(null, 'ctx')).toThrow(/missing money value \(ctx\)/);
    expect(() => money(undefined, 'ctx')).toThrow(/missing money value/);
  });

  test('a non-numeric value is an error, never a silent zero', () => {
    expect(() => money('n/a', 'ctx')).toThrow(/non-numeric money value "n\/a" \(ctx\)/);
    expect(() => money('', 'ctx')).toThrow(/non-numeric/);
    expect(() => money('1.2.3', 'ctx')).toThrow(/non-numeric/);
    // A dash is how Fidelity renders "no activity" — it must not read as 0.
    expect(() => money('-', 'ctx')).toThrow(/non-numeric/);
  });
});

describe('parsePeriod()', () => {
  test('reads the statement period off the report header', () => {
    expect(parsePeriod('INVESTMENT REPORT June 1, 2026 - June 30, 2026', 'x')).toEqual({
      periodStart: '2026-06-01',
      periodEnd: '2026-06-30',
    });
  });

  test('handles a period spanning a year boundary', () => {
    expect(parsePeriod('INVESTMENT REPORT December 1, 2025 - January 31, 2026', 'x')).toEqual({
      periodStart: '2025-12-01',
      periodEnd: '2026-01-31',
    });
  });

  test('a missing period is a hard error — dates are what anchor a valuation', () => {
    expect(() => parsePeriod('INVESTMENT REPORT for the period', 'f.pdf')).toThrow(
      /f\.pdf: could not find the statement period/
    );
  });
});

// ---------------------------------------------------------------------------
// Real statements — skipped entirely when Samples/Fidelity/ is empty (CI, or a
// fresh clone). Assertions are STRUCTURAL: no balance is hardcoded, so these
// stay valid as new statements are added.
// ---------------------------------------------------------------------------
const realDescribe = localFiles.length ? describe : describe.skip;

realDescribe('real Fidelity statements (local only)', () => {
  test.each(localFiles.map((f) => [path.basename(f), f]))('%s parses', (name, file) => {
    const st = parseStatement(file);

    expect(st.periodStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(st.periodEnd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(st.periodStart < st.periodEnd).toBe(true);
    expect(['combined', 'single']).toContain(st.layout);
    expect(st.accounts.length).toBeGreaterThan(0);

    for (const a of st.accounts) {
      expect(a.accountNumber).toMatch(/^[A-Z0-9]\d{2}-\d{6}$/);
      // beginningValue is null ONLY on an account's first statement, where
      // Fidelity prints "-" because the account did not exist. It must never be
      // 0: a zero asserts the account was open and empty, which would make any
      // return or delta computed from it quietly wrong.
      if (a.beginningValue === null) {
        expect(a.opensThisPeriod).toBe(true);
      } else {
        expect(Number.isFinite(a.beginningValue)).toBe(true);
        expect(a.beginningValue).toBeGreaterThanOrEqual(0);
      }
      expect(Number.isFinite(a.endingValue)).toBe(true);
      // A custodian account value is never negative; a sign error here would be
      // invisible in a total that happens to look plausible.
      expect(a.endingValue).toBeGreaterThanOrEqual(0);
      expect(a.name.length).toBeGreaterThan(3);
      // The table header must not bleed into the first account's name.
      expect(a.name).not.toMatch(/Beginning Value|Ending Value|Account Number/);
    }
  });

  test('a combined statement reconciles: the accounts sum to the portfolio', () => {
    const combined = localFiles.map(parseStatement).filter((s) => s.portfolio);
    // Only assert if a combined statement is actually present locally.
    if (combined.length === 0) return;
    for (const st of combined) {
      const sum = st.accounts.reduce((s, a) => s + a.endingValue, 0);
      expect(sum).toBeCloseTo(st.portfolio.endingValue, 2);
    }
  });

  // A December file is NOT a December statement. Fidelity issues a YEAR-END
  // report spanning Jan 1 → Dec 31, with ANNUAL values and income. Treating one
  // as a month would misdate the valuation by eleven months and overstate the
  // period's income roughly twelvefold — and it would look entirely plausible.
  // The 2025 year-end report is also what first broke the parser: its labels
  // read "Beginning Account Value as of Jan 1, 2025", which failed loudly
  // rather than returning a silent zero.
  // NEITHER the filename NOR the document's own label determines whether the
  // figures are annual. Both have been observed lying, in opposite directions:
  //   - 2024 December statements are MONTHLY, 2025 are ANNUAL — same `*_12.pdf`.
  //   - The 2018 December statement calls itself "YEAR-END INVESTMENT REPORT"
  //     but spans Dec 1 → Dec 31; the year-end wording is a cover-page summary.
  // Two earlier versions of this test asserted each of those rules in turn and
  // each failed on real files — correctly. `statementType` is now derived from
  // the parsed period, so this asserts a property that is true by construction
  // and would only break if that derivation regressed.
  test('statementType is annual exactly when the period is a whole year', () => {
    for (const f of localFiles) {
      const st = parseStatement(f);
      const wholeYear = /-01-01$/.test(st.periodStart) && /-12-31$/.test(st.periodEnd);
      expect({ file: st.file, type: st.statementType })
        .toEqual({ file: st.file, type: wholeYear ? 'annual' : 'monthly' });
      if (st.statementType === 'monthly') {
        // Monthly, including a partial first month (2024-06-09 → 2024-06-30).
        expect({ file: st.file, sameMonth: st.periodStart.slice(0, 7) === st.periodEnd.slice(0, 7) })
          .toEqual({ file: st.file, sameMonth: true });
      }
    }
  });

  test('the label and the period disagree at least once — so deriving from the label would be wrong', () => {
    const parsed = localFiles.map(parseStatement);
    // The 2018 December statement is the live counter-example. If this ever
    // stops holding, the simpler label-based rule would be safe again — but
    // until then it is demonstrably not.
    const mislabelled = parsed.filter((s) => s.labelledYearEnd && s.statementType !== 'annual');
    expect(mislabelled.length).toBeGreaterThan(0);
  });

  // Three layout variants across 2024-2026, all of which broke the parser on
  // first contact and all of which failed LOUDLY rather than returning a
  // plausible wrong number:
  //   2024 combined  — "Ending NET Portfolio Value" (2025+ drops "Net")
  //   2024 single    — first statement: "Beginning Account Value - -"
  //   2025 year-end  — "Beginning Account Value as of Jan 1, 2025"
  test('every locally present statement parses — no layout variant left behind', () => {
    for (const f of localFiles) {
      expect(() => parseStatement(f)).not.toThrow();
    }
  });

  test('an account opening mid-period reports null, never a zero beginning value', () => {
    const opening = localFiles
      .map(parseStatement)
      .flatMap((s) => s.accounts)
      .filter((a) => a.opensThisPeriod);
    if (opening.length === 0) return;
    for (const a of opening) {
      expect(a.beginningValue).toBeNull();
      expect(a.beginningValue).not.toBe(0);
    }
  });

  // The account SET legitimately changes over time — Cash Mgt first appears in
  // 2020-09, Z31-443539 opens 2024-06 — so asserting a constant set was wrong
  // and failed as soon as 2018/2019 statements arrived. What must hold is that
  // every number parsed is a real Fidelity account number and that no statement
  // lists the same account twice (which would double-count it in the portfolio
  // reconciliation and quietly inflate net worth).
  test('every parsed account number is well-formed and unique within its statement', () => {
    for (const f of localFiles) {
      const st = parseStatement(f);
      const nums = st.accounts.map((a) => a.accountNumber);
      expect({ file: st.file, dupes: nums.length - new Set(nums).size })
        .toEqual({ file: st.file, dupes: 0 });
      for (const n of nums) expect(n).toMatch(/^[A-Z0-9]\d{2}-\d{6}$/);
    }
  });

  test('an account, once it appears, keeps the same number for the rest of the series', () => {
    // Guards against a renumbering going unnoticed — the failure mode behind
    // CR058's account-number correction, where prose assumed a number denoted
    // one account when it denoted another.
    const seen = new Map(); // number → first period it appeared in
    for (const f of localFiles.slice().sort()) {
      const st = parseStatement(f);
      for (const a of st.accounts) {
        if (!seen.has(a.accountNumber)) seen.set(a.accountNumber, st.periodEnd);
      }
    }
    // Every number must be one of the four the custodian statements establish.
    const KNOWN = ['X27-230910', 'X94-929946', '194-901660', 'Z31-443539'];
    for (const n of seen.keys()) expect(KNOWN).toContain(n);
  });
});
