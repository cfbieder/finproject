'use strict';
/**
 * risk.js — CR093 P2. What this portfolio is CONCENTRATED in.
 *
 * P1 answers "what am I exposed to" as a distribution. This asks the sharper
 * question a distribution cannot: how much rests on ONE thing.
 *
 * ⚠️ THE BIG HONEST LIMIT, and the page leads with it rather than footnoting it:
 * this is concentration by HOLDING and by ISSUER, **not by underlying company**.
 * CR093 §1 decision 2 bought fund look-through at the level of sector weights,
 * not constituents — so SPY, QQQ, DIA and FBCG all hold the same mega-caps and
 * that overlap cannot be computed from anything fin has. A page that ranked
 * "largest positions" while silently omitting the Apple inside four funds would
 * be answering a different question from the one it appears to answer.
 *
 * ⚠️ AND CONCENTRATION IS NOT RISK BY ITSELF. A single Treasury at 40% is a
 * different proposition from a single small-cap at 40%. The page ranks and
 * measures; it does not score.
 */

const db = require('../v2/db');

/** FDIC's standard maximum deposit insurance amount, per depositor, per insured
 *  bank, per ownership category. Unchanged since 2008. */
const FDIC_LIMIT = 250000;

/**
 * The issuer behind a bond or CD, taken from the name the custodian prints.
 *
 * ⚠️ DERIVED, AND THEREFORE SHOWN. Every issuer row on the page lists the
 * holdings that were grouped into it, because this is a string heuristic over
 * custodian names and the reader must be able to see what it did. A silent
 * grouping that merges two unrelated issuers — or splits one — would present a
 * concentration figure nobody can check.
 *
 * The cut is at the first INSTRUMENT-TYPE token, which is where a custodian name
 * stops naming the borrower and starts describing the paper:
 *   `WELLS FARGO BANK NATL ASSN CD 4.15000% 06/12/2028` → `WELLS FARGO BANK NATL ASSN`
 *   `IBM INTL CAP PTE LTD NOTE CALL MAKE WHOLE 02/05/31` → `IBM INTL CAP PTE LTD`
 *   `DEUTSCHE BK AG SER E NOTE 10/16/34`                 → `DEUTSCHE BK AG`
 *
 * ⚠️ IT DELIBERATELY DOES NOT MERGE CORPORATE FAMILIES. `UBS BK USA NATL ASSN`
 * and `UBS AG` stay apart: they are different legal entities, only the first is
 * an FDIC-insured bank, and merging them would be wrong for the insurance
 * question even where it might be arguable for the credit one. Splitting is the
 * safe direction — it understates concentration rather than inventing it — and
 * the holdings are listed so a reader can merge them by eye.
 */
const INSTRUMENT_TOKEN = /\b(CD|NOTE|NOTES|MTN|BOND|BONDS|SER|DEB|CTF|SR|SUB)\b/;

/** A money-market fund, by the names this custodian prints. Recognised so it can
 *  be EXCLUDED from the insured total and said out loud, not so it can be
 *  quietly dropped. */
const MONEY_MARKET_NAME = /MONEY\s*MARKET|MMKT|CASH\s+RESERVES|GOVERNMENT\s+MONEY/i;

function issuerOf(name) {
  const n = String(name || '').trim().toUpperCase();
  if (!n) return null;
  // 🔴 A holding the feed names only by an IDENTIFIER has no issuer to read, and
  // returning that identifier would invent a one-holding "issuer" — or worse, a
  // BANK — that looks like a real name. `909557MK3` is a CUSIP and `FDIC91125`
  // is a feed id (roadmap #29); the first cut of this guard matched only
  // digit-leading CUSIPs, so `FDIC91125` came back as a bank and $76,574 of
  // possible insured deposit was filed under a name that identifies nothing.
  //
  // The test is structural rather than a list: a SINGLE TOKEN CONTAINING A DIGIT
  // is an identifier. Every real issuer name here carries a space.
  if (!/\s/.test(n) && /\d/.test(n)) return null;
  const m = n.match(INSTRUMENT_TOKEN);
  const head = (m ? n.slice(0, m.index) : n).trim();
  // Guard against a name that STARTS with an instrument token, which would
  // otherwise yield an empty issuer.
  return head.length >= 3 ? head : null;
}

/**
 * The bank holding an FDIC-insured deposit.
 *
 * A brokered CD names the bank first, so `issuerOf` finds it. A sweep names it
 * mid-string — `FDIC INSURED DEPOSIT AT JP MORGAN BK q NOT COVERED BY SIPC` —
 * so that form is read explicitly rather than by the same prefix rule.
 */
function bankOf(name) {
  const n = String(name || '').trim().toUpperCase();
  const sweep = n.match(/FDIC\s+INSURED\s+DEPOSIT\s+AT\s+(.+?)(?:\s+Q\b|\s+NOT\s+COVERED|$)/);
  if (sweep) return sweep[1].trim();
  return issuerOf(n);
}

/**
 * Concentration, from rows already fetched. Pure — no db, no clock.
 */
function summariseRisk(positions) {
  const total = positions.reduce((a, p) => a + (Number(p.mv) || 0), 0);
  const share = (v) => (total ? v / total : 0);

  // ---- by holding -------------------------------------------------------
  const holdings = positions
    .filter((p) => Number(p.mv) > 0)
    .map((p) => ({
      security_id: p.id,
      ticker: p.ticker,
      name: p.name,
      asset_class: p.asset_class,
      is_fund: p.is_fund,
      market_value: Number(p.mv).toFixed(2),
      share: share(Number(p.mv)),
    }))
    .sort((a, b) => Number(b.market_value) - Number(a.market_value));

  const cumulative = (n) => share(
    holdings.slice(0, n).reduce((a, h) => a + Number(h.market_value), 0),
  );

  // ---- by issuer --------------------------------------------------------
  // ⚠️ Funds are EXCLUDED, not folded in under their sponsor. The issuer of SPY
  // is State Street, but the credit and business risk of SPY is its hundreds of
  // constituents — filing $533,703 of FLDR under "Fidelity" would name a risk
  // that does not exist and hide the one that does.
  const byIssuer = new Map();
  const noIssuer = [];
  for (const p of positions) {
    const mv = Number(p.mv) || 0;
    if (mv <= 0) continue;
    if (p.is_fund) continue;
    const issuer = issuerOf(p.name);
    if (!issuer) { noIssuer.push({ security_id: p.id, name: p.name, market_value: mv.toFixed(2) }); continue; }
    if (!byIssuer.has(issuer)) byIssuer.set(issuer, { issuer, mv: 0, holdings: [] });
    const g = byIssuer.get(issuer);
    g.mv += mv;
    g.holdings.push({ security_id: p.id, ticker: p.ticker, name: p.name, market_value: mv.toFixed(2) });
  }

  const issuers = [...byIssuer.values()]
    .map((g) => ({
      issuer: g.issuer,
      market_value: g.mv.toFixed(2),
      share: share(g.mv),
      count: g.holdings.length,
      holdings: g.holdings.sort((a, b) => Number(b.market_value) - Number(a.market_value)),
    }))
    .sort((a, b) => Number(b.market_value) - Number(a.market_value));

  // ---- FDIC insurance ---------------------------------------------------
  // 🔴 The one place on this page where a real LIMIT exists to be measured
  // against, rather than a distribution to be described.
  const byBank = new Map();
  const unattributed = [];
  const moneyMarket = [];
  for (const p of positions) {
    const mv = Number(p.mv) || 0;
    if (mv <= 0) continue;

    // 🔴 A MONEY-MARKET FUND IS NOT AN INSURED DEPOSIT. SPAXX, FDRXX and FZDXX
    // are securities: they sit beside the deposits in a Core Account, they are
    // both called "cash", and only one of the two is FDIC-insured. Leaving them
    // out silently would let the reader assume the omission meant "fine";
    // naming them is the whole point.
    if (p.price_basis === 'par' && MONEY_MARKET_NAME.test(p.name || '')) {
      moneyMarket.push({ security_id: p.id, ticker: p.ticker, name: p.name, market_value: mv.toFixed(2) });
      continue;
    }

    // 🔴 A par-priced holding whose NAME identifies nothing cannot be checked
    // either way — it may be an insured deposit and we cannot say at which bank.
    // Today this is entirely roadmap issue #29: the feed renamed two sweeps to
    // numeric ids, and the new securities carry no name. Skipping them would
    // hide a hole in the insurance answer; they are listed instead.
    if (!p.fdic_insured && p.price_basis === 'par' && !bankOf(p.name)) {
      unattributed.push({ security_id: p.id, name: p.name, market_value: mv.toFixed(2) });
      continue;
    }

    if (!p.fdic_insured) continue;
    const bank = bankOf(p.name);
    if (!bank) { unattributed.push({ security_id: p.id, name: p.name, market_value: mv.toFixed(2) }); continue; }
    if (!byBank.has(bank)) byBank.set(bank, { bank, mv: 0, holdings: [] });
    const g = byBank.get(bank);
    g.mv += mv;
    g.holdings.push({ security_id: p.id, name: p.name, market_value: mv.toFixed(2), account: p.account_name });
  }

  const banks = [...byBank.values()]
    .map((g) => ({
      bank: g.bank,
      market_value: g.mv.toFixed(2),
      // ⚠️ `min(value, limit)` — the covered part, not the whole balance.
      insured: Math.min(g.mv, FDIC_LIMIT).toFixed(2),
      uninsured: Math.max(0, g.mv - FDIC_LIMIT).toFixed(2),
      headroom: Math.max(0, FDIC_LIMIT - g.mv).toFixed(2),
      over_limit: g.mv > FDIC_LIMIT,
      count: g.holdings.length,
      holdings: g.holdings.sort((a, b) => Number(b.market_value) - Number(a.market_value)),
    }))
    .sort((a, b) => Number(b.market_value) - Number(a.market_value));

  return {
    total_market_value: total.toFixed(2),
    holdings_count: holdings.length,
    by_holding: holdings,
    concentration: {
      largest: holdings[0] || null,
      top_1: cumulative(1),
      top_5: cumulative(5),
      top_10: cumulative(10),
    },
    by_issuer: issuers,
    issuer_coverage: {
      // Funds have no single issuer whose failure would matter; CUSIP-named
      // holdings have no readable name at all.
      excluded_funds_value: positions.filter((p) => p.is_fund)
        .reduce((a, p) => a + (Number(p.mv) || 0), 0).toFixed(2),
      no_issuer: noIssuer.sort((a, b) => Number(b.market_value) - Number(a.market_value)),
      no_issuer_value: noIssuer.reduce((a, r) => a + Number(r.market_value), 0).toFixed(2),
    },
    fdic: {
      limit: FDIC_LIMIT,
      banks,
      total_uninsured: banks.reduce((a, b) => a + Number(b.uninsured), 0).toFixed(2),
      over_limit_count: banks.filter((b) => b.over_limit).length,
      // 🔴 A deposit whose bank cannot be read cannot be checked against the
      // limit at all. Today this is entirely caused by roadmap issue #29 — the
      // feed renamed two sweeps to numeric ids and the new securities carry no
      // name — so the insurance question has a hole the register cannot see.
      unattributed,
      unattributed_value: unattributed.reduce((a, r) => a + Number(r.market_value), 0).toFixed(2),
      // Stated, not omitted. "Cash" covers two things here and only one of them
      // is insured.
      money_market: moneyMarket.sort((a, b) => Number(b.market_value) - Number(a.market_value)),
      money_market_value: moneyMarket.reduce((a, r) => a + Number(r.market_value), 0).toFixed(2),
    },
  };
}

async function buildRisk() {
  const { rows } = await db.query(`
    WITH latest AS (
      SELECT DISTINCT ON (account_id) id, account_id FROM security_position_snapshots
       WHERE source = 'bank-feed' AND status = 'fetched'
       ORDER BY account_id, polled_on DESC)
    SELECT s.id, s.ticker, s.name, s.asset_class, s.price_basis,
           -- A fund is priced per share AND is not a single company. per_share
           -- alone would sweep in the single-name equities, so the fund flag is
           -- the asset class the classifier already decided plus the categories
           -- CR093 corrected (four bond funds that were filed as equity).
           (s.price_basis = 'per_share'
              AND (s.fund_category IS NOT NULL
                   OR EXISTS (SELECT 1 FROM security_sector_weights w WHERE w.security_id = s.id))) AS is_fund,
           COALESCE(t.fdic_insured, false) AS fdic_insured,
           SUM(p.market_value)::float AS mv
      FROM security_positions p
      JOIN latest l ON l.id = p.snapshot_id
      JOIN securities s ON s.id = p.security_id
      LEFT JOIN security_bond_terms t ON t.security_id = s.id
     WHERE p.market_value IS NOT NULL
     GROUP BY s.id, s.ticker, s.name, s.asset_class, s.price_basis, s.fund_category, t.fdic_insured`);

  // The FDIC sweeps are classed `par` and carry no bond terms, so they are not
  // flagged `fdic_insured` by migration 078 — but they ARE insured deposits and
  // they DO count against the same per-bank limit. Their names say so.
  for (const r of rows) {
    if (!r.fdic_insured && /FDIC\s+INSURED\s+DEPOSIT/i.test(r.name || '')) r.fdic_insured = true;
  }
  return summariseRisk(rows);
}

module.exports = {
  buildRisk, summariseRisk, issuerOf, bankOf, FDIC_LIMIT, MONEY_MARKET_NAME,
};
