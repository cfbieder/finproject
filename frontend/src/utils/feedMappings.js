/**
 * Bank Feed Setup — who a connection is, and what a reconnect may have done.
 * CR091 U1 + P3.
 *
 * U1: three Wise connections rendered as three identical `Wise · NORDIGEN · 1`
 * rows, so after re-authorising one there was no telling which. A connection is
 * identified by the accounts it carries — mapped fin account and currency, or
 * the feed account's own name when unmapped.
 *
 * P3, stateless by owner decision (2026-09-14) rather than the snapshot-at-mint
 * the CR proposed: every case can be read off live data on each load, whichever
 * device finished the reconnect.
 *   - disappeared: a mapping pointing at a feed account that is gone — already
 *     reported as orphaned mappings (CR060);
 *   - appeared: a feed account that is neither mapped nor ignored — it is never
 *     imported until someone decides;
 *   - duplicated: an appeared account with the SAME name and currency as a
 *     mapped one. That is the 2026-09-04 Wise case (CR091 U3): the consent is a
 *     single-select of balances, the reconnect attached USD (1446) under a new
 *     id, and the same real account existed twice upstream with identical names.
 *     Prod carries it as mapping id 708, ignored — so an ignored row is resolved
 *     and never flagged.
 * Not detectable statelessly: pairing an orphaned mapping with its replacement,
 * because fin stores only the old feed id, not its name.
 */

const keyOf = (m) =>
  `${String(m.name || "").trim().toLowerCase()}|${String(m.currency || "").trim().toUpperCase()}`;

const isMapped = (m) => !!m.mapped_account_id && !m.ignored;
const isUnmapped = (m) => !m.mapped_account_id && !m.ignored;

/** One account as it identifies its connection. */
export function accountLabel(m) {
  const feed = m.name || m.external_id;
  const ccy = m.currency || "?";
  if (isMapped(m)) return `${m.mapped_account_name || feed} (${ccy})`;
  if (m.ignored) return `ignored: ${feed} (${ccy})`;
  return `unmapped: ${feed} (${ccy})`;
}

/**
 * Mapping rows grouped by upstream connection id. `accountsHealth` is bank-feed's
 * `upstream.accounts_health`, keyed by the same feed account id the mappings use.
 */
export function accountsByConnection(mappings, accountsHealth) {
  const out = new Map();
  if (!mappings || !accountsHealth) return out;
  for (const m of mappings) {
    const cid = accountsHealth[m.external_id]?.connection_id;
    if (!cid) continue;
    if (!out.has(cid)) out.set(cid, []);
    out.get(cid).push(m);
  }
  return out;
}

/** Feed accounts that are neither mapped nor ignored — never imported. */
export function unmappedAccounts(mappings) {
  return (mappings || []).filter(isUnmapped);
}

/**
 * Unmapped feed accounts carrying the same name and currency as a mapped one:
 * the shape a reconnect leaves when it attaches an already-fed account under a
 * new id. Returns `[{ pending, mapped }]`.
 */
export function findReconnectDuplicates(mappings) {
  if (!mappings) return [];
  const mappedByKey = new Map();
  for (const m of mappings) {
    if (isMapped(m) && !mappedByKey.has(keyOf(m))) mappedByKey.set(keyOf(m), m);
  }
  return mappings
    .filter((m) => isUnmapped(m) && mappedByKey.has(keyOf(m)))
    .map((m) => ({ pending: m, mapped: mappedByKey.get(keyOf(m)) }));
}
