/*************************************************************
 * RefreshPS.jsx
 * Page for refreshing PocketSmith data using API calls.
 *
 *************************************************************/

import { useCallback, useEffect, useMemo, useState } from "react";
import UploadFeedback from "../features/Database/UploadFeedback.jsx";
import { useToast } from "../contexts";
import Rest from "../js/rest.js";
import { REVIEW_CONFIG } from "../features/Transaction/transactionConfig.js";
import { normalizeStringOptions } from "../features/Transaction/transactionUtils.js";
import { useTransactionSelection } from "../features/Transaction/hooks/useTransactionSelection.js";
import { useTransactionEdit } from "../features/Transaction/hooks/useTransactionEdit.js";
import TransactionTable, {
  useTransactionCategoryOptions,
  useTransactionExchangeRates,
  computeTransactionBaseAmount,
} from "../features/Transaction/TransactionTable.jsx";
import TransactionEditModal from "../features/Transaction/TransactionEditModal.jsx";
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

  const categoryOptions = useTransactionCategoryOptions();
  const rates = useTransactionExchangeRates();
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
    selectedRows,
    sortConfig,
    sortedTransactions: sortedReviewTransactions,
    isAllSelected,
    clearSelection,
    toggleRowSelection,
    handleSort,
    handleSelectAllToggle,
  } = useTransactionSelection(reviewTransactions);

  const handleReviewEditSuccess = useCallback(async () => {
    clearSelection();
    await loadReviewTransactions();
  }, [clearSelection, loadReviewTransactions]);

  const computeBase = useCallback(
    (amount, currency, r) => computeTransactionBaseAmount(amount, currency, r),
    []
  );

  const edit = useTransactionEdit(
    reviewConfig,
    selectedRows,
    rates,
    computeBase,
    handleReviewEditSuccess
  );

  const safeCategoryOptions = useMemo(
    () =>
      normalizeStringOptions(
        categoryOptions,
        edit.editFormValues.Category ?? ""
      ),
    [categoryOptions, edit.editFormValues.Category]
  );

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
              <div className="refresh-txn-section__actions">
                <button
                  type="button"
                  className="generate-report-button"
                  onClick={handleSelectAllToggle}
                  disabled={reviewTransactions.length === 0}
                >
                  {isAllSelected ? "Deselect All" : "Select All"}
                </button>
                {selectedRows.size > 0 && (
                  <button
                    type="button"
                    className="generate-report-button"
                    onClick={edit.handleEditRequest}
                  >
                    Edit Selected ({selectedRows.size})
                  </button>
                )}
              </div>
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
              onRowToggle={toggleRowSelection}
            />
            <TransactionEditModal
              config={reviewConfig}
              isOpen={edit.showEditModal}
              selectedCount={selectedRows.size}
              isEditing={edit.isEditing}
              error={edit.editError}
              formValues={edit.editFormValues}
              categoryOptions={categoryOptions}
              accountOptions={[]}
              currencyOptions={[]}
              safeCategoryOptions={safeCategoryOptions}
              safeAccountOptions={[]}
              safeCurrencyOptions={[]}
              plTree={plTree}
              onFieldChange={edit.handleEditFieldChange}
              onCancel={edit.handleEditCancel}
              onSubmit={edit.handleEditSubmit}
            />
          </section>
        )}
      </main>
    </>
  );
}
