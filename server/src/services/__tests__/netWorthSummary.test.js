'use strict';
/**
 * netWorthSummary.test.js — CR092 P2.
 *
 * The plain-English lead, tested as the pure function it is. Its two hardest
 * rules depend on a MIX of drivers that whichever database a suite runs against
 * may or may not contain, so they are asserted directly instead of hoped for —
 * which is exactly how the defect below reached a rendered page.
 *
 * 🔴 The defect this file exists for. On the live 12-month window the largest
 * driver was a re-valuation of −1.74M against a −1.9M fall, so the lead
 * sentence read correctly and shipped. On the YTD window the largest driver by
 * ABSOLUTE value is income at +368,591 against a net FALL of 96,705, and the
 * page said:
 *
 *     "Net worth fell $96,705. Almost all of it is one thing:
 *      money earned added $368,591."
 *
 * Earning money does not cause a fall. Found by rendering a different window,
 * not by a test — no DB-backed assertion would have caught it, because it is a
 * property of the driver mix rather than of the arithmetic.
 */

const { buildSummary } = require('../netWorthBridge');

const driver = (key, label, amount, extra = {}) => ({ key, label, amount, ...extra });

const bridge = ({ change, drivers, movers = [], from = '2025-12-31', to = '2026-09-05' }) => ({
  from: { date: from, netWorth: 1000000 },
  to: { date: to, netWorth: 1000000 + change },
  change,
  drivers,
  periods: [],
  movers,
});

describe('buildSummary — the leading sentence', () => {
  it('never blames a driver that moved the OTHER way', () => {
    // The live YTD shape: income is the biggest single number and the change is
    // a fall.
    const lines = buildSummary(bridge({
      change: -96705,
      drivers: [
        driver('income', 'Money earned', 368591),
        driver('spending', 'Money spent', -355794),
        driver('currency', 'Exchange-rate moves', -296202),
        driver('revaluation', 'Investments & property re-valued', 212924),
        driver('transfers', "Transfers that didn't net out", -22228),
      ],
    }));
    const lead = lines.join(' ');
    expect(lead).toMatch(/fell \$96,705/);
    expect(lead).not.toMatch(/one thing: money earned/i);
    expect(lead).not.toMatch(/Almost all of it is one thing/i);
  });

  it('says nothing dominates when the drivers largely cancel, and the two sides tie', () => {
    // The live YTD drivers, in full. `uncategorised` is here because without it
    // the fixture's own drivers do not sum to its stated change — which is how
    // the first draft of this test failed, correctly.
    const drivers = [
      driver('income', 'Money earned', 368591),
      driver('spending', 'Money spent', -355794),
      driver('currency', 'Exchange-rate moves', -296202),
      driver('revaluation', 'Investments & property re-valued', 212924),
      driver('transfers', "Transfers that didn't net out", -22228),
      driver('uncategorised', 'Uncategorised', -3996),
    ];
    const change = drivers.reduce((a, d) => a + d.amount, 0);
    expect(change).toBe(-96705); // the fixture ties, or it is testing nothing

    const lines = buildSummary(bridge({ change, drivers }));
    const sentence = lines.find((l) => /No single thing accounts for that/.test(l));
    expect(sentence).toBeDefined();

    // Derived from the fixture, not transcribed: the two figures it prints must
    // reconstruct the change, or the sentence is decoration.
    const gains = drivers.filter((d) => d.amount > 0).reduce((a, d) => a + d.amount, 0);
    const losses = drivers.filter((d) => d.amount < 0).reduce((a, d) => a + d.amount, 0);
    expect(gains + losses).toBe(change);
    expect(sentence).toContain(`$${gains.toLocaleString('en-US')}`);
    expect(sentence).toContain(`$${Math.abs(losses).toLocaleString('en-US')}`);
  });

  it('still names the one thing when one thing really did it', () => {
    // The live 12-month shape — this must not regress into the cancelling case.
    const lines = buildSummary(bridge({
      change: -1900488,
      drivers: [
        driver('revaluation', 'Investments & property re-valued', -1741398),
        driver('spending', 'Money spent', -482691),
        driver('income', 'Money earned', 412492),
        driver('currency', 'Exchange-rate moves', -65231),
      ],
      movers: [{
        account: 'United Beverages',
        drivers: { revaluation: -1873619, spending: 0, income: 0, currency: -58629, transfers: 0 },
      }],
    }));
    const lead = lines.join(' ');
    expect(lead).toMatch(/one thing: investments & property re-valued took \$1,741,398/i);
    expect(lead).toMatch(/United Beverages/);
  });

  it('grades the share language instead of always saying "almost all"', () => {
    // A mover worth 55% of its driver is "most of that", not "almost all of it".
    const lines = buildSummary(bridge({
      change: -1000000,
      drivers: [driver('revaluation', 'Investments & property re-valued', -900000)],
      movers: [{
        account: 'Partial Holding',
        drivers: { revaluation: -500000, spending: 0, income: 0, currency: 0, transfers: 0 },
      }],
    }));
    const lead = lines.join(' ');
    expect(lead).toMatch(/most of that Partial Holding/);
    expect(lead).not.toMatch(/almost all of it Partial Holding/);
  });

  it('does not repeat the currency line when currency IS the lead', () => {
    // A short window where the rate move is the whole change: two sentences
    // saying the same thing in different words.
    const lines = buildSummary(bridge({
      change: 46101,
      drivers: [driver('currency', 'Exchange-rate moves', 46101)],
    }));
    const fxLines = lines.filter((l) => /[Ee]xchange rate/.test(l));
    expect(fxLines).toHaveLength(0);
    expect(lines.join(' ')).toMatch(/all one thing: exchange-rate moves added \$46,101/i);
  });

  it('opens with the direction and the window, in words not ISO dates', () => {
    const lines = buildSummary(bridge({
      change: 5000,
      drivers: [driver('income', 'Money earned', 5000)],
    }));
    expect(lines[0]).toBe('Net worth rose $5,000 between Dec 31, 2025 and Sep 5, 2026.');
  });
});
