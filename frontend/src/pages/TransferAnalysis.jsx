import { useCallback, useEffect, useMemo, useState } from "react";
import Rest from "../js/rest.js";
import PeriodSelector from "../components/PeriodSelector/PeriodSelector.jsx";
import ConfirmModal from "../components/ConfirmModal/ConfirmModal.jsx";
import "./PageLayout.css";
import EmptyState from "../components/EmptyState.jsx";
import "./TransferAnalysis.css";

const CURRENT_YEAR = new Date().getFullYear();
const CURRENT_MONTH = String(new Date().getMonth() + 1).padStart(2, "0");

const formatDate = (value) => {
  const d = value ? new Date(value) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString() : "";
};

const formatAmount = (value) => {
  const n = Number(value);
  return Number.isFinite(n)
    ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "";
};

export default function TransferAnalysis() {
  const [period, setPeriod] = useState({
    fromMonth: CURRENT_MONTH,
    toMonth: CURRENT_MONTH,
    actualYear: CURRENT_YEAR,
  });
  const [data, setData] = useState(null);
  const [manualGroups, setManualGroups] = useState([]);
  const [periodInfo, setPeriodInfo] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expandedCategories, setExpandedCategories] = useState(new Set());

  // Selection state for manual matching
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [isLinking, setIsLinking] = useState(false);

  // Category change modal state
  const [categoryModal, setCategoryModal] = useState({
    isOpen: false,
    transactionIds: [],
    currentCategory: "",
    newCategoryId: "",
  });
  const [transferCategories, setTransferCategories] = useState([]);
  const [isSavingCategory, setIsSavingCategory] = useState(false);

  // Fetch transfer categories on mount
  useEffect(() => {
    Rest.fetchJson("/api/v2/categories?includeTransfers=true&activeOnly=true")
      .then((res) => {
        const cats = (res?.data ?? []).filter((c) => c.is_transfer);
        setTransferCategories(cats);
      })
      .catch(() => {});
  }, []);

  const handlePeriodChange = useCallback((values) => {
    setPeriod((prev) => ({ ...prev, ...values }));
  }, []);

  const handleGenerate = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setSelectedIds(new Set());
    try {
      const params = new URLSearchParams();
      params.set("year", period.actualYear);
      // If fromMonth === toMonth, send a single month; otherwise send full year
      if (period.fromMonth === period.toMonth) {
        params.set("month", parseInt(period.fromMonth));
      }
      const result = await Rest.fetchJson(
        `/api/v2/transactions/transfer-analysis?${params.toString()}`
      );
      setData(result.data);
      setManualGroups(result.manualGroups || []);
      setPeriodInfo(result.period);
      // Expand all categories by default
      if (result.data) {
        const keys = Object.keys(result.data);
        if (result.manualGroups?.length > 0) keys.push("__manual__");
        setExpandedCategories(new Set(keys));
      }
    } catch (err) {
      setError(err?.message ?? "Failed to load transfer analysis");
      setData(null);
      setManualGroups([]);
      setPeriodInfo(null);
    } finally {
      setIsLoading(false);
    }
  }, [period]);

  const toggleCategory = useCallback((category) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }, []);

  const toggleSelection = useCallback((txnId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(txnId)) next.delete(txnId);
      else next.add(txnId);
      return next;
    });
  }, []);

  const handleLinkSelected = useCallback(async () => {
    if (selectedIds.size < 2) return;
    setIsLinking(true);
    setError(null);
    try {
      await Rest.fetchJson("/api/v2/transfer-match-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionIds: [...selectedIds] }),
      });
      setSelectedIds(new Set());
      // Re-run analysis to reflect the change
      await handleGenerate();
    } catch (err) {
      setError(err?.message ?? "Failed to link transactions");
    } finally {
      setIsLinking(false);
    }
  }, [selectedIds, handleGenerate]);

  const handleUnlinkGroup = useCallback(
    async (groupId) => {
      setError(null);
      try {
        await Rest.fetchJson(`/api/v2/transfer-match-groups/${groupId}`, {
          method: "DELETE",
        });
        // Re-run analysis to reflect the change
        await handleGenerate();
      } catch (err) {
        setError(err?.message ?? "Failed to unlink group");
      }
    },
    [handleGenerate]
  );

  const openCategoryModal = useCallback((transactionIds, currentCategory) => {
    setCategoryModal({
      isOpen: true,
      transactionIds,
      currentCategory,
      newCategoryId: "",
    });
  }, []);

  const closeCategoryModal = useCallback(() => {
    setCategoryModal({ isOpen: false, transactionIds: [], currentCategory: "", newCategoryId: "" });
  }, []);

  const handleCategoryChange = useCallback(async () => {
    const { transactionIds, newCategoryId } = categoryModal;
    if (!newCategoryId || transactionIds.length === 0) return;
    setIsSavingCategory(true);
    setError(null);
    try {
      await Promise.all(
        transactionIds.map((id) =>
          Rest.updateTransactionV2(id, { category_id: parseInt(newCategoryId) })
        )
      );
      closeCategoryModal();
      await handleGenerate();
    } catch (err) {
      setError(err?.message ?? "Failed to change transfer type");
    } finally {
      setIsSavingCategory(false);
    }
  }, [categoryModal, closeCategoryModal, handleGenerate]);

  // ─── Remove orphan offset ───
  // An UNMATCHED `auto-offset` row is a spurious neutralize-mirror (its real leg
  // got paired elsewhere). Deleting it is the safe cleanup; confirmed first.
  const [removeConfirm, setRemoveConfirm] = useState(null); // {id, message}
  const [isRemoving, setIsRemoving] = useState(false);

  const doRemoveOrphan = useCallback(async () => {
    const id = removeConfirm?.id;
    if (!id) return;
    setIsRemoving(true);
    setError(null);
    try {
      await Rest.deleteTransactionV2(id);
      setRemoveConfirm(null);
      await handleGenerate();
    } catch (err) {
      setError(err?.message ?? "Failed to remove orphan entry");
    } finally {
      setIsRemoving(false);
    }
  }, [removeConfirm, handleGenerate]);

  // ─── Neutralize a genuine unmatched leg ───
  // For a real (non-auto-offset) unmatched securities-trade leg, create its
  // offsetting "Transfer - Securities Trades" entry (the backend pairs with an
  // existing leg if one turns up, else inserts the offset). Safe here because
  // the row is, by definition, unmatched.
  const [neutralizeConfirm, setNeutralizeConfirm] = useState(null); // {id, message}
  const [isNeutralizing, setIsNeutralizing] = useState(false);

  const doNeutralizeLeg = useCallback(async () => {
    const id = neutralizeConfirm?.id;
    if (!id) return;
    setIsNeutralizing(true);
    setError(null);
    try {
      const r = await fetch(Rest.buildUrl(`/api/v2/transactions/${id}/neutralize`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!r.ok) {
        const b = await r.json().catch(() => null);
        throw new Error(b?.error || "Failed to neutralize");
      }
      setNeutralizeConfirm(null);
      await handleGenerate();
    } catch (err) {
      setError(err?.message ?? "Failed to neutralize");
    } finally {
      setIsNeutralizing(false);
    }
  }, [neutralizeConfirm, handleGenerate]);

  // Compute net base_amount of selected transactions
  const selectedNet = useMemo(() => {
    if (!data || selectedIds.size === 0) return 0;
    let net = 0;
    for (const cat of Object.values(data)) {
      for (const txn of cat.unmatched) {
        if (selectedIds.has(txn.id)) {
          net += parseFloat(txn.base_amount) || 0;
        }
      }
    }
    return net;
  }, [data, selectedIds]);

  const summary = useMemo(() => {
    if (!data) return null;
    let totalMatched = 0;
    let totalUnmatched = 0;
    let matchedPairs = 0;
    let unmatchedCount = 0;
    for (const cat of Object.values(data)) {
      matchedPairs += cat.matchedCount;
      unmatchedCount += cat.unmatchedCount;
      totalMatched += cat.matchedTotal;
      totalUnmatched += cat.unmatchedTotal;
    }
    return {
      matchedPairs,
      unmatchedCount,
      totalMatched,
      totalUnmatched,
      manualGroupCount: manualGroups.length,
    };
  }, [data, manualGroups]);

  return (
    <main className="page-main transfer-analysis-main">
      <div className="transfer-analysis-controls">
        <PeriodSelector
          onChange={handlePeriodChange}
          hideBudgetYear
          defaultPreset="this-month"
        />
        <button
          className="generate-report-button"
          type="button"
          onClick={handleGenerate}
          disabled={isLoading}
        >
          {isLoading ? "Analyzing..." : "Analyze Transfers"}
        </button>
      </div>

      <div className="transfer-analysis-content">
        {error && <p className="transfer-analysis-error">{error}</p>}

        {!data && !error && !isLoading && (
          <p className="transfer-analysis-placeholder">
            Select a period and click "Analyze Transfers" to match transfer
            transactions.
          </p>
        )}

        {isLoading && (
          <p className="transfer-analysis-placeholder">Loading...</p>
        )}

        {data && summary && (
          <>
            {/* Summary cards */}
            <div className="transfer-analysis-summary">
              <div className="transfer-analysis-summary-card">
                <span className="transfer-analysis-summary-label">
                  Matched Pairs
                </span>
                <span className="transfer-analysis-summary-value">
                  {summary.matchedPairs}
                </span>
              </div>
              <div className="transfer-analysis-summary-card">
                <span className="transfer-analysis-summary-label">
                  Matched Total
                </span>
                <span className="transfer-analysis-summary-value">
                  {formatAmount(summary.totalMatched)}
                </span>
              </div>
              <div className="transfer-analysis-summary-card">
                <span className="transfer-analysis-summary-label">
                  Manual Groups
                </span>
                <span className="transfer-analysis-summary-value">
                  {summary.manualGroupCount}
                </span>
              </div>
              <div className="transfer-analysis-summary-card transfer-analysis-summary-card--warning">
                <span className="transfer-analysis-summary-label">
                  Unmatched
                </span>
                <span className="transfer-analysis-summary-value">
                  {summary.unmatchedCount}
                </span>
              </div>
              <div className="transfer-analysis-summary-card transfer-analysis-summary-card--warning">
                <span className="transfer-analysis-summary-label">
                  Unmatched Net
                </span>
                <span className="transfer-analysis-summary-value">
                  {formatAmount(summary.unmatchedTotal)}
                </span>
              </div>
            </div>

            {/* Floating action bar for linking */}
            {selectedIds.size >= 2 && (
              <div className="transfer-analysis-link-bar">
                <span>{selectedIds.size} transactions selected</span>
                <span className={`transfer-analysis-link-net ${Math.abs(selectedNet) < 0.01 ? "transfer-analysis-link-net--zero" : ""}`}>
                  Net: {formatAmount(selectedNet)}
                </span>
                <button
                  type="button"
                  className="transfer-analysis-link-btn"
                  onClick={handleLinkSelected}
                  disabled={isLinking}
                >
                  {isLinking ? "Linking..." : "Link as Matched"}
                </button>
                <button
                  type="button"
                  className="transfer-analysis-link-btn transfer-analysis-link-btn--secondary"
                  onClick={() => setSelectedIds(new Set())}
                >
                  Clear
                </button>
              </div>
            )}

            {/* Manual Match Groups */}
            {manualGroups.length > 0 && (
              <div className="transfer-analysis-category">
                <button
                  type="button"
                  className="transfer-analysis-category-header"
                  onClick={() => toggleCategory("__manual__")}
                >
                  <span className="transfer-analysis-category-toggle">
                    {expandedCategories.has("__manual__") ? "\u25BC" : "\u25B6"}
                  </span>
                  <span className="transfer-analysis-category-name">
                    Manually Matched Groups
                  </span>
                  <span className="transfer-analysis-category-badge transfer-analysis-category-badge--manual">
                    {manualGroups.length} group{manualGroups.length !== 1 ? "s" : ""}
                  </span>
                </button>

                {expandedCategories.has("__manual__") && (
                  <div className="transfer-analysis-category-body">
                    {manualGroups.map((group) => {
                      const debits = group.transactions.filter(
                        (t) => parseFloat(t.base_amount) < 0
                      );
                      const credits = group.transactions.filter(
                        (t) => parseFloat(t.base_amount) >= 0
                      );
                      const debitTotal = debits.reduce(
                        (s, t) => s + parseFloat(t.base_amount),
                        0
                      );
                      const creditTotal = credits.reduce(
                        (s, t) => s + parseFloat(t.base_amount),
                        0
                      );
                      return (
                        <div
                          key={group.id}
                          className="transfer-analysis-section transfer-analysis-manual-group"
                        >
                          <div className="transfer-analysis-manual-group-header">
                            <h4 className="transfer-analysis-section-title transfer-analysis-section-title--manual">
                              Group #{group.id}
                              {group.note ? ` — ${group.note}` : ""}
                            </h4>
                            <span className="transfer-analysis-manual-group-totals">
                              Debits: {formatAmount(debitTotal)} / Credits: {formatAmount(creditTotal)}
                              {" | Net: "}
                              {formatAmount(debitTotal + creditTotal)}
                            </span>
                            <button
                              type="button"
                              className="transfer-analysis-unlink-btn"
                              onClick={() => handleUnlinkGroup(group.id)}
                              title="Unlink this group"
                            >
                              Unlink
                            </button>
                          </div>
                          <table className="transfer-analysis-table">
                            <thead>
                              <tr>
                                <th>Date</th>
                                <th>Account</th>
                                <th>Description</th>
                                <th>Currency</th>
                                <th className="text-right">Amount</th>
                                <th className="text-right">Base Amount</th>
                              </tr>
                            </thead>
                            <tbody>
                              {group.transactions.map((txn) => (
                                <tr
                                  key={txn.id}
                                  className="transfer-analysis-row--clickable"
                                  onClick={() =>
                                    openCategoryModal(
                                      group.transactions.map((t) => t.id),
                                      txn.category_name || "Manual Group"
                                    )
                                  }
                                  title="Click to change transfer type for group"
                                >
                                  <td>{formatDate(txn.transaction_date)}</td>
                                  <td>{txn.account_name}</td>
                                  <td className="transfer-analysis-desc">
                                    {txn.description1}
                                  </td>
                                  <td>{txn.currency}</td>
                                  <td
                                    className={`text-right ${
                                      parseFloat(txn.amount) < 0
                                        ? "amount-negative"
                                        : "amount-positive"
                                    }`}
                                  >
                                    {formatAmount(txn.amount)}
                                  </td>
                                  <td
                                    className={`text-right ${
                                      parseFloat(txn.base_amount) < 0
                                        ? "amount-negative"
                                        : "amount-positive"
                                    }`}
                                  >
                                    {formatAmount(txn.base_amount)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Category sections */}
            {Object.entries(data).map(([category, catData]) => (
              <div key={category} className="transfer-analysis-category">
                <button
                  type="button"
                  className="transfer-analysis-category-header"
                  onClick={() => toggleCategory(category)}
                >
                  <span className="transfer-analysis-category-toggle">
                    {expandedCategories.has(category) ? "\u25BC" : "\u25B6"}
                  </span>
                  <span className="transfer-analysis-category-name">
                    {category}
                  </span>
                  <span className="transfer-analysis-category-badge">
                    {catData.matchedCount} matched
                  </span>
                  {catData.unmatchedCount > 0 && (
                    <span className="transfer-analysis-category-badge transfer-analysis-category-badge--warning">
                      {catData.unmatchedCount} unmatched
                    </span>
                  )}
                </button>

                {expandedCategories.has(category) && (
                  <div className="transfer-analysis-category-body">
                    {/* Matched pairs */}
                    {catData.matched.length > 0 && (
                      <div className="transfer-analysis-section">
                        <h4 className="transfer-analysis-section-title">
                          Matched Transfers
                        </h4>
                        <table className="transfer-analysis-table">
                          <thead>
                            <tr>
                              <th>Date (Debit)</th>
                              <th>Account (Debit)</th>
                              <th>Description</th>
                              <th className="text-right">Amount</th>
                              <th>Date (Credit)</th>
                              <th>Account (Credit)</th>
                              <th>Description</th>
                              <th className="text-right">Amount</th>
                            </tr>
                          </thead>
                          <tbody>
                            {catData.matched.map((pair, idx) => (
                              <tr
                                key={idx}
                                className="transfer-analysis-row--clickable"
                                onClick={() =>
                                  openCategoryModal(
                                    [pair.debit.id, pair.credit.id],
                                    category
                                  )
                                }
                                title="Click to change transfer type"
                              >
                                <td>{formatDate(pair.debit.transaction_date)}</td>
                                <td>{pair.debit.account_name}</td>
                                <td className="transfer-analysis-desc">
                                  {pair.debit.description1}
                                </td>
                                <td className="text-right amount-negative">
                                  {formatAmount(pair.debit.base_amount)}
                                </td>
                                <td>{formatDate(pair.credit.transaction_date)}</td>
                                <td>{pair.credit.account_name}</td>
                                <td className="transfer-analysis-desc">
                                  {pair.credit.description1}
                                </td>
                                <td className="text-right amount-positive">
                                  {formatAmount(pair.credit.base_amount)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Unmatched — with checkboxes for manual matching */}
                    {catData.unmatched.length > 0 && (
                      <div className="transfer-analysis-section">
                        <h4 className="transfer-analysis-section-title transfer-analysis-section-title--warning">
                          Unmatched Transfers
                        </h4>
                        <table className="transfer-analysis-table">
                          <thead>
                            <tr>
                              <th className="transfer-analysis-checkbox-col"></th>
                              <th>Date</th>
                              <th>Account</th>
                              <th>Description</th>
                              <th>Currency</th>
                              <th className="text-right">Amount</th>
                              <th className="text-right">Base Amount</th>
                              <th></th>
                            </tr>
                          </thead>
                          <tbody>
                            {catData.unmatched.map((txn) => (
                              <tr
                                key={txn.id}
                                className={`transfer-analysis-row--clickable ${
                                  selectedIds.has(txn.id)
                                    ? "transfer-analysis-row--selected"
                                    : ""
                                }`}
                                onClick={(e) => {
                                  // Don't open modal when clicking the checkbox
                                  if (e.target.tagName === "INPUT") return;
                                  openCategoryModal([txn.id], category);
                                }}
                                title="Click to change transfer type"
                              >
                                <td className="transfer-analysis-checkbox-col">
                                  <input
                                    type="checkbox"
                                    checked={selectedIds.has(txn.id)}
                                    onChange={() => toggleSelection(txn.id)}
                                  />
                                </td>
                                <td>{formatDate(txn.transaction_date)}</td>
                                <td>{txn.account_name}</td>
                                <td className="transfer-analysis-desc">
                                  {txn.description1}
                                </td>
                                <td>{txn.currency}</td>
                                <td
                                  className={`text-right ${
                                    parseFloat(txn.amount) < 0
                                      ? "amount-negative"
                                      : "amount-positive"
                                  }`}
                                >
                                  {formatAmount(txn.amount)}
                                </td>
                                <td
                                  className={`text-right ${
                                    parseFloat(txn.base_amount) < 0
                                      ? "amount-negative"
                                      : "amount-positive"
                                  }`}
                                >
                                  {formatAmount(txn.base_amount)}
                                </td>
                                <td className="text-right">
                                  {txn.source === "auto-offset" ? (
                                    <button
                                      type="button"
                                      className="btn btn--sm btn--danger-soft"
                                      title="This is an orphaned neutralize-mirror (its real leg paired elsewhere). Remove it."
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setRemoveConfirm({
                                          id: txn.id,
                                          message:
                                            `Remove orphaned offset entry?\n\n${txn.account_name} · ${formatDate(txn.transaction_date)}\n${txn.description1}\n${formatAmount(txn.amount)} ${txn.currency}\n\nThis is a leftover neutralize-mirror whose real offsetting leg is matched elsewhere — deleting it removes a double-count. This cannot be undone.`,
                                        });
                                      }}
                                    >
                                      Remove
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      className="btn btn--sm btn--outline"
                                      title="Neutralize: create the offsetting Transfer entry for this single leg (pairs with an existing leg if one exists)."
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setNeutralizeConfirm({
                                          id: txn.id,
                                          message:
                                            `Neutralize this unmatched leg?\n\n${txn.account_name} · ${formatDate(txn.transaction_date)}\n${txn.description1}\n${formatAmount(txn.amount)} ${txn.currency}\n\nIf an offsetting leg exists nearby it will be paired; otherwise a new "Transfer - Securities Trades" entry of ${formatAmount(-parseFloat(txn.amount))} is created to balance it.`,
                                        });
                                      }}
                                    >
                                      Neutralize
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {catData.matched.length === 0 &&
                      catData.unmatched.length === 0 && (
                        <p className="transfer-analysis-empty">
                          No transfers in this category for the selected period.
                        </p>
                      )}
                  </div>
                )}
              </div>
            ))}

            {Object.keys(data).length === 0 && manualGroups.length === 0 && (
              <EmptyState variant="wallet" message="No transfer transactions found for the selected period." />
            )}
          </>
        )}
      </div>

      {/* Change Transfer Type Modal */}
      {categoryModal.isOpen && (
        <div
          className="transfer-analysis-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Change transfer type"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeCategoryModal();
          }}
        >
          <div className="transfer-analysis-modal">
            <h3>Change Transfer Type</h3>
            <p className="transfer-analysis-modal-info">
              {categoryModal.transactionIds.length === 1
                ? "Updating 1 transaction."
                : `Updating ${categoryModal.transactionIds.length} transactions.`}
            </p>
            <p className="transfer-analysis-modal-current">
              Current: <strong>{categoryModal.currentCategory}</strong>
            </p>
            {error && <p className="transfer-analysis-modal-error">{error}</p>}
            <label className="transfer-analysis-modal-field">
              <span>New Transfer Type</span>
              <select
                className="form-input"
                value={categoryModal.newCategoryId}
                onChange={(e) =>
                  setCategoryModal((prev) => ({
                    ...prev,
                    newCategoryId: e.target.value,
                  }))
                }
                disabled={isSavingCategory}
              >
                <option value="">Select category...</option>
                {transferCategories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="transfer-analysis-modal-actions">
              <button
                className="generate-report-button"
                type="button"
                onClick={closeCategoryModal}
                disabled={isSavingCategory}
              >
                Cancel
              </button>
              <button
                className="generate-report-button"
                type="button"
                onClick={handleCategoryChange}
                disabled={isSavingCategory || !categoryModal.newCategoryId}
              >
                {isSavingCategory ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        state={removeConfirm ? { title: "Remove orphaned offset", message: removeConfirm.message, confirmLabel: "Remove", danger: true } : null}
        busy={isRemoving}
        onConfirm={doRemoveOrphan}
        onCancel={() => setRemoveConfirm(null)}
      />

      <ConfirmModal
        state={neutralizeConfirm ? { title: "Neutralize leg", message: neutralizeConfirm.message, confirmLabel: "Neutralize" } : null}
        busy={isNeutralizing}
        onConfirm={doNeutralizeLeg}
        onCancel={() => setNeutralizeConfirm(null)}
      />
    </main>
  );
}
