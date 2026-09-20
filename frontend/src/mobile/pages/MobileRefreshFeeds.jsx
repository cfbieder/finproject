/**
 * MobileRefreshFeeds — phone-friendly bank-feed refresh AND review.
 *
 * Scope: trigger a bank-feed pull, show what landed (new / linked / staged /
 * ignored) and the last refresh/ingest times, then work the review queue the
 * way the desktop "Refresh Feeds" page does — group by account, suggest
 * categories from history, set a row's category, and accept (one row, or all).
 *
 * The review actions are the desktop page's, on the desktop endpoints:
 *  - POST  /api/v2/ingest-bank-feed/refresh { sinceDays }
 *      → { ingest: { staged }, sync: { inserted, linked, ignoredAccounts } }
 *  - GET   /api/v2/util/appdata → records carrying lastIngest / lastRefresh
 *  - POST  /api/v2/ingest-ps/review-new-transactions → { data: [...] }
 *  - POST  /api/v2/transactions/category-suggestions { ids } → { data: [...] }
 *  - PATCH /api/v2/transactions/:id  { Category } | { accepted: true }
 *
 * CR065 rides along, because a phone must not be the cheap way past a warning
 * the desktop makes: a securities-trade leg whose counter-leg does not exist is
 * badged `no offset`, and EVERY accept path here — the row button and Accept
 * all — asks first. Accepting one leg leaves the account short by the full
 * amount, and on a brokerage account that reads as a market move rather than a
 * mistake. Neutralize stays on the desktop page; this warns and points there.
 *
 * Splits, dates, descriptions, transfers and neutralize remain desktop-only —
 * they are modal-heavy and rarely the thing a phone is holding.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Loader2,
  RefreshCw,
  AlertTriangle,
  ClipboardList,
  CheckCheck,
  Sparkles,
  Layers,
} from "lucide-react";
import Rest from "../../js/rest.js";
import { useCoa } from "../../hooks/useCoa.js";
import MobileCategoryPicker, {
  pushRecentCategory,
} from "../MobileCategoryPicker.jsx";
import MobileSheet from "../MobileSheet.jsx";

const DAYS_OPTIONS = [7, 14, 30, 60, 90];
const PENDING_PREVIEW_COUNT = 15;
const TX_ENDPOINT = "/api/v2/transactions";
// Matches the desktop page's patchInBatches — five concurrent PATCHes.
const PATCH_BATCH = 5;

// Formatting mirrors MobileLedger (negative in parens, currency code suffix).
const fmtAmount = (n, ccy) => {
  const v = Number(n) || 0;
  const s = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(v));
  const body = ccy ? `${s} ${ccy}` : s;
  return v < 0 ? `(${body})` : body;
};

/** Truncate for the confirm sheet, so a long description cannot swallow it. */
const clip = (text, max) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

const fmtDate = (iso) => {
  try {
    return new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "2-digit",
    });
  } catch {
    return iso;
  }
};

/** Latest valid Date across all records for a given field, or null. */
function latestDate(records, field) {
  const dates = records
    .map((item) => item?.[field])
    .map((d) => (d ? new Date(d) : null))
    .filter((d) => d instanceof Date && !Number.isNaN(d.getTime()));
  return dates.length
    ? dates.reduce((a, b) => (b > a ? b : a), dates[0])
    : null;
}

/**
 * Raw review row → the shape this page renders. The server returns snake_case
 * columns; the desktop page runs the same rows through REVIEW_CONFIG's
 * transformEntry, so the field names differ by design, not by drift.
 */
function parseRow(txn) {
  const parsed = txn.id != null ? Number(txn.id) : null;
  return {
    id: Number.isFinite(parsed) ? parsed : null,
    ps_id: txn.ps_id,
    date: txn.transaction_date,
    description: txn.description1 || txn.description2 || "(no description)",
    amount: Number(txn.amount) || 0,
    currency: txn.currency,
    account: txn.account_name || "—",
    category: txn.category_name || "",
    // CR065, server-computed (bounded to the migration 053 watermark);
    // an absent field means false, never "unknown".
    needsOffset: txn.needs_offset === true,
  };
}

/** Cluster rows by account, groups alphabetical, rows keeping their order. */
function groupByAccountName(rows) {
  const groups = new Map();
  for (const row of rows) {
    const name = row.account || "—";
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(row);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, items]) => ({ name, items }));
}

export default function MobileRefreshFeeds() {
  const { plTree } = useCoa();

  // 30 tracks bank-feed's look-back and the server default (CR059 §22.9).
  const [days, setDays] = useState(30);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [result, setResult] = useState(null); // { inserted, linked, staged, ignored }
  const [status, setStatus] = useState(null); // { type, message }

  const [lastRefresh, setLastRefresh] = useState(null);
  const [lastIngest, setLastIngest] = useState(null);
  const [rows, setRows] = useState(null); // review-queue rows (null = unavailable)
  const [showAllPending, setShowAllPending] = useState(false);
  const [isLoadingMeta, setIsLoadingMeta] = useState(true);

  // Review actions
  const [groupByAccount, setGroupByAccount] = useState(false);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [acceptingId, setAcceptingId] = useState(null); // number | "all" | null
  const [savingCategoryId, setSavingCategoryId] = useState(null);
  const [pickerRow, setPickerRow] = useState(null);
  const [toast, setToast] = useState("");
  const [acceptWarning, setAcceptWarning] = useState(null); // { message, resolve }

  const toastTimer = useRef(null);
  const showToast = useCallback((msg) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2600);
  }, []);
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    []
  );

  const loadReview = useCallback(async () => {
    const review = await Rest.fetchJson(
      "/api/v2/ingest-ps/review-new-transactions",
      { method: "POST" }
    ).catch(() => null);
    setRows(Array.isArray(review?.data) ? review.data.map(parseRow) : null);
  }, []);

  const loadMeta = useCallback(async () => {
    setIsLoadingMeta(true);
    try {
      const [appdata] = await Promise.all([
        Rest.fetchJson("/api/v2/util/appdata").catch(() => null),
        loadReview(),
      ]);
      const records = Array.isArray(appdata) ? appdata : [];
      setLastRefresh(latestDate(records, "lastRefresh"));
      setLastIngest(latestDate(records, "lastIngest"));
    } finally {
      setIsLoadingMeta(false);
    }
  }, [loadReview]);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  const handleRefresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    setStatus({ type: "info", message: "Refreshing bank-feed data…" });
    setResult(null);
    try {
      const res = await Rest.fetchJson("/api/v2/ingest-bank-feed/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sinceDays: days }),
      });
      const ing = res?.ingest ?? {};
      const syn = res?.sync ?? {};
      setResult({
        inserted: syn.inserted ?? 0,
        linked: syn.linked ?? 0,
        staged: ing.staged ?? 0,
        ignored: (syn.ignoredAccounts ?? []).length,
      });
      setStatus({ type: "success", message: "Bank feed refreshed." });
      await loadMeta();
    } catch (err) {
      setStatus({
        type: "error",
        message: err?.message ?? "Failed to refresh bank-feed data",
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  /**************************
   * Review actions
   **************************/

  const patchInBatches = useCallback(async (ids, body) => {
    const results = [];
    for (let i = 0; i < ids.length; i += PATCH_BATCH) {
      const batch = ids.slice(i, i + PATCH_BATCH);
      const batchResults = await Promise.all(
        batch.map((id) =>
          fetch(Rest.buildUrl(`${TX_ENDPOINT}/${id}`), {
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

  // CR065: accepting is not neutralizing. Every accept path funnels through
  // here, so the phone cannot become the cheap way past the desktop's warning.
  const confirmUnpairedAccept = useCallback(
    (ids) => {
      const wanted = new Set(ids);
      const loose = (rows ?? []).filter(
        (t) => wanted.has(t.id) && t.needsOffset
      );
      if (loose.length === 0) return Promise.resolve(true);

      // The out-by figure is only stated when every loose leg shares one
      // currency. Summing local amounts across currencies is the Fin class
      // that put PLN and EUR in one total (CR064 P8 / CR068 P2) — and a wrong
      // number inside the warning would undermine the warning.
      const currencies = new Set(loose.map((t) => t.currency));
      const outBy =
        currencies.size === 1
          ? ` ${fmtAmount(
              loose.reduce((sum, t) => sum + (Number(t.amount) || 0), 0),
              [...currencies][0]
            )}`
          : "";
      const detail = loose
        .slice(0, 3)
        .map(
          (t) =>
            `• ${t.account} — ${clip(t.description, 34)}  ` +
            fmtAmount(t.amount, t.currency)
        )
        .join("\n");
      return new Promise((resolve) => {
        setAcceptWarning({
          resolve,
          message:
            `${loose.length} of these ${
              loose.length === 1
                ? "is a securities-trade leg"
                : "are securities-trade legs"
            } with NO offsetting entry:\n\n` +
            detail +
            (loose.length > 3 ? `\n… and ${loose.length - 3} more` : "") +
            `\n\nAccepting leaves the balance${outBy} out — it shows up as ` +
            `drift, and on a brokerage account it looks like a market move ` +
            `rather than a mistake.\n\n` +
            `Neutralize them on the desktop Refresh Feeds page unless the ` +
            `offsetting leg is genuinely in another account.`,
        });
      });
    },
    [rows]
  );

  const resolveAcceptWarning = useCallback((proceed) => {
    setAcceptWarning((w) => {
      w?.resolve?.(proceed);
      return null;
    });
  }, []);

  const acceptOne = useCallback(
    async (row) => {
      const id = row?.id;
      if (typeof id !== "number") {
        showToast("Cannot accept: not yet synced to the database");
        return;
      }
      if (!(await confirmUnpairedAccept([id]))) return;
      setAcceptingId(id);
      try {
        const response = await fetch(Rest.buildUrl(`${TX_ENDPOINT}/${id}`), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accepted: true }),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.error || "Failed to accept transaction");
        }
        setRows((prev) => (prev ?? []).filter((t) => t.id !== id));
        showToast("Accepted");
      } catch (err) {
        showToast(err?.message ?? "Failed to accept transaction");
      } finally {
        setAcceptingId(null);
      }
    },
    [confirmUnpairedAccept, showToast]
  );

  const acceptAll = useCallback(async () => {
    const ids = (rows ?? [])
      .map((t) => t.id)
      .filter((id) => typeof id === "number");
    if (ids.length === 0) {
      showToast("Nothing to accept");
      return;
    }
    if (!(await confirmUnpairedAccept(ids))) return;
    setAcceptingId("all");
    try {
      const results = await patchInBatches(ids, { accepted: true });
      const failures = results.filter((r) => !r.ok).length;
      showToast(
        failures > 0
          ? `${ids.length - failures} accepted, ${failures} failed`
          : `${ids.length} transaction${ids.length === 1 ? "" : "s"} accepted`
      );
      await loadReview();
    } catch (err) {
      showToast(err?.message ?? "Accept all failed");
    } finally {
      setAcceptingId(null);
    }
  }, [rows, confirmUnpairedAccept, patchInBatches, loadReview, showToast]);

  // Deterministic merchant-history rules server-side; this only applies what
  // comes back, and leaves every row pending so nothing is accepted unseen.
  const handleSuggestCategories = useCallback(async () => {
    const ids = (rows ?? [])
      .filter((t) => !t.category && typeof t.id === "number")
      .map((t) => t.id);
    if (ids.length === 0) {
      showToast("No uncategorized rows to suggest");
      return;
    }
    setIsSuggesting(true);
    try {
      const res = await Rest.fetchJson(
        `${TX_ENDPOINT}/category-suggestions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
        }
      );
      const hits = (res?.data ?? []).filter(
        (s) => s.category_id && s.category_name
      );
      if (hits.length === 0) {
        showToast("No confident suggestions from history yet");
        return;
      }
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
      showToast(`Suggested ${applied} — review, then Accept`);
      await loadReview();
    } catch (err) {
      showToast(err?.message ?? "Failed to suggest categories");
    } finally {
      setIsSuggesting(false);
    }
  }, [rows, patchInBatches, loadReview, showToast]);

  const handleCategoryPick = useCallback(
    async (newCategory) => {
      const row = pickerRow;
      setPickerRow(null);
      if (!row || !newCategory) return;
      if (typeof row.id !== "number") {
        showToast("Cannot edit: not yet synced to the database");
        return;
      }
      setSavingCategoryId(row.id);
      try {
        const response = await fetch(Rest.buildUrl(`${TX_ENDPOINT}/${row.id}`), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ Category: newCategory }),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.error || "Failed to update category");
        }
        setRows((prev) =>
          (prev ?? []).map((t) =>
            t.id === row.id ? { ...t, category: newCategory } : t
          )
        );
        pushRecentCategory(newCategory);
        showToast(`Category set to ${newCategory}`);
      } catch (err) {
        showToast(err?.message ?? "Failed to update category");
      } finally {
        setSavingCategoryId(null);
      }
    },
    [pickerRow, showToast]
  );

  /**************************
   * Render
   **************************/

  const pendingCount = rows?.length ?? 0;
  const visibleRows = useMemo(() => {
    if (!rows) return [];
    return showAllPending ? rows : rows.slice(0, PENDING_PREVIEW_COUNT);
  }, [rows, showAllPending]);

  // Grouped mode groups the WHOLE queue, not the 15-row preview: a group
  // header states its account's count, and capping the rows underneath would
  // make that count a lie. The preview cap is a flat-list device, so its
  // "Show all" button belongs to the flat list too.
  const groups = useMemo(
    () => (groupByAccount ? groupByAccountName(rows ?? []) : null),
    [groupByAccount, rows]
  );

  const busy = isSuggesting || acceptingId != null || isRefreshing;

  const renderRow = (tx) => {
    const editable = typeof tx.id === "number";
    const isAccepting = acceptingId === tx.id;
    const isSavingCat = savingCategoryId === tx.id;
    return (
      <div className="m-tx" key={tx.id ?? `ps-${tx.ps_id}`}>
        <span className="m-tx__desc">{tx.description}</span>
        <span
          className={
            "m-tx__amt " +
            (tx.amount < 0 ? "m-tx__amt--neg" : "m-tx__amt--pos")
          }
        >
          {fmtAmount(tx.amount, tx.currency)}
        </span>
        <span className="m-tx__meta">
          {/* The badge leads the meta line rather than trailing the
              description: .m-tx__desc is nowrap + ellipsis, so a badge appended
              there is clipped away on exactly the long descriptions that need
              it — a warning that renders and cannot be seen. */}
          {tx.needsOffset && (
            <span
              className="m-tx__flag"
              title="No offsetting entry — accepting this alone leaves the balance short by the full amount."
            >
              no offset
            </span>
          )}
          {fmtDate(tx.date)}
          {groupByAccount ? "" : tx.account ? ` · ${tx.account}` : ""}
        </span>
        <div className="m-tx__cat-row">
          <button
            type="button"
            className={
              "m-tx__cat" + (tx.category ? "" : " m-tx__cat--missing")
            }
            disabled={!editable || isSavingCat || busy}
            onClick={() => setPickerRow(tx)}
          >
            {isSavingCat ? "Saving…" : tx.category || "Set category"}
          </button>
        </div>
        <button
          type="button"
          className="m-tx__action"
          disabled={!editable || busy}
          onClick={() => acceptOne(tx)}
        >
          {isAccepting ? <Loader2 size={13} className="m-spin" /> : "Accept"}
        </button>
      </div>
    );
  };

  return (
    <div>
      <div className="m-page-meta">
        <span className="m-pill">
          {isLoadingMeta
            ? "Loading status…"
            : lastRefresh
            ? `Last refresh: ${lastRefresh.toLocaleString()}`
            : "No refresh recorded yet"}
        </span>
      </div>

      <div className="m-refresh-bar">
        <select
          className="m-select"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          disabled={isRefreshing}
          aria-label="History window in days"
          style={{ flex: "0 0 auto", width: "auto" }}
        >
          {DAYS_OPTIONS.map((d) => (
            <option key={d} value={d}>
              {d} days
            </option>
          ))}
        </select>
        <button
          type="button"
          className="m-btn m-btn--primary"
          onClick={handleRefresh}
          disabled={isRefreshing}
        >
          {isRefreshing ? (
            <Loader2 size={18} className="m-spin" />
          ) : (
            <RefreshCw size={18} />
          )}
          {isRefreshing ? "Refreshing…" : "Refresh feeds"}
        </button>
      </div>

      {status && (
        <div
          className={"m-pill" + (status.type === "error" ? " m-pill--error" : "")}
          style={{
            display: "flex",
            width: "100%",
            justifyContent: "center",
            marginBottom: 14,
            color:
              status.type === "error"
                ? "var(--danger)"
                : status.type === "success"
                ? "var(--success, var(--primary))"
                : "var(--ink-secondary)",
          }}
        >
          {status.type === "error" && <AlertTriangle size={14} />}
          {status.message}
        </div>
      )}

      {result && (
        <>
          <h2 className="m-section-h">Last refresh</h2>
          <div className="m-kpis m-kpis--grid">
            <div className="m-kpi">
              <span className="m-kpi__label">New</span>
              <span className="m-kpi__value m-kpi__value--positive">
                {result.inserted}
              </span>
            </div>
            <div className="m-kpi">
              <span className="m-kpi__label">Linked to PS</span>
              <span className="m-kpi__value">{result.linked}</span>
            </div>
            <div className="m-kpi">
              <span className="m-kpi__label">Staged</span>
              <span className="m-kpi__value">{result.staged}</span>
            </div>
            <div className="m-kpi">
              <span className="m-kpi__label">Ignored accts</span>
              <span className="m-kpi__value">{result.ignored}</span>
            </div>
          </div>
        </>
      )}

      <h2 className="m-tx-section-h">
        Waiting for review
        {rows != null && (
          <span className="m-tx-section-h__count">{pendingCount}</span>
        )}
      </h2>

      {rows == null || pendingCount === 0 ? (
        <div className="m-pill" style={{ display: "flex", width: "100%" }}>
          <ClipboardList size={14} />
          {rows == null
            ? "Review queue unavailable"
            : "Nothing waiting for review"}
        </div>
      ) : (
        <>
          <div className="m-refresh-bar">
            <button
              type="button"
              className={"m-btn" + (groupByAccount ? " m-btn--primary" : "")}
              onClick={() => setGroupByAccount((v) => !v)}
              aria-pressed={groupByAccount}
            >
              <Layers size={16} />
              {groupByAccount ? "Grouped" : "Group"}
            </button>
            <button
              type="button"
              className="m-btn"
              onClick={handleSuggestCategories}
              disabled={busy}
            >
              {isSuggesting ? (
                <Loader2 size={16} className="m-spin" />
              ) : (
                <Sparkles size={16} />
              )}
              {isSuggesting ? "Suggesting…" : "Suggest"}
            </button>
            <button
              type="button"
              className="m-btn"
              onClick={acceptAll}
              disabled={busy}
            >
              {acceptingId === "all" ? (
                <Loader2 size={16} className="m-spin" />
              ) : (
                <CheckCheck size={16} />
              )}
              {`Accept all (${pendingCount})`}
            </button>
          </div>

          {groups ? (
            groups.map((group) => (
              <div key={group.name}>
                <h3 className="m-tx-section-h">
                  {group.name}
                  <span className="m-tx-section-h__count">
                    {group.items.length}
                  </span>
                </h3>
                <div className="m-tx-list">{group.items.map(renderRow)}</div>
              </div>
            ))
          ) : (
            <div className="m-tx-list" style={{ marginTop: 10 }}>
              {visibleRows.map(renderRow)}
            </div>
          )}

          {!groupByAccount && pendingCount > PENDING_PREVIEW_COUNT && (
            <button
              type="button"
              className="m-btn"
              style={{ width: "100%", marginTop: 10 }}
              onClick={() => setShowAllPending((v) => !v)}
            >
              {showAllPending ? "Show fewer" : `Show all ${pendingCount}`}
            </button>
          )}
        </>
      )}

      {lastIngest && (
        <p style={{ marginTop: 18, fontSize: 12, color: "var(--muted)" }}>
          Last ingest: {lastIngest.toLocaleString()}
        </p>
      )}

      {toast && <div className="m-toast">{toast}</div>}

      <MobileCategoryPicker
        open={pickerRow !== null}
        plTree={plTree}
        currentCategory={pickerRow?.category || ""}
        onSelect={handleCategoryPick}
        onClose={() => setPickerRow(null)}
        title="Choose category"
      />

      <MobileSheet
        open={acceptWarning !== null}
        title="Accept without the offsetting leg?"
        onClose={() => resolveAcceptWarning(false)}
        footer={
          <>
            <button
              type="button"
              className="m-btn"
              onClick={() => resolveAcceptWarning(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="m-btn m-btn--primary"
              onClick={() => resolveAcceptWarning(true)}
            >
              Accept anyway
            </button>
          </>
        }
      >
        <div className="m-warn-body">
          <AlertTriangle size={20} />
          <p>{acceptWarning?.message}</p>
        </div>
      </MobileSheet>
    </div>
  );
}
