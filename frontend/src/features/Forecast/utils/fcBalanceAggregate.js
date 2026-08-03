/**
 * Roll a v2 balance report up to the three levels the forecast reads (CR067 P2).
 *
 * Lifted VERBATIM out of `useBaseYearBalanceSheet` — the logic is unchanged and that hook
 * still owns the fetching. It moved here because Multi-Compare loads N scenarios through
 * `useQueries` and cannot call a hook per scenario; the alternative was a second copy of this
 * walk, which is how two readers of the same report start disagreeing.
 *
 * `level1`/`level2` come from the FC balance-account mapping where one exists, falling back to
 * the report's own tree path; `level3` is the leaf account itself.
 */
export function aggregateBalanceReport(report, balanceAccountMap) {
  const level1 = new Map();
  const level2 = new Map();
  const level3 = new Map();
  let assetTotal = 0;
  let liabilityTotal = 0;

  const walk = (nodes, path = []) => {
    if (!Array.isArray(nodes)) return;

    for (const node of nodes) {
      if (!node || typeof node !== "object") continue;

      const name = node.name;
      const children = Array.isArray(node.children) ? node.children : [];
      const newPath = [...path, name].filter(Boolean);

      // Recurse into children first
      if (children.length > 0) {
        walk(children, newPath);
        continue;
      }

      // Process leaf nodes
      const total = Number(node.totalUSD ?? 0);
      const mapping = balanceAccountMap?.get(name);
      const l1 = mapping?.level1 || newPath[0];
      const l2 = mapping?.level2 || newPath[1];

      if (name) {
        level3.set(name, (level3.get(name) ?? 0) + total);
      }
      if (l1) {
        level1.set(l1, (level1.get(l1) ?? 0) + total);
        if (l1 === "Assets") {
          assetTotal += total;
        } else if (l1 === "Liabilities") {
          liabilityTotal += total;
        }
      }
      if (l2) {
        level2.set(l2, (level2.get(l2) ?? 0) + total);
      }
    }
  };

  const nodes = Array.isArray(report)
    ? report
    : Array.isArray(report?.["Balance Sheet Accounts"])
    ? report["Balance Sheet Accounts"]
    : [];

  walk(nodes, []);

  if (assetTotal) {
    level1.set("Assets", assetTotal);
  }
  if (liabilityTotal) {
    level1.set("Liabilities", liabilityTotal);
  }

  return { level1, level2, level3 };
}
