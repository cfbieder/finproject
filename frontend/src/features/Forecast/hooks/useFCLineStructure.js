import { useEffect, useState } from "react";
import Rest from "../../../js/rest.js";

/**
 * Loads FC Lines grouped as Income/Expense for the Review page P&L section.
 * Replaces COA-based cash flow accounts with FC Line-based structure.
 *
 * Returns:
 * - cashAccounts: array of { label, level } rows for P&L display
 * - cashAccountMap: Map<fcLineName, { level1, level2 }> for entry mapping
 */
export function useFCLineStructure() {
  const [cashAccounts, setCashAccounts] = useState([]);
  const [cashAccountMap, setCashAccountMap] = useState(new Map());
  // Reverse map: COA category name → FC Line name (for mapping actuals to FC Lines)
  const [categoryToLineMap, setCategoryToLineMap] = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await Rest.get("/fc-lines/review-structure");
        if (cancelled) return;

        const income = res.income || [];
        const expense = res.expense || [];

        // Build the row structure for the P&L table
        const rows = [];
        const map = new Map();
        const catMap = new Map(); // COA category → FC Line name

        // Income section
        rows.push({ label: "Income", level: 1 });
        for (const line of income) {
          rows.push({ label: line.name, level: 2 });
          map.set(line.name, { level1: "Income", level2: line.name });
          for (const cat of (line.categories || [])) {
            catMap.set(cat, line.name);
          }
        }

        // Expense section
        rows.push({ label: "Expense", level: 1 });
        for (const line of expense) {
          rows.push({ label: line.name, level: 2 });
          map.set(line.name, { level1: "Expense", level2: line.name });
          for (const cat of (line.categories || [])) {
            catMap.set(cat, line.name);
          }
        }

        // Taxes (fixed — always present, grouped under Expense).
        //
        // The engine writes its computed tax to a hardcoded `Taxes` account, so this row
        // exists whether or not an FC Line is called that. If the owner names an FC Line
        // "Taxes" — to put the budget's historical tax on the SAME row as the engine's
        // projected tax, rather than have "Tax" and "Taxes" sit one above the other — the
        // expense loop above has already pushed it. Pushing again would duplicate the row.
        map.set("Taxes", { level1: "Expense", level2: "Taxes" });
        if (!rows.some((r) => r.label === "Taxes")) {
          rows.push({ label: "Taxes", level: 2 });
        }

        // Transfers row (triggers Cash Flow / Net Cash Flow insertion via cashRowsWithNet)
        rows.push({ label: "Transfers", level: 2 });
        map.set("Transfer - Bank", { level1: "Expense", level2: "Transfers" });

        setCashAccounts(rows);
        setCashAccountMap(map);
        setCategoryToLineMap(catMap);
      } catch (err) {
        if (!cancelled) setError(err.message || "Failed to load FC Line structure");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  return { cashAccounts, cashAccountMap, categoryToLineMap, loading, error };
}
