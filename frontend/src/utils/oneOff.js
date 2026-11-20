// One-offs sit below the line on every P&L (owner, 2026-11-20): the net is shown before them, then
// them, then the net. They are the `One-Off Items` forecast line and the category of the same name.
// Matched by name, tolerant of the spelling — the server's twin is server/src/utils/oneOff.js.
export const isOneOffName = (name) => /\bone[\s-]?off\b/i.test(String(name || ""));

/**
 * Budget Analysis: Expense's one-off category is lifted to its own top-level section right after
 * Expense. Expense, and the Income + Expense net, then read before one-offs; the page adds them
 * back for the final net. Values resolve by leaf name, so the move changes no figure — only where
 * the section sits.
 */
export const liftOneOffs = (nodes) => (nodes || []).flatMap((node) => {
  if (node?.name !== "Expense" || !Array.isArray(node.children)) return [node];
  const oneOffs = node.children.filter((c) => isOneOffName(c?.name));
  if (!oneOffs.length) return [node];
  return [{ ...node, children: node.children.filter((c) => !isOneOffName(c?.name)) }, ...oneOffs];
});

/** The lifted one-off sections' total, through the page's own value resolver. */
export const oneOffTotal = (nodes, resolver) => {
  if (typeof resolver !== "function" || !Array.isArray(nodes)) return 0;
  return nodes
    .filter((n) => n && isOneOffName(n.name))
    .reduce((sum, n) => {
      const v = Number(resolver(n, n.name));
      return Number.isFinite(v) ? sum + v : sum;
    }, 0);
};
