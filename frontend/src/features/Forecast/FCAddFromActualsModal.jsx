import { useState, useEffect } from "react";
import Rest from "../../js/rest.js";

const fmt = (v) =>
  v != null
    ? Math.abs(Number(v)).toLocaleString("en-US", { maximumFractionDigits: 0 })
    : "0";

/**
 * FCAddFromActualsModal — Create forecast modules from year-end balance sheet.
 * Shows account tree with balances. User checks which accounts become modules.
 * Leaf accounts pre-selected by default. Excludes Bank Accounts and already-added accounts.
 */
export default function FCAddFromActualsModal({
  isOpen,
  onClose,
  scenario,
  onAdded,
}) {
  const [tree, setTree] = useState([]);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(new Set());
  const [baseYear, setBaseYear] = useState(new Date().getFullYear() - 1);
  const [collapsed, setCollapsed] = useState(new Set());
  const [fxRates, setFxRates] = useState({});
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    if (!isOpen || !scenario) return;
    setError("");
    loadData();
  }, [isOpen, scenario, baseYear]);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await Rest.post(
        `/forecast/modules/add-from-actuals?scenario=${encodeURIComponent(scenario)}&baseYear=${baseYear}`
      );
      setTree(data.data || []);
      setFxRates(data.fxRates || {});
      setSummary(data.summary || null);

      // Pre-select leaf accounts with non-zero balance that aren't already added
      const preSelected = new Set();
      const walk = (nodes) => {
        for (const n of nodes) {
          if (n.is_leaf && n.has_balance && !n.already_added) {
            preSelected.add(n.account_id);
          }
          if (n.children?.length) walk(n.children);
        }
      };
      walk(data.data || []);
      setSelected(preSelected);
    } catch (err) {
      setError(err.message || "Failed to load accounts");
    } finally {
      setLoading(false);
    }
  };

  // Collect all selectable nodes in a flat list (for counting)
  const flatNodes = [];
  const walkFlat = (nodes) => {
    for (const n of nodes) {
      if (!n.already_added && n.has_balance) flatNodes.push(n);
      if (n.children?.length) walkFlat(n.children);
    }
  };
  walkFlat(tree);

  const toggleSelect = (node) => {
    setSelected((prev) => {
      const next = new Set(prev);

      if (node.is_leaf) {
        // Leaf: simple toggle
        if (next.has(node.account_id)) next.delete(node.account_id);
        else next.add(node.account_id);
      } else {
        // Parent: selecting a parent means "use this as the module" (aggregated)
        // Deselect all children, select parent instead (or vice versa)
        const childIds = getAllDescendantIds(node);
        const parentSelected = next.has(node.account_id);

        if (parentSelected) {
          // Deselect parent, re-select leaf children
          next.delete(node.account_id);
          const leaves = getAllLeaves(node);
          for (const l of leaves) {
            if (l.has_balance && !l.already_added) next.add(l.account_id);
          }
        } else {
          // Select parent, deselect all children
          for (const cid of childIds) next.delete(cid);
          next.add(node.account_id);
        }
      }

      return next;
    });
  };

  const getAllDescendantIds = (node) => {
    const ids = [];
    const walk = (n) => {
      ids.push(n.account_id);
      if (n.children?.length) n.children.forEach(walk);
    };
    if (node.children?.length) node.children.forEach(walk);
    return ids;
  };

  const getAllLeaves = (node) => {
    const leaves = [];
    const walk = (n) => {
      if (n.is_leaf) leaves.push(n);
      else if (n.children?.length) n.children.forEach(walk);
    };
    walk(node);
    return leaves;
  };

  const toggleCollapse = (id) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleApply = async () => {
    if (selected.size === 0 || !scenario) return;
    setApplying(true);
    setError("");

    try {
      // Build a map of all nodes for lookup
      const nodeMap = {};
      const walkMap = (nodes) => {
        for (const n of nodes) {
          nodeMap[n.account_id] = n;
          if (n.children?.length) walkMap(n.children);
        }
      };
      walkMap(tree);

      for (const accountId of selected) {
        const node = nodeMap[accountId];
        if (!node) continue;

        const ccy = node.is_leaf ? node.currency : "USD";
        const balLc = node.balance_lc;
        const balUsd = node.balance_usd;

        // Determine module type from account_type
        const moduleType = node.account_type === "liability" ? "Liability" : "Asset";

        await Rest.fetchJson("/api/v2/forecast/modules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            Scenario: scenario,
            Account: node.account_name,
            Name: node.account_name,
            Type: moduleType,
            Currency: ccy,
            BaseDate: `${baseYear}-12-31`,
            BaseValue: balLc,
            BaseValueUSD: balUsd,
            MarketValue: balLc,
            MarketValueUSD: balUsd,
            Matched: true,
            Growth: 0,
          }),
        });
      }

      onAdded?.();
      onClose();
    } catch (err) {
      setError(err.message || "Failed to create modules");
    } finally {
      setApplying(false);
    }
  };

  if (!isOpen) return null;

  const selectedTotal = Array.from(selected).reduce((sum, id) => {
    const findNode = (nodes) => {
      for (const n of nodes) {
        if (n.account_id === id) return n;
        if (n.children?.length) {
          const found = findNode(n.children);
          if (found) return found;
        }
      }
      return null;
    };
    const node = findNode(tree);
    return sum + (node ? Math.abs(node.balance_usd) : 0);
  }, 0);

  const renderNode = (node, depth = 0) => {
    const hasChildren = node.children?.length > 0;
    const isCollapsed = collapsed.has(node.account_id);
    const isSelected = selected.has(node.account_id);
    const isDisabled = node.already_added;
    // Check if a parent of this node is selected (meaning children are covered)
    const parentCoversThis = !isSelected && !node.is_leaf && node.children?.some(c => !selected.has(c.account_id));

    return (
      <div key={node.account_id}>
        <div
          style={{
            display: "flex", alignItems: "center", gap: "0.5rem",
            padding: "0.35rem 0.5rem", paddingLeft: `${depth * 1.25 + 0.5}rem`,
            background: isSelected ? "var(--bg-highlight, #f0f4ff)" : undefined,
            opacity: isDisabled ? 0.4 : 1,
            fontSize: "0.85rem", borderBottom: "1px solid #F2F1EC",
          }}
        >
          {/* Expand/collapse toggle */}
          <span
            style={{ width: "1rem", textAlign: "center", cursor: hasChildren ? "pointer" : "default", color: "#A0AEB9", userSelect: "none" }}
            onClick={() => hasChildren && toggleCollapse(node.account_id)}
          >
            {hasChildren ? (isCollapsed ? "+" : "-") : " "}
          </span>

          {/* Checkbox */}
          <input
            type="checkbox"
            checked={isSelected}
            disabled={isDisabled}
            onChange={() => !isDisabled && toggleSelect(node)}
            title={isDisabled ? "Already added as a module" : hasChildren && !node.is_leaf ? "Select to use aggregated balance (deselects children)" : ""}
          />

          {/* Account name */}
          <span style={{ flex: 1, fontWeight: hasChildren && !node.is_leaf ? 600 : 400 }}>
            {node.account_name}
            {isDisabled && <span style={{ color: "#A0AEB9", fontSize: "0.75rem", marginLeft: "0.5rem" }}>(already added)</span>}
            {!node.is_leaf && isSelected && <span style={{ color: "#7FA37F", fontSize: "0.75rem", marginLeft: "0.5rem" }}>(aggregated)</span>}
          </span>

          {/* Currency */}
          <span style={{ width: "3rem", textAlign: "center", color: "#A0AEB9", fontSize: "0.8rem" }}>
            {node.is_leaf ? node.currency : ""}
          </span>

          {/* Balance */}
          <span style={{
            width: "7rem", textAlign: "right", fontFamily: "var(--font-mono)", fontSize: "0.8rem",
            color: node.balance_usd < -0.01 ? "var(--danger, #C0504D)" : node.balance_usd > 0.01 ? undefined : "#A0AEB9",
          }}>
            {Math.abs(node.balance_usd) > 0.01 ? (node.balance_usd < 0 ? "-" : "") + fmt(node.balance_usd) : "—"}
          </span>
        </div>

        {/* Children */}
        {hasChildren && !isCollapsed && node.children.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(15,23,42,0.6)",
        backdropFilter: "blur(6px)", display: "flex", alignItems: "center",
        justifyContent: "center", padding: "2rem", zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(750px, 96vw)", maxHeight: "90vh", background: "white",
          borderRadius: "1.25rem", boxShadow: "0 20px 60px -12px rgba(37,99,235,0.25)",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{ padding: "1.5rem 2rem", borderBottom: "1px solid #E8E6DF", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700 }}>Add from Actuals</h2>
            <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
              Select accounts to create as forecast modules. Click a parent row to use aggregated balance.
            </span>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: "1.5rem", cursor: "pointer", color: "#808E9B" }}>
            &times;
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: "1rem 2rem 0.5rem", display: "flex", gap: "1rem", alignItems: "center" }}>
          <label style={{ fontSize: "0.85rem" }}>
            Year-End Balance:
            <input
              type="number"
              value={baseYear}
              onChange={(e) => setBaseYear(Number(e.target.value))}
              style={{ marginLeft: "0.5rem", width: "5rem" }}
              className="form-input"
            />
          </label>
          <div style={{ display: "flex", gap: "0.5rem", fontSize: "0.8rem" }}>
            <button
              type="button"
              onClick={() => {
                const all = new Set();
                const walk = (nodes) => { for (const n of nodes) { if (n.is_leaf && n.has_balance && !n.already_added) all.add(n.account_id); if (n.children?.length) walk(n.children); } };
                walk(tree);
                setSelected(all);
              }}
              style={{ background: "none", border: "none", color: "var(--primary)", cursor: "pointer", padding: 0, textDecoration: "underline" }}
            >Select All</button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              style={{ background: "none", border: "none", color: "var(--primary)", cursor: "pointer", padding: 0, textDecoration: "underline" }}
            >Clear</button>
          </div>
          {summary && (
            <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginLeft: "auto" }}>
              {summary.with_balance} accounts with balance
              {summary.already_added > 0 && ` — ${summary.already_added} already added`}
            </span>
          )}
        </div>

        {error && (
          <div style={{ color: "var(--danger)", padding: "0 2rem", marginBottom: "0.5rem", fontSize: "0.85rem" }}>{error}</div>
        )}

        <div style={{ flex: 1, overflow: "auto", padding: "0.5rem 2rem 1rem" }}>
          {loading ? (
            <p>Loading accounts...</p>
          ) : tree.length === 0 ? (
            <p style={{ color: "var(--text-secondary)" }}>No balance sheet accounts found.</p>
          ) : (
            <div style={{ border: "1px solid #E8E6DF", borderRadius: "0.5rem", overflow: "hidden" }}>
              {/* Header row */}
              <div style={{
                display: "flex", alignItems: "center", gap: "0.5rem",
                padding: "0.5rem", background: "#f8fafc", fontSize: "0.75rem",
                fontWeight: 600, textTransform: "uppercase", color: "#808E9B",
                borderBottom: "1px solid #E8E6DF",
              }}>
                <span style={{ width: "1rem" }} />
                <span style={{ width: "1.2rem" }} />
                <span style={{ flex: 1 }}>Account</span>
                <span style={{ width: "3rem", textAlign: "center" }}>Ccy</span>
                <span style={{ width: "7rem", textAlign: "right" }}>Balance (USD)</span>
              </div>
              {tree.map((node) => renderNode(node, 0))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "1rem 2rem", borderTop: "1px solid #E8E6DF", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
            {selected.size} modules to create
            {selectedTotal > 0 && ` — Total: ${fmt(selectedTotal)} USD`}
          </span>
          <div style={{ display: "flex", gap: "0.75rem" }}>
            <button
              onClick={onClose}
              style={{ padding: "0.5rem 1.25rem", borderRadius: "0.5rem", border: "1px solid #D5D2C9", background: "white", cursor: "pointer" }}
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              disabled={selected.size === 0 || applying}
              style={{
                padding: "0.5rem 1.25rem", borderRadius: "0.5rem", border: "none",
                background: selected.size > 0 ? "var(--primary, #567856)" : "#A0AEB9",
                color: "white", cursor: selected.size > 0 ? "pointer" : "not-allowed", fontWeight: 600,
              }}
            >
              {applying ? "Creating..." : `Add ${selected.size} Module${selected.size !== 1 ? "s" : ""}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
