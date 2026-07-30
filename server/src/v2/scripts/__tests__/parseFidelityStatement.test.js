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
      expect(Number.isFinite(a.beginningValue)).toBe(true);
      expect(Number.isFinite(a.endingValue)).toBe(true);
      // A custodian account value is never negative; a sign error here would be
      // invisible in a total that happens to look plausible.
      expect(a.beginningValue).toBeGreaterThanOrEqual(0);
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

  test('account numbers are stable across periods for the same report type', () => {
    const byPrefix = new Map();
    for (const f of localFiles) {
      const prefix = path.basename(f).split('_')[0];
      const st = parseStatement(f);
      const nums = st.accounts.map((a) => a.accountNumber).sort().join(',');
      if (!byPrefix.has(prefix)) byPrefix.set(prefix, new Set());
      byPrefix.get(prefix).add(nums);
    }
    // Each report type should list the same accounts every period. More than
    // one distinct set means the layout shifted or an account row was dropped.
    for (const [prefix, sets] of byPrefix) {
      expect({ prefix, distinctAccountSets: sets.size }).toEqual({ prefix, distinctAccountSets: 1 });
    }
  });
});
