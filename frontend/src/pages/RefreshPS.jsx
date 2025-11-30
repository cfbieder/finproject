/*************************************************************
 * RefreshPS.jsx
 * Page for refreshing PocketSmith data using API calls.
 *
 *************************************************************/

import { useCallback, useEffect, useState } from "react";
import NavigationMenu from "../components/NavigationMenu.jsx";
import UploadFeedback from "../features/UploadFeedback.jsx";
import Rest from "../js/rest.js";
import "./PageLayout.css";

export default function RefreshPS() {
  const [lastIngestStatus, setLastIngestStatus] = useState(null);
  const [lastRefreshStatus, setLastRefreshStatus] = useState(null);
  const [psDataCountStatus, setPsDataCountStatus] = useState(null);
  const [refreshStatus, setRefreshStatus] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [newTransactions, setNewTransactions] = useState([]);
  const [showNewTransactions, setShowNewTransactions] = useState(false);
  const [isLoadingNewTransactions, setIsLoadingNewTransactions] =
    useState(false);
  const [newTransactionsError, setNewTransactionsError] = useState(null);
  const [modifiedTransactions, setModifiedTransactions] = useState([]);
  const [showModifiedTransactions, setShowModifiedTransactions] =
    useState(false);
  const [isLoadingModifiedTransactions, setIsLoadingModifiedTransactions] =
    useState(false);
  const [modifiedTransactionsError, setModifiedTransactionsError] =
    useState(null);

  /***************************
   * Fetch last ingest and refresh timestamps
   **************************/

  const fetchLastIngest = useCallback(async () => {
    try {
      const appdata = await Rest.fetchJson("/api/util/getappdata");
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
      const countResult = await Rest.fetchJson("/api/psdata/count");
      const count =
        Number.isFinite(countResult?.count) && countResult.count >= 0
          ? countResult.count
          : null;
      setPsDataCountStatus({
        type: "info",
        message:
          count !== null
            ? `PS records in MongoDB: ${count}`
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
      (await Rest.fetchJson("/api/appdata/last-refresh", {
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

    try {
      const {
        mongoImportReport = 0,
        all = 0,
        mongoUpdateReport = 0,
      } = await Rest.fetchJson("/api/refresh-ps", {
        method: "POST",
      });

      const inserted = Number(mongoImportReport) || 0;
      const totalReceived = Number(all) || 0;
      const updated = Number(mongoUpdateReport) || 0;

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
      await fetchLastIngest();
    } catch (error) {
      setRefreshStatus({
        type: "error",
        message: error?.message ?? "Failed to refresh PS data.",
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  const loadNewTransactions = useCallback(async () => {
    setNewTransactionsError(null);
    setIsLoadingNewTransactions(true);
    try {
      const data = await Rest.fetchJson("/api/new-transactions");
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
      const data = await Rest.fetchJson("/api/modified-transactions");
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

  const handleToggleNewTransactions = async () => {
    const nextShow = !showNewTransactions;
    setShowNewTransactions(nextShow);
    if (nextShow) {
      await loadNewTransactions();
    }
  };

  const handleToggleModifiedTransactions = async () => {
    const nextShow = !showModifiedTransactions;
    setShowModifiedTransactions(nextShow);
    if (nextShow) {
      await loadModifiedTransactions();
    }
  };

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
    <div className="page-shell">
      <NavigationMenu />
      <main className="page-main upload-grid">
        <section className="upload-panel">
          <h1 className="page__title">Refresh PS Data</h1>
          <p className="page__description">
            Pull the latest PocketSmith transactions and sync them with your
            MongoDB store.
          </p>
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
          {showNewTransactions && (
            <div style={{ marginTop: "1.25rem" }}>
              <p style={{ fontWeight: 600, margin: "0 0 0.5rem" }}>
                New Transactions
              </p>
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
                <div
                  style={{
                    maxHeight: "320px",
                    overflowY: "auto",
                    borderRadius: "0.75rem",
                    border: "1px solid var(--border)",
                    boxShadow: "var(--shadow-soft)",
                  }}
                >
                  <table
                    className="balance-report-table"
                    style={{ margin: 0, border: "0" }}
                  >
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
                        <tr key={txn.ID ?? txn._id ?? index}>
                          <td>{formatDate(txn.Date ?? txn.date)}</td>
                          <td>
                            {txn.Description1 ??
                              txn.description1 ??
                              txn.description ??
                              ""}
                          </td>
                          <td>{formatAmount(txn.Amount ?? txn.amount)}</td>
                          <td>{txn.Currency ?? txn.currency ?? ""}</td>
                          <td>{txn.Account ?? txn.account ?? ""}</td>
                          <td>{txn.Category ?? txn.category ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          {showModifiedTransactions && (
            <div style={{ marginTop: "1.25rem" }}>
              <p style={{ fontWeight: 600, margin: "0 0 0.5rem" }}>
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
                <div
                  style={{
                    maxHeight: "320px",
                    overflowY: "auto",
                    borderRadius: "0.75rem",
                    border: "1px solid var(--border)",
                    boxShadow: "var(--shadow-soft)",
                  }}
                >
                  <table
                    className="balance-report-table"
                    style={{ margin: 0, border: "0" }}
                  >
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
                        <tr key={txn.ID ?? txn._id ?? index}>
                          <td>{formatDate(txn.Date ?? txn.date)}</td>
                          <td>
                            {txn.Description1 ??
                              txn.description1 ??
                              txn.description ??
                              ""}
                          </td>
                          <td>{formatAmount(txn.Amount ?? txn.amount)}</td>
                          <td>{txn.Currency ?? txn.currency ?? ""}</td>
                          <td>{txn.Account ?? txn.account ?? ""}</td>
                          <td>{txn.Category ?? txn.category ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </section>
        <section className="upload-panel upload-form">
          <div className="upload-form-field">
            <p>
              Kick off a refresh to download new or updated transactions and
              import them into the database.
            </p>
          </div>
          <div className="upload-actions">
            <button
              type="button"
              className="upload-submit"
              onClick={handleRefreshClick}
              disabled={isRefreshing}
            >
              {isRefreshing ? "Refreshing..." : "Refresh PS data"}
            </button>
          </div>
          <div className="upload-actions">
            <button
              type="button"
              className="upload-submit"
              onClick={handleToggleNewTransactions}
              disabled={isLoadingNewTransactions}
            >
              {isLoadingNewTransactions
                ? "Loading transactions..."
                : showNewTransactions
                ? "Hide New Transactions"
                : "Show New Transactions"}
            </button>
          </div>
          <div className="upload-actions">
            <button
              type="button"
              className="upload-submit"
              onClick={handleToggleModifiedTransactions}
              disabled={isLoadingModifiedTransactions}
            >
              {isLoadingModifiedTransactions
                ? "Loading transactions..."
                : showModifiedTransactions
                ? "Hide Modified Transactions"
                : "Show Modified Transactions"}
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
