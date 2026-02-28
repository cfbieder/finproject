/*************************************************************
 * RefreshPS.jsx
 * Page for refreshing PocketSmith data using API calls.
 *
 *************************************************************/

import { useCallback, useEffect, useState } from "react";
import UploadFeedback from "../features/Database/UploadFeedback.jsx";
import { useToast } from "../contexts";
import Rest from "../js/rest.js";
import { REVIEW_CONFIG } from "../features/Transaction/transactionConfig.js";
import { useTransactionSelection } from "../features/Transaction/hooks/useTransactionSelection.js";
import TransactionTable from "../features/Transaction/TransactionTable.jsx";
import CategorySelector from "../components/CategorySelector/CategorySelector.jsx";
import { useCoa } from "../hooks/useCoa.js";
import "./PageLayout.css";
import "./RefreshPS.css";

const reviewConfig = REVIEW_CONFIG;

export default function RefreshPS() {
  const { showSuccess, showError: showErrorToast } = useToast();
  const [lastIngestStatus, setLastIngestStatus] = useState(null);
  const [lastRefreshStatus, setLastRefreshStatus] = useState(null);
  const [psDataCountStatus, setPsDataCountStatus] = useState(null);
  const [refreshStatus, setRefreshStatus] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [newTransactions, setNewTransactions] = useState([]);
  const [isLoadingNewTransactions, setIsLoadingNewTransactions] =
    useState(false);
  const [newTransactionsError, setNewTransactionsError] = useState(null);
  const [modifiedTransactions, setModifiedTransactions] = useState([]);
  const [isLoadingModifiedTransactions, setIsLoadingModifiedTransactions] =
    useState(false);
  const [modifiedTransactionsError, setModifiedTransactionsError] =
    useState(null);
  const [daysHistory, setDaysHistory] = useState(7);

  // Active view: which table section to display (radio-style, one at a time)
  const [activeView, setActiveView] = useState("review");

  // Review & Edit state
  const [reviewTransactions, setReviewTransactions] = useState([]);
  const [isLoadingReview, setIsLoadingReview] = useState(false);
  const [reviewError, setReviewError] = useState(null);
  const [acceptingId, setAcceptingId] = useState(null);

  const { plTree } = useCoa();

  /***************************
   * Fetch last ingest and refresh timestamps
   **************************/

  const fetchLastIngest = useCallback(async () => {
    try {
      // Using v2 API (PostgreSQL)
      const appdata = await Rest.fetchJson("/api/v2/util/appdata");
      const records = Array.isArray(appdata) ? appdata : [];
      const parseDates = (field) =>
        records
          .map((item) => item?.[field])
          .map((date) => (date ? new Date(date) : null))
          .filter(
            (date) => date instanceof Date && !Number.isNaN(date.getTime())
          );
      const latestDate = (dates) =>
        dates.length === 0
          ? null
          : dates.reduce(
              (latest, current) => (current > latest ? current : latest),
              dates[0]
            );

      const latestIngest = latestDate(parseDates("lastIngest"));
      const latestRefresh = latestDate(parseDates("lastRefresh"));

      setLastIngestStatus(
        latestIngest
          ? {
              type: "info",
              message: `Last ingest: ${latestIngest.toLocaleString()}`,
            }
          : {
              type: "info",
              message: "No ingest has been recorded yet.",
            }
      );
      setLastRefreshStatus(
        latestRefresh
          ? {
              type: "info",
              message: `Last refresh: ${latestRefresh.toLocaleString()}`,
            }
          : {
              type: "info",
              message: "No refresh has been recorded yet.",
            }
      );
    } catch (error) {
      const message = error?.message ?? "Unable to load app data.";
      setLastIngestStatus({
        type: "error",
        message,
      });
      setLastRefreshStatus({
        type: "error",
        message,
      });
    }

    try {
      const countResult = await Rest.fetchJson("/api/v2/ingest-ps/psdata/count");
      const count =
        Number.isFinite(countResult?.count) && countResult.count >= 0
          ? countResult.count
          : null;
      setPsDataCountStatus({
        type: "info",
        message:
          count !== null
            ? `PS records in database: ${count}`
            : "PS record count unavailable.",
      });
    } catch (countError) {
      setPsDataCountStatus({
        type: "error",
        message: countError?.message ?? "Unable to load PS record count.",
      });
    }
  }, []);

  /***************************
   * Initial data fetch
   **************************/

  useEffect(() => {
    fetchLastIngest();
  }, [fetchLastIngest]);

  /**************************
   * Handle the change of refresh date
   **************************/
  const updateLastRefreshTimestamp = async () => {
    const { modifiedCount = 0, upsertedCount = 0 } =
      (await Rest.fetchJson("/api/v2/ingest-ps/appdata/last-refresh", {
        method: "POST",
      })) ?? {};

    return modifiedCount + upsertedCount > 0;
  };

  /**************************
   * Handle button clicks
   **************************/

  const handleRefreshClick = async () => {
    if (isRefreshing) {
      return;
    }

    setRefreshStatus({
      type: "info",
      message: "Refreshing PS data from PocketSmith...",
    });
    setIsRefreshing(true);

    const parsedDaysHistory = Number(daysHistory);
    const daysHistoryValue =
      Number.isFinite(parsedDaysHistory) && parsedDaysHistory > 0
        ? parsedDaysHistory
        : 7;

    try {
      const {
        importReport = 0,
        all = 0,
        updateReport = 0,
      } = await Rest.fetchJson("/api/v2/ingest-ps/refresh-ps", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ daysHistory: daysHistoryValue }),
      });

      const inserted = Number(importReport) || 0;
      const totalReceived = Number(all) || 0;
      const updated = Number(updateReport) || 0;

      let lastRefreshUpdated = false;
      try {
        lastRefreshUpdated = await updateLastRefreshTimestamp();
      } catch (error) {
        console.error(
          "Failed to update lastRefresh timestamp in appdata",
          error
        );
      }

      setRefreshStatus({
        type: lastRefreshUpdated ? "success" : "warning",
        message: `PS refresh complete: ${totalReceived} received, ${inserted} inserted, ${updated} updated, ${
          totalReceived - inserted - updated
        } skipped.${
          lastRefreshUpdated ? "" : " Last refresh timestamp not saved."
        }`,
      });
      showSuccess(`PS refresh complete: ${inserted} inserted, ${updated} updated`);
      await fetchLastIngest();

      // Reload the active table view with fresh data
      if (activeView === "review") await loadReviewTransactions();
      else if (activeView === "new") await loadNewTransactions();
      else if (activeView === "modified") await loadModifiedTransactions();
    } catch (error) {
      setRefreshStatus({
        type: "error",
        message: error?.message ?? "Failed to refresh PS data.",
      });
      showErrorToast(error?.message ?? "Failed to refresh PS data");
    } finally {
      setIsRefreshing(false);
    }
  };

  const loadNewTransactions = useCallback(async () => {
    setNewTransactionsError(null);
    setIsLoadingNewTransactions(true);
    try {
      const data = await Rest.fetchJson("/api/v2/ingest-ps/new-transactions");
      const parsed = Array.isArray(data)
        ? data
        : Array.isArray(data?.transactions)
        ? data.transactions
        : data
        ? [data]
        : [];
      setNewTransactions(parsed);
    } catch (error) {
      setNewTransactions([]);
      setNewTransactionsError(
        error?.message ?? "Unable to load new transactions."
      );
    } finally {
      setIsLoadingNewTransactions(false);
    }
  }, []);

  const loadModifiedTransactions = useCallback(async () => {
    setModifiedTransactionsError(null);
    setIsLoadingModifiedTransactions(true);
    try {
      const data = await Rest.fetchJson(
        "/api/v2/ingest-ps/modified-transactions"
      );
      const parsed = Array.isArray(data)
        ? data
        : Array.isArray(data?.transactions)
        ? data.transactions
        : data
        ? [data]
        : [];
      setModifiedTransactions(parsed);
    } catch (error) {
      setModifiedTransactions([]);
      setModifiedTransactionsError(
        error?.message ?? "Unable to load modified transactions."
      );
    } finally {
      setIsLoadingModifiedTransactions(false);
    }
  }, []);

  const handleViewChange = async (view) => {
    if (view === activeView) return;
    setActiveView(view);
    if (view === "new") await loadNewTransactions();
    else if (view === "modified") await loadModifiedTransactions();
    else if (view === "review") await loadReviewTransactions();
  };

  /**************************
   * Review & Edit new transactions
   **************************/

  const loadReviewTransactions = useCallback(async () => {
    setReviewError(null);
    setIsLoadingReview(true);
    try {
      const response = await Rest.fetchJson(
        "/api/v2/ingest-ps/review-new-transactions",
        { method: "POST" }
      );
      const data = response?.data ?? [];
      setReviewTransactions(data.map(reviewConfig.transformEntry));
    } catch (error) {
      setReviewTransactions([]);
      setReviewError(error?.message ?? "Unable to load review transactions.");
    } finally {
      setIsLoadingReview(false);
    }
  }, []);

  // Load review data on mount (default active view)
  useEffect(() => {
    loadReviewTransactions();
  }, [loadReviewTransactions]);

  const {
    selectedRows,
    sortConfig,
    sortedTransactions: sortedReviewTransactions,
    clearSelection,
    toggleRowSelection,
    handleSort,
  } = useTransactionSelection(reviewTransactions);

  // Inline edit state for Description
  const [editingDescription, setEditingDescription] = useState(null); // { rowId, entry }
  const [descriptionValue, setDescriptionValue] = useState("");
  const [isSavingDescription, setIsSavingDescription] = useState(false);

  // Inline edit state for Category
  const [editingCategory, setEditingCategory] = useState(null); // { rowId, entry }
  const [categoryValue, setCategoryValue] = useState("");
  const [isSavingCategory, setIsSavingCategory] = useState(false);
  const [bulkCategoryMode, setBulkCategoryMode] = useState(false);

  // Split transaction state
  const [splitTransaction, setSplitTransaction] = useState(null);
  const [splitCount, setSplitCount] = useState(2);
  const [splits, setSplits] = useState([]);
  const [isSavingSplit, setIsSavingSplit] = useState(false);

  const handleDescriptionClick = useCallback((rowId, entry) => {
    setEditingDescription({ rowId, entry });
    setDescriptionValue(entry.Description1 ?? "");
  }, []);

  const handleDescriptionCancel = useCallback(() => {
    setEditingDescription(null);
    setDescriptionValue("");
  }, []);

  const handleDescriptionSave = useCallback(async () => {
    if (!editingDescription) return;
    const { entry } = editingDescription;
    const id = entry?.id ?? entry?._id;
    if (!id) return;
    setIsSavingDescription(true);
    try {
      const response = await fetch(
        Rest.buildUrl(`${reviewConfig.endpoint}/${id}`),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ Description1: descriptionValue }),
        }
      );
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || "Failed to update description");
      }
      setEditingDescription(null);
      setDescriptionValue("");
      showSuccess("Description updated");
      await loadReviewTransactions();
    } catch (err) {
      showErrorToast(err?.message ?? "Failed to update description");
    } finally {
      setIsSavingDescription(false);
    }
  }, [editingDescription, descriptionValue, loadReviewTransactions, showSuccess, showErrorToast]);

  const handleCategoryClick = useCallback((rowId, entry) => {
    setBulkCategoryMode(false);
    setEditingCategory({ rowId, entry });
    setCategoryValue(entry.Category ?? "");
  }, []);

  const handleCategoryCancel = useCallback(() => {
    setEditingCategory(null);
    setCategoryValue("");
    setBulkCategoryMode(false);
  }, []);

  const handleCategoryChange = useCallback((selected) => {
    const picked = selected.length > 0 ? selected[selected.length - 1] : "";
    if (picked) setCategoryValue(picked);
  }, []);

  const patchInBatches = useCallback(async (ids, body, batchSize = 5) => {
    const results = [];
    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map((id) =>
          fetch(Rest.buildUrl(`${reviewConfig.endpoint}/${id}`), {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        )
      );
      results.push(...batchResults);
    }
    return results;
  }, []);

  const handleCategorySave = useCallback(async () => {
    if (!categoryValue) return;
    setIsSavingCategory(true);
    try {
      if (bulkCategoryMode) {
        const ids = Array.from(selectedRows.values())
          .map((entry) => entry?.id ?? entry?._id)
          .filter((id) => typeof id === "number");
        if (ids.length === 0) {
          showErrorToast("No valid transactions selected for category update");
          return;
        }
        const results = await patchInBatches(ids, { Category: categoryValue });
        const failCount = results.filter((r) => !r.ok).length;
        if (failCount > 0) {
          showErrorToast(`${failCount} transaction(s) failed to update category`);
        } else {
          showSuccess(`Category updated for ${ids.length} transaction(s)`);
        }
        clearSelection();
      } else {
        if (!editingCategory) return;
        const { entry } = editingCategory;
        const id = entry?.id ?? entry?._id;
        if (!id) return;
        const response = await fetch(
          Rest.buildUrl(`${reviewConfig.endpoint}/${id}`),
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ Category: categoryValue }),
          }
        );
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.error || "Failed to update category");
        }
        showSuccess("Category updated");
      }
      setEditingCategory(null);
      setCategoryValue("");
      setBulkCategoryMode(false);
      await loadReviewTransactions();
    } catch (err) {
      showErrorToast(err?.message ?? "Failed to update category");
    } finally {
      setIsSavingCategory(false);
    }
  }, [bulkCategoryMode, editingCategory, categoryValue, selectedRows, clearSelection, patchInBatches, loadReviewTransactions, showSuccess, showErrorToast]);

  /**************************
   * Accept transactions
   **************************/

  const handleAcceptClick = useCallback(async (rowId, entry) => {
    const id = entry?.id ?? entry?._id;
    if (!id || typeof id !== "number") {
      showErrorToast("Cannot accept: transaction not yet synced to database");
      return;
    }
    setAcceptingId(id);
    try {
      const response = await fetch(
        Rest.buildUrl(`${reviewConfig.endpoint}/${id}`),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accepted: true }),
        }
      );
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || "Failed to accept transaction");
      }
      showSuccess("Transaction accepted");
      await loadReviewTransactions();
    } catch (err) {
      showErrorToast(err?.message ?? "Failed to accept transaction");
    } finally {
      setAcceptingId(null);
    }
  }, [loadReviewTransactions, showSuccess, showErrorToast]);

  const handleAcceptAll = useCallback(async () => {
    const unacceptedIds = reviewTransactions
      .map((t) => t.id)
      .filter((id) => typeof id === "number");
    if (unacceptedIds.length === 0) {
      showErrorToast("No transactions to accept");
      return;
    }
    setAcceptingId("all");
    try {
      const results = await patchInBatches(unacceptedIds, { accepted: true });
      const failCount = results.filter((r) => !r.ok).length;
      if (failCount > 0) {
        showErrorToast(`${failCount} transaction(s) failed to accept`);
      } else {
        showSuccess(`${unacceptedIds.length} transaction(s) accepted`);
      }
      await loadReviewTransactions();
    } catch (err) {
      showErrorToast(err?.message ?? "Failed to accept all transactions");
    } finally {
      setAcceptingId(null);
    }
  }, [reviewTransactions, patchInBatches, loadReviewTransactions, showSuccess, showErrorToast]);

  /**************************
   * Split transaction
   **************************/

  const handleSplitClick = useCallback(() => {
    if (selectedRows.size !== 1) return;
    const entry = [...selectedRows.values()][0];
    const originalAmount = Number(entry.Amount);
    if (!Number.isFinite(originalAmount)) return;

    setSplitTransaction(entry);
    setSplitCount(2);
    setSplits([
      { amount: originalAmount, categoryName: entry.Category ?? "" },
      { amount: 0, categoryName: entry.Category ?? "" },
    ]);
  }, [selectedRows]);

  const handleSplitCountChange = useCallback(
    (newCount) => {
      const count = Math.max(2, Math.min(5, newCount));
      setSplitCount(count);
      setSplits((prev) => {
        const next = [];
        for (let i = 0; i < count; i++) {
          if (i < prev.length) {
            next.push(prev[i]);
          } else {
            next.push({ amount: 0, categoryName: splitTransaction?.Category ?? "" });
          }
        }
        return next;
      });
    },
    [splitTransaction]
  );

  const handleSplitAmountChange = useCallback((index, value) => {
    setSplits((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], amount: value };
      return next;
    });
  }, []);

  const handleSplitCategoryChange = useCallback((index, selected) => {
    const categoryName = selected.length > 0 ? selected[selected.length - 1] : "";
    setSplits((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], categoryName };
      return next;
    });
  }, []);

  const handleSplitSave = useCallback(async () => {
    if (!splitTransaction) return;
    const id = splitTransaction.id ?? splitTransaction._id;
    if (!id || typeof id !== "number") return;

    const originalAmount = Number(splitTransaction.Amount);
    const splitSum = splits.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
    if (Math.abs(splitSum - originalAmount) > 0.01) {
      showErrorToast("Split amounts must equal the original amount");
      return;
    }

    for (const s of splits) {
      if (!Number.isFinite(Number(s.amount)) || Number(s.amount) === 0) {
        showErrorToast("All splits must have a non-zero amount");
        return;
      }
    }

    setIsSavingSplit(true);
    try {
      const response = await fetch(
        Rest.buildUrl(`${reviewConfig.endpoint}/${id}/split`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            splits: splits.map((s) => ({
              amount: Number(s.amount),
              category_name: s.categoryName || undefined,
            })),
          }),
        }
      );
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || "Failed to split transaction");
      }
      setSplitTransaction(null);
      setSplits([]);
      clearSelection();
      showSuccess("Transaction split successfully");
      await loadReviewTransactions();
    } catch (err) {
      showErrorToast(err?.message ?? "Failed to split transaction");
    } finally {
      setIsSavingSplit(false);
    }
  }, [splitTransaction, splits, clearSelection, loadReviewTransactions, showSuccess, showErrorToast]);

  const handleSplitCancel = useCallback(() => {
    setSplitTransaction(null);
    setSplits([]);
  }, []);

  /**************************
   * Formatters for read-only tables
   **************************/

  const formatDate = (value) => {
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime())
      ? date.toLocaleDateString()
      : "";
  };

  const formatAmount = (value) => {
    const amount = Number(value);
    return Number.isFinite(amount)
      ? amount.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : "";
  };

  return (
    <>
      <main className="page-main refresh-ps-layout">
        <section className="upload-panel refresh-ps-toolbar">
          <div className="refresh-ps-toolbar__top">
            <div>
              <h1 className="refresh-ps-toolbar__title">Refresh PS Data</h1>
              <p className="refresh-ps-toolbar__desc">
                Pull the latest PocketSmith transactions and sync them with
                your database.
              </p>
            </div>
            <div className="refresh-ps-toolbar__right">
              <div className="refresh-ps-toolbar__days">
                <label htmlFor="daysHistory">Days</label>
                <input
                  id="daysHistory"
                  type="number"
                  min="1"
                  value={daysHistory}
                  onChange={(event) => setDaysHistory(event.target.value)}
                />
              </div>
              <button
                type="button"
                className="refresh-ps-btn refresh-ps-btn--action"
                onClick={handleRefreshClick}
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh PS Data"}
              </button>
            </div>
          </div>
          <ul className="upload-guidance">
            <UploadFeedback
              lastIngestStatus={lastIngestStatus}
              lastRefreshStatus={lastRefreshStatus}
              psDataCountStatus={psDataCountStatus}
              uploadStatus={refreshStatus}
              clearStatus={null}
              ingestStatus={null}
            />
          </ul>
          <div className="refresh-ps-toolbar__tabs">
            <button
              type="button"
              className={`refresh-ps-tab${activeView === "review" ? " refresh-ps-tab--active" : ""}`}
              onClick={() => handleViewChange("review")}
            >
              Review & Edit New
            </button>
            <button
              type="button"
              className={`refresh-ps-tab${activeView === "new" ? " refresh-ps-tab--active" : ""}`}
              onClick={() => handleViewChange("new")}
            >
              New Transactions
            </button>
            <button
              type="button"
              className={`refresh-ps-tab${activeView === "modified" ? " refresh-ps-tab--active" : ""}`}
              onClick={() => handleViewChange("modified")}
            >
              Modified
            </button>
          </div>
        </section>
        {activeView === "new" && (
          <section className="upload-panel refresh-ps-content">
            <p className="refresh-txn-section__title">New Transactions</p>
            {isLoadingNewTransactions ? (
              <p className="upload-feedback">Loading new transactions...</p>
            ) : newTransactionsError ? (
              <p className="upload-feedback upload-feedback_error">
                {newTransactionsError}
              </p>
            ) : newTransactions.length === 0 ? (
              <p className="upload-feedback">
                No new transactions were found in the latest import.
              </p>
            ) : (
              <div className="refresh-txn-table-wrapper">
                <table className="balance-report-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Description1</th>
                      <th>Amount</th>
                      <th>Currency</th>
                      <th>Account</th>
                      <th>Category</th>
                    </tr>
                  </thead>
                  <tbody>
                    {newTransactions.map((txn, index) => (
                      <tr key={txn.ID ?? txn.ps_id ?? txn._id ?? index}>
                        <td>{formatDate(txn.Date ?? txn.transaction_date ?? txn.date)}</td>
                        <td>
                          {txn.Description1 ??
                            txn.description1 ??
                            txn.description ??
                            ""}
                        </td>
                        <td>{formatAmount(txn.Amount ?? txn.amount)}</td>
                        <td>{txn.Currency ?? txn.currency ?? ""}</td>
                        <td>{txn.Account ?? txn.account_name ?? txn.account ?? ""}</td>
                        <td>{txn.Category ?? txn.category_name ?? txn.category ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
        {activeView === "modified" && (
          <section className="upload-panel refresh-ps-content">
            <p className="refresh-txn-section__title">
              Modified Transactions
            </p>
            {isLoadingModifiedTransactions ? (
              <p className="upload-feedback">
                Loading modified transactions...
              </p>
            ) : modifiedTransactionsError ? (
              <p className="upload-feedback upload-feedback_error">
                {modifiedTransactionsError}
              </p>
            ) : modifiedTransactions.length === 0 ? (
              <p className="upload-feedback">
                No modified transactions were found in the latest update.
              </p>
            ) : (
              <div className="refresh-txn-table-wrapper">
                <table className="balance-report-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Description1</th>
                      <th>Amount</th>
                      <th>Currency</th>
                      <th>Account</th>
                      <th>Category</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modifiedTransactions.map((txn, index) => (
                      <tr key={txn.ID ?? txn.ps_id ?? txn._id ?? index}>
                        <td>{formatDate(txn.Date ?? txn.transaction_date ?? txn.date)}</td>
                        <td>
                          {txn.Description1 ??
                            txn.description1 ??
                            txn.description ??
                            ""}
                        </td>
                        <td>{formatAmount(txn.Amount ?? txn.amount)}</td>
                        <td>{txn.Currency ?? txn.currency ?? ""}</td>
                        <td>{txn.Account ?? txn.account_name ?? txn.account ?? ""}</td>
                        <td>{txn.Category ?? txn.category_name ?? txn.category ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
        {activeView === "review" && (
          <section className="upload-panel refresh-ps-content">
            <div className="refresh-txn-section__header">
              <p className="refresh-txn-section__title">
                Review & Edit New Transactions
              </p>
              {reviewTransactions.length > 0 && (
                <div className="refresh-txn-section__actions">
                  {selectedRows.size > 0 && (
                    <button
                      type="button"
                      className="refresh-ps-btn refresh-ps-btn--bulk-category"
                      onClick={() => {
                        setBulkCategoryMode(true);
                        setCategoryValue("");
                        setEditingCategory({ rowId: null, entry: null });
                      }}
                      disabled={acceptingId != null || isSavingCategory}
                    >
                      Change Category ({selectedRows.size})
                    </button>
                  )}
                  {selectedRows.size === 1 && (
                    <button
                      type="button"
                      className="refresh-ps-btn refresh-ps-btn--split"
                      onClick={handleSplitClick}
                      disabled={acceptingId != null || isSavingSplit}
                    >
                      Split Transaction
                    </button>
                  )}
                  <button
                    type="button"
                    className="refresh-ps-btn refresh-ps-btn--accept-all"
                    onClick={handleAcceptAll}
                    disabled={acceptingId != null}
                  >
                    {acceptingId === "all" ? "Accepting..." : "Accept All"}
                  </button>
                </div>
              )}
            </div>
            <TransactionTable
              config={reviewConfig}
              isLoading={isLoadingReview}
              error={reviewError}
              hasTransactions={reviewTransactions.length > 0}
              hasFilteredTransactions={reviewTransactions.length > 0}
              sortedTransactions={sortedReviewTransactions}
              sortConfig={sortConfig}
              onSort={handleSort}
              showSelection={true}
              onRowToggle={toggleRowSelection}
              onDescriptionClick={handleDescriptionClick}
              onCategoryClick={handleCategoryClick}
              onAcceptClick={handleAcceptClick}
            />
            {editingDescription && (
              <div
                className="trans-budget-edit-modal-overlay"
                role="dialog"
                aria-modal="true"
                aria-label="Edit description"
              >
                <div className="trans-budget-edit-modal">
                  <h3>Edit Description</h3>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleDescriptionSave();
                    }}
                  >
                    <label className="trans-budget-edit-modal__field trans-budget-edit-modal__field--full-row">
                      <span>Description</span>
                      <input
                        className="form-input"
                        type="text"
                        value={descriptionValue}
                        onChange={(e) => setDescriptionValue(e.target.value)}
                        disabled={isSavingDescription}
                        autoFocus
                        autoComplete="off"
                      />
                    </label>
                    <div className="trans-budget-edit-modal__actions">
                      <button
                        className="generate-report-button"
                        type="button"
                        onClick={handleDescriptionCancel}
                        disabled={isSavingDescription}
                      >
                        Cancel
                      </button>
                      <button
                        className="generate-report-button"
                        type="submit"
                        disabled={isSavingDescription}
                      >
                        {isSavingDescription ? "Saving\u2026" : "Save"}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}
            {editingCategory && (
              <div
                className="trans-budget-edit-modal-overlay"
                role="dialog"
                aria-modal="true"
                aria-label="Select category"
              >
                <div className="trans-budget-edit-modal">
                  <h3>{bulkCategoryMode ? `Select Category for ${selectedRows.size} Transaction(s)` : "Select Category"}</h3>
                  {isSavingCategory && (
                    <p className="trans-budget-edit-modal__count">Saving…</p>
                  )}
                  {plTree?.length > 0 ? (
                    <CategorySelector
                      plTree={plTree}
                      selectedCategories={
                        categoryValue ? [categoryValue] : []
                      }
                      onCategoriesChange={handleCategoryChange}
                      categoryGroupOptions={[]}
                    />
                  ) : (
                    <p className="trans-budget-edit-modal__count">
                      Loading categories…
                    </p>
                  )}
                  <div className="trans-budget-edit-modal__actions">
                    <button
                      className="generate-report-button"
                      type="button"
                      onClick={handleCategoryCancel}
                      disabled={isSavingCategory}
                    >
                      Cancel
                    </button>
                    <button
                      className="generate-report-button"
                      type="button"
                      onClick={handleCategorySave}
                      disabled={isSavingCategory || !categoryValue}
                    >
                      {isSavingCategory ? "Saving…" : "Save"}
                    </button>
                  </div>
                </div>
              </div>
            )}
            {splitTransaction && (
              <div
                className="trans-budget-edit-modal-overlay"
                role="dialog"
                aria-modal="true"
                aria-label="Split transaction"
              >
                <div className="trans-budget-edit-modal split-modal">
                  <h3>Split Transaction</h3>
                  <div className="split-modal__summary">
                    <span><strong>Date:</strong> {formatDate(splitTransaction.Date)}</span>
                    <span><strong>Description:</strong> {splitTransaction.Description1 ?? ""}</span>
                    <span><strong>Amount:</strong> {formatAmount(splitTransaction.Amount)} {splitTransaction.Currency}</span>
                    <span><strong>Account:</strong> {splitTransaction.Account ?? ""}</span>
                  </div>
                  <label className="split-modal__count-label">
                    <span>Number of splits:</span>
                    <select
                      className="form-input split-modal__count-select"
                      value={splitCount}
                      onChange={(e) => handleSplitCountChange(Number(e.target.value))}
                      disabled={isSavingSplit}
                    >
                      {[2, 3, 4, 5].map((n) => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                  </label>
                  <div className="split-modal__entries">
                    {splits.map((split, index) => (
                      <div key={index} className="split-modal__entry">
                        <label className="split-modal__entry-label">
                          <span>Split {index + 1} Amount</span>
                          <input
                            className="form-input"
                            type="text"
                            inputMode="decimal"
                            value={split.amount}
                            onChange={(e) => {
                              const raw = e.target.value;
                              if (raw === "" || raw === "-" || raw === "." || raw === "-.") {
                                handleSplitAmountChange(index, raw);
                              } else {
                                const parsed = parseFloat(raw);
                                if (!Number.isNaN(parsed)) {
                                  handleSplitAmountChange(index, raw);
                                }
                              }
                            }}
                            disabled={isSavingSplit}
                          />
                        </label>
                        <div className="split-modal__entry-category">
                          <span>Category</span>
                          {plTree?.length > 0 ? (
                            <CategorySelector
                              plTree={plTree}
                              selectedCategories={
                                split.categoryName ? [split.categoryName] : []
                              }
                              onCategoriesChange={(selected) =>
                                handleSplitCategoryChange(index, selected)
                              }
                              categoryGroupOptions={[]}
                            />
                          ) : (
                            <p className="trans-budget-edit-modal__count">
                              Loading categories…
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  {(() => {
                    const unallocated =
                      Number(splitTransaction.Amount) -
                      splits.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
                    return (
                      <p
                        className={`split-modal__unallocated${
                          Math.abs(unallocated) > 0.01
                            ? " split-modal__unallocated--warning"
                            : ""
                        }`}
                      >
                        Unallocated: {formatAmount(unallocated)} {splitTransaction.Currency}
                      </p>
                    );
                  })()}
                  <div className="trans-budget-edit-modal__actions">
                    <button
                      className="generate-report-button"
                      type="button"
                      onClick={handleSplitCancel}
                      disabled={isSavingSplit}
                    >
                      Cancel
                    </button>
                    <button
                      className="generate-report-button"
                      type="button"
                      onClick={handleSplitSave}
                      disabled={
                        isSavingSplit ||
                        Math.abs(
                          Number(splitTransaction.Amount) -
                            splits.reduce(
                              (sum, s) => sum + (Number(s.amount) || 0),
                              0
                            )
                        ) > 0.01
                      }
                    >
                      {isSavingSplit ? "Saving\u2026" : "Save Split"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}
      </main>
    </>
  );
}
