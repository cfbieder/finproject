/**
 * CR063 — the pure part of "move this account up/down among its siblings".
 *
 * Extracted from COAManagement.jsx so the rules can be tested without standing up
 * the page's four fetches. The rules are where the mistakes live:
 *   · siblings are rows sharing the same PARENT PATH, not adjacent rows in the
 *     flattened table (the row visually above may be a cousin, or a child of the
 *     previous sibling);
 *   · the parent is addressed by id when it has one, and by NAME when it does not
 *     — `fetchCoaSections` synthesizes the section wrapper client-side, so
 *     top-level rows (Assets, Liabilities, …) have no parent id available;
 *   · a level containing any row without a real account id cannot be reordered at
 *     all, because a short list is (correctly) rejected by the server as a stale
 *     tree rather than silently applied.
 */

/** Key identifying the sibling group a row belongs to. */
export const siblingKey = (row) => (row?.path || []).join("|");

/** All rows sharing `row`'s parent, in current display order. */
export function siblingsOf(rows, row) {
  const key = siblingKey(row);
  return (rows || []).filter((r) => siblingKey(r) === key);
}

/**
 * Work out the reorder `delta` (-1 up, +1 down) would perform.
 *
 * Returns `null` when the move is impossible — at the end of the group, the row
 * has no account id, or a sibling lacks one — so callers can use the same
 * function to disable the button and to perform the move, and the two cannot
 * disagree.
 *
 * Otherwise: `{ orderedIds, parent }`, where `parent` is `{ parentId }` or
 * `{ parentName }` ready to post.
 */
export function reorderPlan(rows, row, delta) {
  if (!row || row.accountId == null) return null;

  const siblings = siblingsOf(rows, row);
  const at = siblings.findIndex((r) => r.id === row.id);
  const to = at + delta;
  if (at < 0 || to < 0 || to >= siblings.length) return null;

  const next = [...siblings];
  [next[at], next[to]] = [next[to], next[at]];

  const orderedIds = next.map((r) => r.accountId);
  if (orderedIds.some((id) => id == null)) return null;

  const parentPath = row.path || [];
  const parentName = parentPath[parentPath.length - 1];
  if (!parentName) return null; // a true root row — nothing above it to reorder within

  const grandparentKey = parentPath.slice(0, -1).join("|");
  const parentRow = (rows || []).find(
    (r) => r.isCategory && r.name === parentName && siblingKey(r) === grandparentKey
  );

  return {
    orderedIds,
    parent:
      parentRow?.accountId != null
        ? { parentId: parentRow.accountId }
        : { parentName },
  };
}
