import Rest from "../../js/rest.js";

/**
 * Undo a neutralize or a transfer (POST /transactions/:id/unpair), from either leg.
 * The server restores the category and accepted flag the pairing overwrote —
 * except on a row edited since, which it only unlinks.
 */
export async function postUnpair(id) {
  const r = await fetch(Rest.buildUrl(`/api/v2/transactions/${id}/unpair`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(body?.error || "Failed to undo");
  return body?.data;
}

/** One sentence for what an unpair actually did — including what it left alone. */
export function describeUnpair(result) {
  const parts = [result?.deletedOffsetId ? "Undone — offsetting entry removed" : "Undone — pair released"];
  if (result?.keptEdits?.length) parts.push("a row you edited since was left as you set it");
  else if (result?.undid === "unrecorded") parts.push("this pair predates undo, so the category was not restored");
  return parts.join("; ");
}

/** The same, over several unpairs — every caveat counted, not just the first row's. */
export function summarizeUnpairs(results) {
  if (results.length === 1) return describeUnpair(results[0]);
  const removed = results.filter((r) => r?.deletedOffsetId).length;
  const kept = results.reduce((n, r) => n + (r?.keptEdits?.length || 0), 0);
  const unrecorded = results.filter((r) => r?.undid === "unrecorded").length;
  return [
    `Undone ${results.length} — ${removed} offsetting entr${removed === 1 ? "y" : "ies"} removed`,
    kept ? `${kept} row${kept === 1 ? "" : "s"} you edited since left as you set ${kept === 1 ? "it" : "them"}` : null,
    unrecorded ? `${unrecorded} predate${unrecorded === 1 ? "s" : ""} undo, category not restored` : null,
  ].filter(Boolean).join("; ");
}
