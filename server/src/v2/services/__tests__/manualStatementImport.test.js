/**
 * CR036 — pure sign-math for the manual statement-upload path. These encode the
 * "footgun" contract: how a profile's fin-convention amounts + positive balance
 * magnitude map onto what the shared promote/recon path expects, using the
 * account's feed_negate_tx / feed_sign / account_type.
 *
 * Anchored to the real Luxury Card (Barclays) mapping: liability, feed_sign=1,
 * feed_negate_tx=false, statement balance printed as +7930.84.
 */

const { effFeedSign, finBalanceFromMagnitude, feedNativeAmount } = require('../manualStatementImport');

describe('effFeedSign', () => {
  test('explicit feed_sign wins over the account_type heuristic', () => {
    // Luxury Card: liability but feed reports balance already-negative → feed_sign=1
    expect(effFeedSign(1, 'liability')).toBe(1);
    expect(effFeedSign(-1, 'asset')).toBe(-1);
  });
  test('null feed_sign falls back to the heuristic (liability -1, asset +1)', () => {
    expect(effFeedSign(null, 'liability')).toBe(-1);
    expect(effFeedSign(null, 'asset')).toBe(1);
    expect(effFeedSign(undefined, 'checking')).toBe(1);
  });
});

describe('finBalanceFromMagnitude', () => {
  test('a liability owes → stored negative; an asset → positive', () => {
    expect(finBalanceFromMagnitude(7930.84, 'liability')).toBe(-7930.84);
    expect(finBalanceFromMagnitude(1234.56, 'asset')).toBe(1234.56);
  });
  test('magnitude is treated as absolute regardless of incoming sign', () => {
    expect(finBalanceFromMagnitude(-7930.84, 'liability')).toBe(-7930.84);
  });
  test('null magnitude → null (no balance line parsed)', () => {
    expect(finBalanceFromMagnitude(null, 'liability')).toBeNull();
  });
});

describe('feedNativeAmount', () => {
  test('feed_negate_tx=false stores the amount verbatim (Luxury Card)', () => {
    expect(feedNativeAmount(-1389.93, false)).toBe(-1389.93); // purchase stays negative
    expect(feedNativeAmount(11527.84, false)).toBe(11527.84); // payment stays positive
  });
  test('feed_negate_tx=true flips so promote re-flips back to fin convention', () => {
    expect(feedNativeAmount(-29.02, true)).toBe(29.02);
    expect(feedNativeAmount(50, true)).toBe(-50);
  });
});

describe('end-to-end sign identity (recon must reconcile at drift 0)', () => {
  // The Luxury Card statement balance, run through storage and back through the
  // recon formula, must equal the fin-convention balance it started from.
  test('Luxury Card: magnitude 7930.84 → stored → recon expected = -7930.84', () => {
    const magnitude = 7930.84;
    const accountType = 'liability';
    const feedSign = 1;
    const finBalance = finBalanceFromMagnitude(magnitude, accountType);      // -7930.84
    const eff = effFeedSign(feedSign, accountType);                          // 1
    const storedBalance = Math.round(finBalance * eff * 100) / 100;          // -7930.84
    // recon: expected = stored_balance * feed_sign  (bankFeedReconciliation.js)
    const reconExpected = Math.round(storedBalance * eff * 100) / 100;
    expect(reconExpected).toBe(finBalance); // drift = computed - expected = 0 when they match
  });

  test('heuristic-signed liability (feed_sign null) still round-trips', () => {
    const finBalance = finBalanceFromMagnitude(500, 'liability');  // -500
    const eff = effFeedSign(null, 'liability');                    // -1
    const storedBalance = finBalance * eff;                        // +500 (feed native)
    const reconExpected = storedBalance * eff;                     // -500
    expect(reconExpected).toBe(finBalance);
  });
});
