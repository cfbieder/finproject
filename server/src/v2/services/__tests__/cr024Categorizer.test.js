/**
 * CR024 Phase 2 — Fidelity activity categorizer (pure).
 *
 * Maps a SnapTrade activity_type (+ the account's trade_treatment) to a promote
 * action/category. No DB. The promote-time name→id resolution and the suppress/
 * insert/link wiring are exercised live in the dev walkthrough + the DB promote
 * tests in bankFeedImport.test.js.
 */

const { categorizeFidelityActivity } = require('../../converters/bankFeedToCanonical');

describe('categorizeFidelityActivity', () => {
  test('INTEREST → income / Interest Income', () => {
    expect(categorizeFidelityActivity('INTEREST', 'offset')).toEqual({ action: 'income', category: 'Interest Income' });
  });

  test('DIVIDEND → income / Financial Income - Dividend (regardless of treatment)', () => {
    expect(categorizeFidelityActivity('DIVIDEND', 'offset')).toEqual({ action: 'income', category: 'Financial Income - Dividend' });
    expect(categorizeFidelityActivity('DIVIDEND', 'income')).toEqual({ action: 'income', category: 'Financial Income - Dividend' });
  });

  test('REI (reinvestment) → transfer / Transfer - Securities Trades', () => {
    expect(categorizeFidelityActivity('REI', 'offset')).toEqual({ action: 'transfer', category: 'Transfer - Securities Trades' });
  });

  test('BUY/SELL with trade_treatment=offset → Transfer - Securities Trades', () => {
    expect(categorizeFidelityActivity('BUY', 'offset')).toEqual({ action: 'transfer', category: 'Transfer - Securities Trades' });
    expect(categorizeFidelityActivity('SELL', 'offset')).toEqual({ action: 'transfer', category: 'Transfer - Securities Trades' });
  });

  test('BUY/SELL with trade_treatment=income → Option Trade (the Options account)', () => {
    expect(categorizeFidelityActivity('BUY', 'income')).toEqual({ action: 'income', category: 'Option Trade' });
    expect(categorizeFidelityActivity('SELL', 'income')).toEqual({ action: 'income', category: 'Option Trade' });
  });

  test('CONTRIBUTION/WITHDRAWAL → transfer / Transfer - Bank (matchable, not income/expense)', () => {
    expect(categorizeFidelityActivity('CONTRIBUTION', 'offset')).toEqual({ action: 'transfer', category: 'Transfer - Bank' });
    expect(categorizeFidelityActivity('WITHDRAWAL', 'offset')).toEqual({ action: 'transfer', category: 'Transfer - Bank' });
  });

  test('LOAN / JOURNALED / OPTIONEXPIRATION → suppress (net-zero plumbing)', () => {
    expect(categorizeFidelityActivity('LOAN', 'offset')).toEqual({ action: 'suppress' });
    expect(categorizeFidelityActivity('JOURNALED', 'offset')).toEqual({ action: 'suppress' });
    expect(categorizeFidelityActivity('OPTIONEXPIRATION', 'offset')).toEqual({ action: 'suppress' });
  });

  test('PAYMENT and any unknown/new type → review (fail-safe, never dropped/mis-booked)', () => {
    expect(categorizeFidelityActivity('PAYMENT', 'offset')).toEqual({ action: 'review' });
    expect(categorizeFidelityActivity('FEE', 'offset')).toEqual({ action: 'review' });
    expect(categorizeFidelityActivity('SOMETHING_NEW', 'offset')).toEqual({ action: 'review' });
  });

  test('null activity_type (PKO/GoCardless rows) → review (pre-Phase-2 behavior, unchanged)', () => {
    expect(categorizeFidelityActivity(null, 'offset')).toEqual({ action: 'review' });
    expect(categorizeFidelityActivity(undefined, undefined)).toEqual({ action: 'review' });
  });

  test('case-insensitive on the activity_type token', () => {
    expect(categorizeFidelityActivity('dividend', 'offset')).toEqual({ action: 'income', category: 'Financial Income - Dividend' });
  });
});
