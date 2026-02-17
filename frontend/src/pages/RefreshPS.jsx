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
    sortConfig,
    sortedTransactions: sortedReviewTransactions,
    handleSort,
  } = useTransactionSelection(reviewTransactions);

  // Inline edit state for Description
  const [editingDescription, setEditingDescription] = useState(null); // { rowId, entry }
  const [descriptionValue, setDescriptionValue] = useState("");
  const [isSavingDescription, setIsSavingDescription] = useState(false);

  // Inline edit state for Category
  const [editingCategory, setEditingCategory] = useState(null); // { rowId, entry }
  const [isSavingCategory, setIsSavingCategory] = useState(false);

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
    setEditingCategory({ rowId, entry });
  }, []);

  const handleCategoryCancel = useCallback(() => {
    setEditingCategory(null);
  }, []);

  const handleCategorySelect = useCallback(async (selected) => {
    if (!editingCategory) return;
    const picked = selected.length > 0 ? selected[selected.length - 1] : "";
    if (!picked) return;
    const { entry } = editingCategory;
    const id = entry?.id ?? entry?._id;
    if (!id) return;
    setIsSavingCategory(true);
    try {
      const response = await fetch(
        Rest.buildUrl(`${reviewConfig.endpoint}/${id}`),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ Category: picked }),
        }
      );
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || "Failed to update category");
      }
      setEditingCategory(null);
      showSuccess("Category updated");
      await loadReviewTransactions();
    } catch (err) {
      showErrorToast(err?.message ?? "Failed to update category");
    } finally {
      setIsSavingCategory(false);
    }
  }, [editingCategory, loadReviewTransactions, showSuccess, showErrorToast]);

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
      const results = await Promise.all(
        unacceptedIds.map((id) =>
          fetch(Rest.buildUrl(`${reviewConfig.endpoint}/${id}`), {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ accepted: true }),
          })
        )
      );
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
  }, [reviewTransactions, loadReviewTransactions, showSuccess, showErrorToast]);

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
              showSelection={false}
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
                  <h3>Select Category</h3>
                  {isSavingCategory && (
                    <p className="trans-budget-edit-modal__count">Saving…</p>
                  )}
                  {plTree?.length > 0 ? (
                    <CategorySelector
                      plTree={plTree}
                      selectedCategories={
                        editingCategory.entry.Category
                          ? [editingCategory.entry.Category]
                          : []
                      }
                      onCategoriesChange={handleCategorySelect}
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
