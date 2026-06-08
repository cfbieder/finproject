/*************************************************************
 * RefreshPS.jsx
 * Page for refreshing bank-feed data and reviewing/accepting staged transactions.
 * (The automated PocketSmith API refresh was removed in CR030.)
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
import { AccountPicker, buildHierarchyOptions } from "../components/AccountPicker/AccountPicker.jsx";
import { useCoa } from "../hooks/useCoa.js";
import "./PageLayout.css";
import EmptyState from "../components/EmptyState.jsx";
import "./RefreshPS.css";

const reviewConfig = REVIEW_CONFIG;

export default function RefreshPS() {
  const { showSuccess, showError: showErrorToast } = useToast();
  const [lastIngestStatus, setLastIngestStatus] = useState(null);
  const [lastRefreshStatus, setLastRefreshStatus] = useState(null);
  const [psDataCountStatus, setPsDataCountStatus] = useState(null);
  const [refreshStatus, setRefreshStatus] = useState(null);
  const [isRefreshingFeed, setIsRefreshingFeed] = useState(false);
  // CR022 transfer-to-account action (review queue)
  const [accountOptions, setAccountOptions] = useState([]);
  const [transferEntry, setTransferEntry] = useState(null);
  const [transferTargetId, setTransferTargetId] = useState("");
  const [isTransferring, setIsTransferring] = useState(false);
  const [isSuggesting, setIsSuggesting] = useState(false);
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
  const [groupByAccount, setGroupByAccount] = useState(false);
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
  /**************************
   * Handle button clicks
   **************************/

  // CR022: pull + promote the bank-feed (mapped accounts) into the review queue,
  // reusing the same Days window as the PS refresh.
  const handleRefreshFeedClick = async () => {
    if (isRefreshingFeed) {
      return;
    }
    setRefreshStatus({
      type: "info",
      message: "Refreshing bank-feed data...",
    });
    setIsRefreshingFeed(true);

    const parsedDays = Number(daysHistory);
    const sinceDays =
      Number.isFinite(parsedDays) && parsedDays > 0 ? parsedDays : 14;

    try {
      const res = await Rest.fetchJson("/api/v2/ingest-bank-feed/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sinceDays }),
      });
      const ing = res?.ingest ?? {};
      const syn = res?.sync ?? {};
      setRefreshStatus({
        type: "success",
        message: `Bank feed refreshed: ${syn.inserted ?? 0} new, ${syn.linked ?? 0} linked to PS, ${ing.staged ?? 0} staged, ${(syn.ignoredAccounts ?? []).length} account(s) ignored.`,
      });
      await loadReviewTransactions();
    } catch (err) {
      setRefreshStatus({
        type: "error",
        message: err?.message ?? "Failed to refresh bank-feed data",
      });
    } finally {
      setIsRefreshingFeed(false);
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

  // Inline edit state for Date
  const [editingDate, setEditingDate] = useState(null); // { rowId, entry }
  const [dateValue, setDateValue] = useState("");
  const [isSavingDate, setIsSavingDate] = useState(false);

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

  const handleDateClick = useCallback((rowId, entry) => {
    setEditingDate({ rowId, entry });
    // Convert stored date to YYYY-MM-DD for <input type="date">
    const raw = entry.Date ?? "";
    const parsed = raw ? new Date(raw) : null;
    if (parsed && Number.isFinite(parsed.getTime())) {
      const yyyy = parsed.getUTCFullYear();
      const mm = String(parsed.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(parsed.getUTCDate()).padStart(2, "0");
      setDateValue(`${yyyy}-${mm}-${dd}`);
    } else {
      setDateValue("");
    }
  }, []);

  const handleDateCancel = useCallback(() => {
    setEditingDate(null);
    setDateValue("");
  }, []);

  const handleDateSave = useCallback(async () => {
    if (!editingDate || !dateValue) return;
    const { entry } = editingDate;
    const id = entry?.id ?? entry?._id;
    if (!id) return;
    setIsSavingDate(true);
    try {
      const response = await fetch(
        Rest.buildUrl(`${reviewConfig.endpoint}/${id}`),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ Date: dateValue }),
        }
      );
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || "Failed to update date");
      }
      const result = await response.json().catch(() => null);
      setEditingDate(null);
      setDateValue("");
      if (result?.rateInfo) {
        const { implied_rate, old_base_amount, new_base_amount } = result.rateInfo;
        const rateStr = implied_rate.toFixed(4);
        const oldStr = old_base_amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const newStr = new_base_amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        showSuccess(`Date updated — USD recalculated: ${oldStr} → ${newStr} (rate ${rateStr})`);
      } else {
        showSuccess("Date updated");
      }
      await loadReviewTransactions();
    } catch (err) {
      showErrorToast(err?.message ?? "Failed to update date");
    } finally {
      setIsSavingDate(false);
    }
  }, [editingDate, dateValue, loadReviewTransactions, showSuccess, showErrorToast]);

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

  // CR022: accept only the rows from one source (PS or bank-feed) in the queue.
  // Retained for when the queue regains a second source; the per-source button
  // was removed once the bank feed became the sole source (== Accept All).
  // eslint-disable-next-line no-unused-vars
  const handleAcceptBySource = useCallback(async (source, label) => {
    const ids = reviewTransactions
      .filter((t) => t.Source === source)
      .map((t) => t.id)
      .filter((id) => typeof id === "number");
    if (ids.length === 0) {
      showErrorToast(`No ${label} transactions to accept`);
      return;
    }
    setAcceptingId(source);
    try {
      const results = await patchInBatches(ids, { accepted: true });
      const failCount = results.filter((r) => !r.ok).length;
      if (failCount > 0) {
        showErrorToast(`${failCount} transaction(s) failed to accept`);
      } else {
        showSuccess(`${ids.length} ${label} transaction(s) accepted`);
      }
      await loadReviewTransactions();
    } catch (err) {
      showErrorToast(err?.message ?? `Failed to accept ${label} transactions`);
    } finally {
      setAcceptingId(null);
    }
  }, [reviewTransactions, patchInBatches, loadReviewTransactions, showSuccess, showErrorToast]);

  const handleAcceptSelected = useCallback(async () => {
    const selectedIds = [...selectedRows.values()]
      .map((t) => t.id ?? t.Id)
      .filter((id) => typeof id === "number");
    if (selectedIds.length === 0) {
      showErrorToast("No valid transactions selected");
      return;
    }
    setAcceptingId("selected");
    try {
      const results = await patchInBatches(selectedIds, { accepted: true });
      const failCount = results.filter((r) => !r.ok).length;
      if (failCount > 0) {
        showErrorToast(`${failCount} transaction(s) failed to accept`);
      } else {
        showSuccess(`${selectedIds.length} transaction(s) accepted`);
      }
      clearSelection();
      await loadReviewTransactions();
    } catch (err) {
      showErrorToast(err?.message ?? "Failed to accept selected transactions");
    } finally {
      setAcceptingId(null);
    }
  }, [selectedRows, patchInBatches, loadReviewTransactions, clearSelection, showSuccess, showErrorToast]);

  /**************************
   * Split transaction
   **************************/

  const handleSplitClick = useCallback((_rowId, entry) => {
    const target = entry || (selectedRows.size === 1 ? [...selectedRows.values()][0] : null);
    if (!target) return;
    const originalAmount = Number(target.Amount);
    if (!Number.isFinite(originalAmount)) return;

    setSplitTransaction(target);
    setSplitCount(2);
    setSplits([
      { amount: originalAmount, categoryName: target.Category ?? "" },
      { amount: 0, categoryName: target.Category ?? "" },
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
   * Neutralize transaction (brokerage security trades)
   **************************/

  // Holds the id of the row currently being neutralized (null when idle) so the
  // table can show that row's Neutralize button as busy and lock its actions.
  const [neutralizingId, setNeutralizingId] = useState(null);

  const handleNeutralizeClick = useCallback(async (_rowId, entryArg) => {
    if (neutralizingId != null) return; // a neutralize is already in flight
    const entry = entryArg || (selectedRows.size === 1 ? [...selectedRows.values()][0] : null);
    if (!entry) return;
    const id = entry?.id ?? entry?._id;
    if (!id || typeof id !== "number") {
      showErrorToast("Cannot neutralize: transaction not yet synced to database");
      return;
    }

    setNeutralizingId(id);
    try {
      const response = await fetch(
        Rest.buildUrl(`${reviewConfig.endpoint}/${id}/neutralize`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || "Failed to neutralize transaction");
      }
      clearSelection();
      showSuccess("Transaction neutralized — offsetting entry created");
      await loadReviewTransactions();
    } catch (err) {
      showErrorToast(err?.message ?? "Failed to neutralize transaction");
    } finally {
      setNeutralizingId(null);
    }
  }, [neutralizingId, selectedRows, clearSelection, loadReviewTransactions, showSuccess, showErrorToast]);

  // CR022: suggest categories for uncategorized rows from history, then apply
  // them as pending (not accepted) so they're reviewed before committing.
  const handleSuggestCategories = useCallback(async () => {
    const ids = reviewTransactions
      .filter((t) => !t.Category && typeof t.id === "number")
      .map((t) => t.id);
    if (ids.length === 0) {
      showErrorToast("No uncategorized rows to suggest");
      return;
    }
    setIsSuggesting(true);
    try {
      const res = await Rest.fetchJson(`${reviewConfig.endpoint}/category-suggestions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const hits = (res?.data ?? []).filter((s) => s.category_id && s.category_name);
      if (hits.length === 0) {
        showErrorToast("No confident suggestions from history yet");
        return;
      }
      // Group by category name and apply in batches (sets category, stays pending).
      const byCat = new Map();
      for (const s of hits) {
        if (!byCat.has(s.category_name)) byCat.set(s.category_name, []);
        byCat.get(s.category_name).push(s.id);
      }
      let applied = 0;
      for (const [name, catIds] of byCat) {
        const results = await patchInBatches(catIds, { Category: name });
        applied += results.filter((r) => r.ok).length;
      }
      showSuccess(`Suggested categories for ${applied} row(s) — review and Accept`);
      await loadReviewTransactions();
    } catch (err) {
      showErrorToast(err?.message ?? "Failed to suggest categories");
    } finally {
      setIsSuggesting(false);
    }
  }, [reviewTransactions, patchInBatches, loadReviewTransactions, showSuccess, showErrorToast]);

  /**************************
   * Transfer to another account (CR022)
   **************************/

  // COA options for the transfer-target picker (flat, breadcrumb labels).
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const rows = await Rest.fetchAccountsV2();
        if (active) setAccountOptions(buildHierarchyOptions(rows));
      } catch {
        // non-fatal: the Transfer picker simply shows no options
      }
    })();
    return () => { active = false; };
  }, []);

  const handleTransferClick = useCallback((_rowId, entryArg) => {
    const entry = entryArg || (selectedRows.size === 1 ? [...selectedRows.values()][0] : null);
    if (!entry) return;
    if (typeof entry.id !== "number") {
      showErrorToast("Cannot transfer: transaction not yet synced to database");
      return;
    }
    setTransferEntry(entry);
    setTransferTargetId("");
  }, [selectedRows, showErrorToast]);

  const handleTransferCancel = useCallback(() => {
    setTransferEntry(null);
    setTransferTargetId("");
  }, []);

  const handleTransferConfirm = useCallback(async () => {
    if (!transferEntry || !transferTargetId) return;
    setIsTransferring(true);
    try {
      const response = await fetch(
        Rest.buildUrl(`${reviewConfig.endpoint}/${transferEntry.id}/transfer`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetAccountId: Number(transferTargetId) }),
        }
      );
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || "Failed to create transfer");
      }
      setTransferEntry(null);
      setTransferTargetId("");
      clearSelection();
      showSuccess("Transfer recorded — offsetting entry created");
      await loadReviewTransactions();
    } catch (err) {
      showErrorToast(err?.message ?? "Failed to create transfer");
    } finally {
      setIsTransferring(false);
    }
  }, [transferEntry, transferTargetId, clearSelection, loadReviewTransactions, showSuccess, showErrorToast]);

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
              <h1 className="refresh-ps-toolbar__title">Refresh Feeds</h1>
              <p className="refresh-ps-toolbar__desc">
                Pull the latest bank-feed transactions and sync them into your
                database for review.
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
                onClick={handleRefreshFeedClick}
                disabled={isRefreshingFeed}
              >
                {isRefreshingFeed ? "Refreshing..." : "Refresh Feed Data"}
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
              <EmptyState variant="upload" message="No new transactions were found in the latest import." />
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
              <EmptyState variant="upload" message="No modified transactions were found in the latest update." />
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
                    className={`btn btn--sm btn--outline${groupByAccount ? " btn--active" : ""}`}
                    onClick={() => setGroupByAccount((prev) => !prev)}
                    title="Group review rows by account"
                  >
                    {groupByAccount ? "Grouped by account" : "Group by account"}
                  </button>
                  {selectedRows.size > 0 && (
                    <button
                      type="button"
                      className="refresh-ps-btn refresh-ps-btn--bulk-category"
                      onClick={() => {
                        setBulkCategoryMode(true);
                        setEditingCategory({ rowId: null, entry: null });
                        setCategoryValue("");
                      }}
                    >
                      Category ({selectedRows.size})
                    </button>
                  )}
                  {selectedRows.size > 0 && (
                    <button
                      type="button"
                      className="refresh-ps-btn refresh-ps-btn--accept-all"
                      onClick={handleAcceptSelected}
                      disabled={acceptingId != null}
                    >
                      {acceptingId === "selected"
                        ? "Accepting..."
                        : `Accept Selected (${selectedRows.size})`}
                    </button>
                  )}
                  <button
                    type="button"
                    className="refresh-ps-btn refresh-ps-btn--bulk-category"
                    onClick={handleSuggestCategories}
                    disabled={isSuggesting || acceptingId != null}
                  >
                    {isSuggesting ? "Suggesting..." : "Suggest categories"}
                  </button>
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
              groupByKey={groupByAccount ? "Account" : null}
              showSelection={true}
              onRowToggle={toggleRowSelection}
              onDateClick={handleDateClick}
              onDescriptionClick={handleDescriptionClick}
              onCategoryClick={handleCategoryClick}
              onAcceptClick={handleAcceptClick}
              onSplitClick={handleSplitClick}
              onNeutralizeClick={handleNeutralizeClick}
              onTransferClick={handleTransferClick}
              neutralizingId={neutralizingId}
              acceptingId={acceptingId}
            />
            {transferEntry && (
              <div
                className="trans-budget-edit-modal-overlay"
                role="dialog"
                aria-modal="true"
                aria-label="Transfer to account"
              >
                <div className="trans-budget-edit-modal">
                  <h3>Transfer to account</h3>
                  <p className="refresh-ps-toolbar__desc">
                    Creates an offsetting entry in the chosen account (the negated
                    amount), making this a net-worth-neutral transfer. Both legs
                    are accepted.
                  </p>
                  <label className="trans-budget-edit-modal__field trans-budget-edit-modal__field--full-row">
                    <span>Destination account</span>
                    <AccountPicker
                      value={transferTargetId}
                      options={accountOptions.filter(
                        // Balance-sheet leaves only: a net-worth-neutral transfer
                        // must offset to a real asset/liability, not a P&L account.
                        (o) =>
                          o.isLeaf &&
                          o.section === "balance_sheet" &&
                          o.id !== transferEntry.account_id
                      )}
                      onChange={setTransferTargetId}
                      placeholder="Search accounts…"
                      autoFocus
                    />
                  </label>
                  <div className="trans-budget-edit-modal__actions">
                    <button
                      className="generate-report-button"
                      type="button"
                      onClick={handleTransferCancel}
                      disabled={isTransferring}
                    >
                      Cancel
                    </button>
                    <button
                      className="generate-report-button"
                      type="button"
                      onClick={handleTransferConfirm}
                      disabled={isTransferring || !transferTargetId}
                    >
                      {isTransferring ? "Saving…" : "Create transfer"}
                    </button>
                  </div>
                </div>
              </div>
            )}
            {editingDate && (
              <div
                className="trans-budget-edit-modal-overlay"
                role="dialog"
                aria-modal="true"
                aria-label="Edit date"
              >
                <div className="trans-budget-edit-modal">
                  <h3>Edit Date</h3>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleDateSave();
                    }}
                  >
                    <label className="trans-budget-edit-modal__field trans-budget-edit-modal__field--full-row">
                      <span>Date</span>
                      <input
                        className="form-input"
                        type="date"
                        value={dateValue}
                        onChange={(e) => setDateValue(e.target.value)}
                        disabled={isSavingDate}
                        autoFocus
                      />
                    </label>
                    <div className="trans-budget-edit-modal__actions">
                      <button
                        className="generate-report-button"
                        type="button"
                        onClick={handleDateCancel}
                        disabled={isSavingDate}
                      >
                        Cancel
                      </button>
                      <button
                        className="generate-report-button"
                        type="submit"
                        disabled={isSavingDate || !dateValue}
                      >
                        {isSavingDate ? "Saving\u2026" : "Save"}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}
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
