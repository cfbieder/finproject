'use strict';
/**
 * investmentClassification.js — CR061 P1.
 *
 * What an instrument IS, decided once, before anything tries to price it.
 *
 * The stakes are not cosmetic. FOUR conventions share the upstream's two numeric
 * fields, and `value = quantity x price` is the ONLY thing true of all four —
 * which is exactly why conflating them survives every arithmetic check:
 *
 *   equity / ETF / fund  shares         x  dollars per share   100 x 141.50
 *   bond (percent)       $100-face units x percent of par      1000 x 98.745
 *   bond (fraction)      face DOLLARS   x  fraction of par     100000 x 0.9989
 *   money-market fund    shares         at par                 70526.53 x 1.00
 *
 * ⚠️ The two bond forms are BOTH live in this portfolio (29 positions percent,
 * 8 fraction) and are not variants of each other. Reading one as the other
 * renders a bond priced at 98.745 as 9874.500 — which is how this was found:
 * by looking at the page, not by a test.
 *
 * Send a bond to an equity quote lookup and 100,000 face gets priced at $250 a
 * "share" — $25,000,000 booked from one misclassification. Migration 075 removed
 * `securities.asset_class DEFAULT 'stock'` because that default made exactly
 * this happen silently.
 *
 * ── The design rule, and why it is inverted from the obvious one ────────────
 *
 * Shape decides only what is SAFE TO PROBE. It never decides quotability.
 * A security becomes quote-eligible only after a quote has been observed and
 * has passed the divergence guard — `quote_symbol` stays NULL until then. That
 * removes the entire class of failure where a wrong classification silently
 * authorises a price lookup.
 *
 * Anything not positively identified is `unknown`, which is never quoted and
 * always warned. `unknown` is a finding, not a failure.
 */

// Money-market funds hold at par by construction. Quoting them is meaningless —
// the price is 1.00 every day — so they are identified, not inferred, and the
// list is the point rather than an optimisation.
const MMF_TICKERS = new Set(['SPAXX', 'FZDXX', 'FDRXX', 'FDIC', 'SPRXX', 'FZFXX']);

const ALPHA_VALUE = (ch) => {
  const code = ch.charCodeAt(0);
  if (code >= 48 && code <= 57) return code - 48;        // 0-9
  if (code >= 65 && code <= 90) return code - 65 + 10;   // A=10 .. Z=35
  if (ch === '*') return 36;
  if (ch === '@') return 37;
  if (ch === '#') return 38;
  return null;
};

/**
 * CUSIP mod-10 check digit (the "double every second" variant).
 *
 * ⚠️ READ THIS BEFORE TRUSTING IT AS A CLASSIFIER. A valid checksum proves the
 * string is WELL-FORMED, not that it is a bond — the check space is one digit,
 * so roughly one in ten arbitrary 9-character strings passes. Measured against
 * the live portfolio: `FDIC91125`, which is a Fidelity FDIC-insured deposit
 * sweep and not a security at all, PASSES this check. CR061 rev 3 proposed
 * check-digit validation as the thing that would make the bond rule
 * "falsifiable rather than shape-matching"; it does not separate that case, and
 * §6.4 has been corrected.
 *
 * So this is used as a NECESSARY condition (a failing checksum means definitely
 * not a CUSIP) and never as a sufficient one.
 */
function isValidCusip(s) {
  if (typeof s !== 'string' || !/^[0-9A-Z*@#]{9}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 8; i += 1) {
    let v = ALPHA_VALUE(s[i]);
    if (v === null) return false;
    if (i % 2 === 1) v *= 2;
    sum += Math.floor(v / 10) + (v % 10);
  }
  const check = (10 - (sum % 10)) % 10;
  return String(check) === s[8];
}

const CLASSES = Object.freeze({
  EQUITY: { asset_class: 'equity', price_basis: 'per_share', quantity_unit: 'shares' },
  // Two bond conventions, and they are NOT variants of one another — both are
  // live in this portfolio (migration 076). `value = quantity x price` holds for
  // both, which is why conflating them survives every arithmetic check; only a
  // human reading the price can tell, and only if the basis says which it is.
  //   BOND_FRACTION  price 0.9989 (a fraction of par), quantity in face DOLLARS
  //   BOND_PERCENT   price 98.745 (a percent of par),  quantity in $100-face units
  BOND_FRACTION: { asset_class: 'bond', price_basis: 'per_1_face', quantity_unit: 'face' },
  BOND_PERCENT: { asset_class: 'bond', price_basis: 'per_100_face', quantity_unit: 'face' },
  MMF: { asset_class: 'mmf', price_basis: 'par', quantity_unit: 'shares' },
  UNKNOWN: { asset_class: 'unknown', price_basis: null, quantity_unit: null },
});

/**
 * Propose a classification for one upstream position.
 *
 * @param {object}  h                 a holding row: { symbol, name, price }
 * @returns {{asset_class, price_basis, quantity_unit, classification_source, reason}}
 */
function classify(h = {}) {
  const symbol = String(h.symbol || '').trim().toUpperCase();
  const name = String(h.name || '').trim().toUpperCase();
  const price = h.price == null ? null : Number(h.price);

  if (!symbol) return { ...CLASSES.UNKNOWN, classification_source: 'inferred', reason: 'no symbol' };

  // A known money-market fund. Checked FIRST: these are five alpha characters
  // and would otherwise read as equities, which would make them quote-eligible
  // for a price that is 1.00 by definition.
  if (MMF_TICKERS.has(symbol)) {
    return { ...CLASSES.MMF, classification_source: 'inferred', reason: 'known money-market fund' };
  }

  // ── PRICED EXACTLY AT PAR ────────────────────────────────────────────────
  //
  // This test comes BEFORE the CUSIP rule, and that order is the whole reason
  // it exists. `FDIC91125` — a Fidelity FDIC-insured deposit sweep, which is
  // cash and not a security at all — is CUSIP-shaped, self-named AND passes the
  // mod-10 checksum. Classified as a bond it would carry `per_1_face`, and its
  // quantity (a dollar amount) would be read as face value.
  //
  // What actually separates it is the price: a deposit sits at exactly 1.00,
  // while the measured bonds price at 0.9989, 1.01045 and so on — a fraction OF
  // par, essentially never exactly par.
  //
  // ⚠️ It resolves to `unknown`, not to `cash`, on purpose. We can see HOW the
  // instrument is priced (at par, so never quotable) without knowing WHAT it is,
  // and asserting `cash` would claim the second from evidence for the first.
  // `unknown` is never quoted and always warned, so the owner classifies it once
  // by hand — which is the correct amount of certainty here.
  //
  // The cost of the ordering: a bond trading at exactly par on the day it is
  // first seen lands `unknown` rather than `bond`. It is then flagged rather
  // than silently mispriced, and a manual classification is never overwritten.
  if (price === 1) {
    return {
      ...CLASSES.UNKNOWN,
      price_basis: 'par',
      classification_source: 'inferred',
      reason: 'held at par (price exactly 1.00) — priceable but not identifiable',
    };
  }

  // A CUSIP-shaped identifier whose name repeats it — the live signature of a
  // bond or brokered CD, which arrive with no issuer, coupon or maturity.
  //
  // All three conditions are required and none is sufficient alone. In
  // particular a valid checksum does NOT mean "bond": the check space is one
  // digit, so about one in ten arbitrary 9-character strings passes, and
  // `FDIC91125` is a measured example that does.
  if (/^[0-9A-Z]{9}$/.test(symbol) && !/^[A-Z]{9}$/.test(symbol) && name === symbol && isValidCusip(symbol)) {
    // Which of the two bond conventions, decided by the PRICE's magnitude —
    // the only thing that distinguishes them. Measured ranges on the live
    // portfolio: percent-of-par 77.92–103.07, fraction-of-par 0.9873–1.0002.
    // A price below 10 cannot be a percent of par for anything but a defaulted
    // instrument, and one above 10 cannot be a fraction.
    const percentOfPar = price !== null && Number.isFinite(price) && price >= 10;
    return {
      ...(percentOfPar ? CLASSES.BOND_PERCENT : CLASSES.BOND_FRACTION),
      classification_source: 'inferred',
      reason: percentOfPar
        ? 'CUSIP-shaped, self-named, valid checksum; price is a percent of par'
        : 'CUSIP-shaped, self-named, valid checksum; price is a fraction of par',
    };
  }

  // A US open-end mutual fund: five letters ending in X, the long-standing
  // convention (money-market funds are a subset and were caught above). The
  // measured portfolio holds $147,988 of one, which the pre-075 vocabulary could
  // not express at all.
  //
  // The basis is still per-share — a fund has a NAV per share — so this changes
  // what the instrument is CALLED, not how it is valued. It matters anyway,
  // because a fund priced by daily NAV will never return an intraday quote, and
  // the difference between "no quote because it is a fund" and "no quote because
  // the lookup is broken" is the difference between a fact and a defect.
  if (/^[A-Z]{4}X$/.test(symbol) || /^[A-Z]{4}[A-Z]X$/.test(symbol)) {
    return {
      asset_class: 'mutual_fund',
      price_basis: 'per_share',
      quantity_unit: 'shares',
      classification_source: 'inferred',
      reason: 'five-letter ticker ending in X — US open-end fund convention',
    };
  }

  // A plain listed ticker. Deliberately NOT distinguishing stock from ETF from
  // closed-end fund: nothing in the feed does, and nothing downstream needs it.
  // Being `equity` makes a security SAFE TO PROBE for a quote — not quotable.
  // Quotability is earned by an observed quote (`quote_symbol`).
  if (/^[A-Z]{1,5}$/.test(symbol) && !MMF_TICKERS.has(symbol)) {
    return { ...CLASSES.EQUITY, classification_source: 'inferred', reason: 'listed ticker shape' };
  }

  return { ...CLASSES.UNKNOWN, classification_source: 'inferred', reason: 'no rule matched' };
}

/**
 * The quote feed's symbol is not always the custodian's.
 *
 * Measured: the custodian reports `BRKB`; the quote endpoint returns empty for
 * `BRKB` and a price for `BRK.B`. That is real money silently unquoted, and a
 * missing quote looks exactly like a market that did not move.
 *
 * ⚠️ Returns a CANDIDATE to try, never a stored fact. `securities.quote_symbol`
 * is written only once a quote actually comes back for it.
 */
function quoteSymbolCandidates(symbol) {
  const s = String(symbol || '').trim().toUpperCase();
  if (!/^[A-Z]{1,6}$/.test(s)) return [];
  const out = [s];
  // Share-class suffixes: BRKB -> BRK.B, BFB -> BF.B. Only for 4-5 char symbols
  // ending in a single class letter, and only as a fallback after the plain form.
  if (/^[A-Z]{4,5}$/.test(s) && /[AB]$/.test(s)) {
    out.push(`${s.slice(0, -1)}.${s.slice(-1)}`);
  }
  return out;
}

module.exports = {
  classify,
  isValidCusip,
  quoteSymbolCandidates,
  MMF_TICKERS,
  CLASSES,
};
