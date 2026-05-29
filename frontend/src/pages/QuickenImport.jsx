/**
 * Quicken Import Admin Page (CR019 Phase E)
 *
 * Three internal views switched via state:
 *   1. List   — all batches with status, click to drill in
 *   2. Detail — mapping panels: Accounts (Quicken account names →
 *               BS COA accounts), Categories (Quicken categories → P&L leaves),
 *               + Transfer Targets (Quicken account names referenced as
 *               transfer destinations). All write to `account_source_mappings`.
 *   3. Pre-flight — diff of what would happen on promote + Promote button.
 *               After promote success, exposes a Rollback button.
 *
 * Phase E scope: cash-only. Securities mapping panel and FX gap panel are
 * deferred to a later sub-phase per CR §14.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Rest from "../js/rest.js";
import { useToast } from "../contexts";
import "./PageLayout.css";
import "./QuickenImport.css";

function formatAccountLabel(a) {
  const prefix = `[${a.section === "balance_sheet" ? "BS" : "P&L"}]`;
  const breadcrumb = a.ancestorPath && a.ancestorPath.length > 0
    ? `${a.ancestorPath.join(" / ")} / `
    : "";
  return `${prefix} ${breadcrumb}${a.name}`;
}

// Walk parent_id chain to enrich each row with its full breadcrumb path
// (ancestor names from root, excluding the leaf itself) and a sortable key.
// Also flags whether a row is a leaf (no other row has it as parent_id) so the
// mapping picker can restrict to leaves only — transactions must land on a
// terminal asset/liability/income/expense, not an organizational container.
function buildHierarchyOptions(rows) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const parentIds = new Set(rows.map((r) => r.parent_id).filter(Boolean));
  const cache = new Map();
  const ancestorPath = (id) => {
    if (cache.has(id)) return cache.get(id);
    const r = byId.get(id);
    if (!r) return [];
    const path = r.parent_id ? [...ancestorPath(r.parent_id), byId.get(r.parent_id)?.name].filter(Boolean) : [];
    cache.set(id, path);
    return path;
  };
  return rows
    .map((r) => {
      const ap = ancestorPath(r.id);
      return {
        ...r,
        ancestorPath: ap,
        isLeaf: !parentIds.has(r.id),
        sortKey: [...ap, r.name].join("/").toLowerCase(),
        searchHaystack: [...ap, r.name].join(" ").toLowerCase(),
      };
    })
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
}

// ───────────────────────────────────────────────────────────────────────────
// AccountPicker — typeahead combobox over the COA. Replaces native <select>
// for the mapping panel. Optional `onCreateRequest` lets the parent surface a
// "+ Create new COA entry…" footer that bubbles up the typed query.
// ───────────────────────────────────────────────────────────────────────────
function AccountPicker({ value, options, onChange, onCreateRequest, placeholder, autoFocus }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (autoFocus && inputRef.current) inputRef.current.focus();
  }, [autoFocus]);

  const selected = useMemo(() => options.find((a) => a.id === value), [options, value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((a) => {
      const haystack = a.searchHaystack || a.name.toLowerCase();
      return haystack.includes(q);
    });
  }, [options, query]);

  const displayValue = open
    ? query
    : selected
      ? formatAccountLabel(selected)
      : "";

  return (
    <div className="qi-picker" ref={containerRef}>
      <input
        ref={inputRef}
        type="text"
        className="qi-picker-input"
        placeholder={placeholder || "Search COA…"}
        value={displayValue}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          setQuery("");
          setOpen(true);
        }}
      />
      {selected && !open && (
        <button
          type="button"
          className="qi-picker-clear"
          onClick={() => onChange("")}
          title="Clear selection"
        >
          ×
        </button>
      )}
      {open && (
        <div className="qi-picker-dropdown">
          {filtered.length === 0 ? (
            <div className="qi-picker-empty">No matches for "{query}"</div>
          ) : (
            filtered.slice(0, 100).map((a) => (
              <button
                key={a.id}
                type="button"
                className={`qi-picker-option ${a.id === value ? "is-selected" : ""}`}
                onClick={() => {
                  onChange(a.id);
                  setOpen(false);
                  setQuery("");
                }}
              >
                <span className="qi-picker-section">
                  [{a.section === "balance_sheet" ? "BS" : "P&L"}]
                </span>{" "}
                {a.ancestorPath && a.ancestorPath.length > 0 && (
                  <span className="qi-picker-breadcrumb">
                    {a.ancestorPath.join(" / ")} /{" "}
                  </span>
                )}
                <span className="qi-picker-leaf">{a.name}</span>
              </button>
            ))
          )}
          {filtered.length > 100 && (
            <div className="qi-picker-truncated">
              Showing 100 of {filtered.length} — refine your search.
            </div>
          )}
          {onCreateRequest && (
            <button
              type="button"
              className="qi-picker-create"
              onClick={() => {
                setOpen(false);
                onCreateRequest(query.trim());
                setQuery("");
              }}
            >
              + Create new COA entry{query.trim() ? ` "${query.trim()}"` : ""}…
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// CreateCoaModal — inline form to create a new COA leaf without leaving the
// mapping flow. Posts to /api/v2/util/coa/add and surfaces the new id via
// onCreated so the originating mapping row can auto-assign it.
// ───────────────────────────────────────────────────────────────────────────
// Many parent containers store currency='USD' even when they logically hold
// non-USD accounts (e.g., "PLN Bank Accounts"). The convention "<CCY> Foo" in
// the parent name is more reliable than the stored value, so prefer that.
function inferCurrencyFromParent(parent) {
  if (!parent) return "";
  const firstWord = parent.name.trim().split(/\s+/)[0] || "";
  if (/^[A-Z]{3}$/.test(firstWord)) return firstWord;
  return parent.currency || "";
}

function CreateCoaModal({ open, suggestedName, parentOptions, onClose, onCreated }) {
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState("");
  const [currency, setCurrency] = useState("");
  const [currencyTouched, setCurrencyTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setName(suggestedName || "");
      setParentId("");
      setCurrency("");
      setCurrencyTouched(false);
      setError("");
    }
  }, [open, suggestedName]);

  if (!open) return null;

  const parent = parentOptions.find((a) => a.id === parentId);
  const inferredCurrency = inferCurrencyFromParent(parent);

  // Auto-fill currency from the inferred value when the user picks a parent,
  // unless they've already typed something themselves.
  const handleParentChange = (id) => {
    setParentId(id);
    if (!currencyTouched) {
      const next = inferCurrencyFromParent(parentOptions.find((a) => a.id === id));
      setCurrency(next);
    }
  };

  const handleCreate = async () => {
    setError("");
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name is required.");
      return;
    }
    if (!parent) {
      setError("Pick a parent COA account.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        path: [parent.name],
        name: trimmed,
      };
      if (currency.trim()) payload.currency = currency.trim().toUpperCase();
      const res = await Rest.fetchJson("/api/v2/util/coa/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      onCreated(res.id, trimmed);
    } catch (err) {
      setError(err?.message || "Failed to create COA entry.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="qi-modal-overlay" onClick={onClose}>
      <div className="qi-modal" onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="qi-modal-header">Create new COA entry</div>
        <div className="qi-modal-body">
          <label className="qi-modal-field">
            <span>Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              disabled={saving}
            />
          </label>
          <label className="qi-modal-field">
            <span>Parent</span>
            <AccountPicker
              value={parentId}
              options={parentOptions}
              onChange={handleParentChange}
              placeholder="Search for a parent COA account…"
            />
          </label>
          {parent && (
            <div className="qi-modal-hint">
              Will inherit section ({parent.section === "balance_sheet" ? "Balance Sheet" : "P&L"})
              and type from parent.
            </div>
          )}
          <label className="qi-modal-field">
            <span>Currency</span>
            <input
              type="text"
              value={currency}
              onChange={(e) => {
                setCurrency(e.target.value.toUpperCase());
                setCurrencyTouched(true);
              }}
              placeholder={inferredCurrency || "USD"}
              maxLength={3}
              disabled={saving}
            />
          </label>
          {error && <div className="qi-modal-error">{error}</div>}
        </div>
        <div className="qi-modal-footer">
          <button className="qi-btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            className="qi-btn qi-btn-primary"
            onClick={handleCreate}
            disabled={saving}
          >
            {saving ? "Creating…" : "Create & assign"}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatDate(s) {
  if (!s) return "—";
  return new Date(s).toISOString().replace("T", " ").replace(/\..+/, "");
}

function StatusBadge({ status }) {
  const colors = {
    parsing: "#999",
    parsed: "#0a7",
    mapped: "#06b",
    promoting: "#fa0",
    promoted: "#070",
    rolling_back: "#fa0",
    rolled_back: "#a60",
    failed: "#d33",
  };
  return (
    <span className="qi-status-badge" style={{ background: colors[status] || "#666" }}>
      {status}
    </span>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// VIEW 1 — Batch list
// ───────────────────────────────────────────────────────────────────────────
function BatchList({ batches, onPick, onRefresh }) {
  return (
    <div className="qi-section">
      <div className="qi-section-header">
        <h2>Quicken Import Batches</h2>
        <button className="qi-btn" onClick={onRefresh}>Refresh</button>
      </div>
      {batches.length === 0 ? (
        <p className="qi-empty">
          No batches yet. Run <code>node server/src/v2/scripts/quicken-import.js parse …</code> to
          parse a QIF, then return here to map and promote.
        </p>
      ) : (
        <table className="qi-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Label</th>
              <th>Source files</th>
              <th>Parsed</th>
              <th>Promoted</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {batches.map((b) => (
              <tr key={b.id}>
                <td><StatusBadge status={b.status} /></td>
                <td>{b.label || <span className="qi-muted">{b.id.slice(0, 8)}…</span>}</td>
                <td className="qi-source-files">
                  {(b.source_files || []).map((f, i) => (
                    <code key={i}>{f}</code>
                  ))}
                </td>
                <td>{formatDate(b.parsed_at)}</td>
                <td>{formatDate(b.promoted_at)}</td>
                <td>
                  <button className="qi-btn" onClick={() => onPick(b.id)}>Open</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// VIEW 2 — Mapping panels
// ───────────────────────────────────────────────────────────────────────────
function MappingRow({ name, kind, mapped, accountOptions, onSave, onClear, onCreateRequest }) {
  const [value, setValue] = useState(mapped?.mapped_account_id || "");
  const [busy, setBusy] = useState(false);

  // Keep local state in sync with parent prop (e.g., after a create-and-assign
  // round-trip re-fetches the batch detail).
  useEffect(() => {
    setValue(mapped?.mapped_account_id || "");
  }, [mapped?.mapped_account_id]);

  const handleSave = async () => {
    if (!value) return;
    setBusy(true);
    try {
      await onSave(name, parseInt(value, 10));
    } finally {
      setBusy(false);
    }
  };
  const handleClear = async () => {
    setBusy(true);
    try {
      await onClear(name);
      setValue("");
    } finally {
      setBusy(false);
    }
  };

  const isMapped = !!mapped?.mapped_account_id;
  return (
    <tr className={isMapped ? "qi-mapped" : "qi-unmapped"}>
      <td><code>{name}</code></td>
      <td className="qi-kind">{kind}</td>
      <td>
        <AccountPicker
          value={value ? parseInt(value, 10) : ""}
          options={accountOptions}
          onChange={(id) => setValue(id || "")}
          onCreateRequest={(query) => onCreateRequest(name, query)}
        />
      </td>
      <td>
        {value && !isMapped && (
          <button className="qi-btn" disabled={busy} onClick={handleSave}>
            Save
          </button>
        )}
        {value && isMapped && value !== mapped.mapped_account_id && (
          <button className="qi-btn" disabled={busy} onClick={handleSave}>
            Update
          </button>
        )}
        {isMapped && (
          <button
            className="qi-btn qi-btn-danger"
            disabled={busy}
            onClick={handleClear}
            style={{ marginLeft: 6 }}
          >
            Clear
          </button>
        )}
      </td>
    </tr>
  );
}

function MappingPanel({ batchId, detail, onSaveMapping, onClearMapping, onBack, onProceed }) {
  const { batch, counts, names } = detail;
  const [filter, setFilter] = useState("all"); // all | unmapped | accounts | categories
  const [createModal, setCreateModal] = useState({
    open: false,
    forName: null,
    suggestedName: "",
  });

  // Distinguish "accounts" (referenced as origin or transfer target) from
  // "categories" (referenced as the L tag's category name). Each `names` row
  // already has a `kind` field.

  const filtered = useMemo(() => {
    return names.filter((n) => {
      if (filter === "unmapped") return !n.mapped_account_id;
      if (filter === "mapped") return !!n.mapped_account_id;
      if (filter === "accounts") return n.kind === "account";
      if (filter === "categories") return n.kind === "category";
      return true;
    });
  }, [names, filter]);

  const [accountOptions, setAccountOptions] = useState([]);
  const refreshOptions = useCallback(() => {
    Rest.fetchAccountsV2().then((rows) => setAccountOptions(buildHierarchyOptions(rows)));
  }, []);
  useEffect(() => {
    refreshOptions();
  }, [refreshOptions]);

  // Mapping targets must be leaves (terminal asset/liability/income/expense
  // accounts). Container/parent rows are filtered out — they can still appear
  // in the Create-COA modal's parent picker, just not as a mapping target.
  const leafOptions = useMemo(
    () => accountOptions.filter((a) => a.isLeaf),
    [accountOptions]
  );

  // Parent picker in CreateCoaModal accepts only containers — a new leaf must
  // be added under an existing category, never under another leaf.
  const containerOptions = useMemo(
    () => accountOptions.filter((a) => !a.isLeaf),
    [accountOptions]
  );

  const handleOpenCreateModal = useCallback((rowName, query) => {
    setCreateModal({
      open: true,
      forName: rowName,
      suggestedName: query || rowName,
    });
  }, []);

  const handleCloseCreateModal = useCallback(() => {
    setCreateModal({ open: false, forName: null, suggestedName: "" });
  }, []);

  const handleCoaCreated = useCallback(
    async (newId) => {
      const forName = createModal.forName;
      handleCloseCreateModal();
      // Refresh COA options so the new leaf shows up in pickers.
      refreshOptions();
      // Auto-assign the new leaf to the originating mapping row.
      if (forName && newId) {
        await onSaveMapping(forName, newId);
      }
    },
    [createModal.forName, handleCloseCreateModal, onSaveMapping, refreshOptions]
  );

  const unmappedCount = names.filter((n) => !n.mapped_account_id).length;

  return (
    <div className="qi-section">
      <div className="qi-section-header">
        <button className="qi-btn" onClick={onBack}>← Batches</button>
        <h2>Mapping — {batch.label || batch.id.slice(0, 8)}</h2>
        <StatusBadge status={batch.status} />
      </div>

      <div className="qi-summary">
        <div className="qi-summary-card">
          <div className="qi-summary-label">Cash rows</div>
          <div className="qi-summary-value">{counts.cash}</div>
        </div>
        <div className="qi-summary-card">
          <div className="qi-summary-label">Investment events</div>
          <div className="qi-summary-value">{counts.invst}</div>
        </div>
        <div className="qi-summary-card">
          <div className="qi-summary-label">Securities master</div>
          <div className="qi-summary-value">{counts.securities}</div>
        </div>
        <div className="qi-summary-card">
          <div className="qi-summary-label">Prices</div>
          <div className="qi-summary-value">{counts.prices}</div>
        </div>
        <div className="qi-summary-card qi-summary-warn">
          <div className="qi-summary-label">Unmapped</div>
          <div className="qi-summary-value">{unmappedCount}</div>
        </div>
      </div>

      <div className="qi-filter-bar">
        {["all", "unmapped", "mapped", "accounts", "categories"].map((k) => (
          <button
            key={k}
            className={`qi-pill ${filter === k ? "qi-pill-active" : ""}`}
            onClick={() => setFilter(k)}
          >
            {k}
          </button>
        ))}
        <div className="qi-spacer" />
        <button
          className="qi-btn qi-btn-primary"
          disabled={unmappedCount > 0}
          onClick={onProceed}
          title={unmappedCount > 0 ? "Map all items before proceeding" : ""}
        >
          Continue to Pre-flight →
        </button>
      </div>

      <table className="qi-table">
        <thead>
          <tr>
            <th>Quicken name</th>
            <th>Kind</th>
            <th>Map to COA account</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((n) => (
            <MappingRow
              key={`${n.kind}:${n.name}`}
              name={n.name}
              kind={n.kind}
              mapped={n}
              accountOptions={leafOptions}
              onSave={onSaveMapping}
              onClear={onClearMapping}
              onCreateRequest={handleOpenCreateModal}
            />
          ))}
        </tbody>
      </table>

      <CreateCoaModal
        open={createModal.open}
        suggestedName={createModal.suggestedName}
        parentOptions={containerOptions}
        onClose={handleCloseCreateModal}
        onCreated={handleCoaCreated}
      />
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// VIEW 3 — Pre-flight + Promote + Rollback
// ───────────────────────────────────────────────────────────────────────────
function PreflightView({ batchId, batch, preflight, onPromote, onRollback, onBack, busy }) {
  return (
    <div className="qi-section">
      <div className="qi-section-header">
        <button className="qi-btn" onClick={onBack}>← Mapping</button>
        <h2>Pre-flight — {batch.label || batch.id.slice(0, 8)}</h2>
        <StatusBadge status={batch.status} />
      </div>

      {preflight.unmapped.length > 0 && (
        <div className="qi-alert qi-alert-error">
          <strong>{preflight.unmapped.length} unmapped item(s)</strong> — go back to mapping
          and resolve before promoting.
          <ul>
            {preflight.unmapped.slice(0, 10).map((n) => <li key={n}><code>{n}</code></li>)}
          </ul>
        </div>
      )}

      <h3>Per-account row counts</h3>
      <table className="qi-table">
        <thead>
          <tr><th>Quicken account</th><th>Rows in staging</th></tr>
        </thead>
        <tbody>
          {preflight.perQuickenAccount.map((r) => (
            <tr key={r.quicken_account_name}>
              <td><code>{r.quicken_account_name}</code></td>
              <td>{r.rows}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Per-account cutoff (CR §8.1)</h3>
      {preflight.cutoffs.length === 0 ? (
        <p className="qi-muted">No mapped accounts.</p>
      ) : (
        <table className="qi-table">
          <thead>
            <tr><th>COA account</th><th>Auto-detected cutoff</th></tr>
          </thead>
          <tbody>
            {preflight.cutoffs.map((c) => (
              <tr key={c.account_id}>
                <td>{c.account_name}</td>
                <td>
                  {c.auto_cutoff
                    ? new Date(c.auto_cutoff).toISOString().slice(0, 10)
                    : <span className="qi-muted">none (no PS coverage)</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>Transfers</h3>
      <p>{preflight.transferPairs} transfer pair(s) detected (will fan out to 2 cash rows each).</p>

      <div className="qi-action-bar">
        {batch.status !== "promoted" && batch.status !== "rolled_back" && (
          <button
            className="qi-btn qi-btn-primary"
            disabled={!preflight.canPromote || busy}
            onClick={onPromote}
          >
            {busy ? "Promoting…" : "Promote"}
          </button>
        )}
        {batch.status === "promoted" && (
          <button
            className="qi-btn qi-btn-danger"
            disabled={busy}
            onClick={onRollback}
          >
            {busy ? "Rolling back…" : "Rollback"}
          </button>
        )}
        {batch.status === "rolled_back" && (
          <p className="qi-muted">Rolled back. Staging rows preserved — you can re-map or re-promote.</p>
        )}
        {batch.status === "failed" && batch.failure_reason && (
          <div className="qi-alert qi-alert-error">
            <strong>Last promote failed:</strong> {batch.failure_reason}
          </div>
        )}
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// PAGE
// ───────────────────────────────────────────────────────────────────────────
export default function QuickenImport() {
  const toast = useToast();
  const [view, setView] = useState("list"); // 'list' | 'mapping' | 'preflight'
  const [batches, setBatches] = useState([]);
  const [pickedBatchId, setPickedBatchId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [preflight, setPreflight] = useState(null);
  const [busy, setBusy] = useState(false);

  const loadBatches = useCallback(async () => {
    try {
      const rows = await Rest.get("/quicken-import/batches");
      setBatches(rows);
    } catch (err) {
      toast.error(`Failed to load batches: ${err.message}`);
    }
  }, [toast]);

  const loadDetail = useCallback(async (id) => {
    try {
      const data = await Rest.get(`/quicken-import/batches/${id}`);
      setDetail(data);
    } catch (err) {
      toast.error(`Failed to load batch: ${err.message}`);
    }
  }, [toast]);

  const loadPreflight = useCallback(async (id) => {
    try {
      const data = await Rest.get(`/quicken-import/batches/${id}/preflight`);
      setPreflight(data);
    } catch (err) {
      toast.error(`Failed to load pre-flight: ${err.message}`);
    }
  }, [toast]);

  useEffect(() => { loadBatches(); }, [loadBatches]);

  const handlePick = useCallback((id) => {
    setPickedBatchId(id);
    setView("mapping");
    loadDetail(id);
  }, [loadDetail]);

  const handleSaveMapping = useCallback(async (externalName, accountId) => {
    try {
      await Rest.post(`/quicken-import/batches/${pickedBatchId}/mappings`, {
        external_name: externalName,
        account_id: accountId,
      });
      await loadDetail(pickedBatchId);
      toast.success(`Mapped "${externalName}"`);
    } catch (err) {
      toast.error(`Failed to save mapping: ${err.message}`);
    }
  }, [pickedBatchId, loadDetail, toast]);

  const handleClearMapping = useCallback(async (externalName) => {
    try {
      await Rest.del(
        `/quicken-import/batches/${pickedBatchId}/mappings?external_name=${encodeURIComponent(externalName)}`
      );
      await loadDetail(pickedBatchId);
      toast.success(`Cleared mapping for "${externalName}"`);
    } catch (err) {
      toast.error(`Failed to clear mapping: ${err.message}`);
    }
  }, [pickedBatchId, loadDetail, toast]);

  const handleGoToPreflight = useCallback(() => {
    setView("preflight");
    loadPreflight(pickedBatchId);
  }, [pickedBatchId, loadPreflight]);

  const handlePromote = useCallback(async () => {
    if (!window.confirm(
      "Promote this batch? This will insert rows into transactions and adjust opening_balance on touched accounts. Rollback is available afterward."
    )) return;
    setBusy(true);
    try {
      const result = await Rest.post(`/quicken-import/batches/${pickedBatchId}/promote`);
      toast.success(
        `Promoted: ${result.standaloneInserted + result.splitChildrenInserted + result.transferPairsInserted * 2} rows`
      );
      await loadDetail(pickedBatchId);
      await loadPreflight(pickedBatchId);
      await loadBatches();
    } catch (err) {
      toast.error(`Promote failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }, [pickedBatchId, loadDetail, loadPreflight, loadBatches, toast]);

  const handleRollback = useCallback(async () => {
    if (!window.confirm(
      "Roll back this batch? This deletes all transactions imported by it and restores opening_balance on touched accounts. Mappings are preserved."
    )) return;
    setBusy(true);
    try {
      const result = await Rest.post(`/quicken-import/batches/${pickedBatchId}/rollback`);
      toast.success(`Rolled back: ${result.deleted.transactions} transactions removed`);
      await loadDetail(pickedBatchId);
      await loadPreflight(pickedBatchId);
      await loadBatches();
    } catch (err) {
      toast.error(`Rollback failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }, [pickedBatchId, loadDetail, loadPreflight, loadBatches, toast]);

  return (
    <div className="page-container qi-page">
      {view === "list" && (
        <BatchList
          batches={batches}
          onPick={handlePick}
          onRefresh={loadBatches}
        />
      )}
      {view === "mapping" && detail && (
        <MappingPanel
          batchId={pickedBatchId}
          detail={detail}
          onSaveMapping={handleSaveMapping}
          onClearMapping={handleClearMapping}
          onBack={() => { setView("list"); loadBatches(); }}
          onProceed={handleGoToPreflight}
        />
      )}
      {view === "preflight" && preflight && detail && (
        <PreflightView
          batchId={pickedBatchId}
          batch={detail.batch}
          preflight={preflight}
          onPromote={handlePromote}
          onRollback={handleRollback}
          onBack={() => setView("mapping")}
          busy={busy}
        />
      )}
    </div>
  );
}
