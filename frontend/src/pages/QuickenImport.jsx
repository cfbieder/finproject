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
  // Transfer accounts live under "Transfers" with section=profit_loss; label them
  // [Transfer] (not [P&L]) so they're not mistaken for income/expense accounts.
  const prefix = a.is_transfer
    ? "[Transfer]"
    : `[${a.section === "balance_sheet" ? "BS" : "P&L"}]`;
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
                  [{a.is_transfer ? "Transfer" : a.section === "balance_sheet" ? "BS" : "P&L"}]
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
// NewImportModal — UI-driven QIF parse. Select one or more QIF files; each
// becomes its own batch (per-account rollback/verify granularity). The filename
// minus extension is the Quicken account name, so it is shown read-only; only
// currency is editable (QIF carries no currency). Reads files as text and POSTs
// to /quicken-import/parse, which writes temp files and calls runParse().
function NewImportModal({ onClose, onDone }) {
  const toast = useToast();
  const [files, setFiles] = useState([]); // [{ file, name, account, currency }]
  const [busy, setBusy] = useState(false);

  const onPick = (e) => {
    const picked = Array.from(e.target.files || []);
    setFiles(
      picked.map((file) => ({
        file,
        name: file.name,
        account: file.name.replace(/\.[^.]+$/, ""),
        currency: "USD",
      }))
    );
  };

  const setCurrency = (idx, v) =>
    setFiles((prev) => prev.map((f, i) => (i === idx ? { ...f, currency: v } : f)));

  const submit = async () => {
    if (files.length === 0) return;
    setBusy(true);
    try {
      const payload = { files: [] };
      for (const f of files) {
        const content = await f.file.text();
        payload.files.push({ name: f.name, currency: f.currency || "USD", content });
      }
      const { results } = await Rest.post("/quicken-import/parse", payload);
      const ok = results.filter((r) => r.ok);
      const bad = results.filter((r) => !r.ok);
      if (ok.length) {
        const staged = ok.reduce((t, r) => t + (r.totalStaged || 0), 0);
        toast.showSuccess(`Parsed ${ok.length} file(s), ${staged} row(s) staged.`);
      }
      if (bad.length) {
        toast.showError(
          `${bad.length} file(s) failed: ${bad.map((b) => `${b.name} (${b.error})`).join("; ")}`
        );
      }
      onDone();
      if (bad.length === 0) onClose();
    } catch (err) {
      toast.showError(err.message || "Import failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="qi-modal-overlay" onClick={busy ? undefined : onClose}>
      <div className="qi-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="qi-modal-header">New Quicken Import</div>
        <div className="qi-modal-body">
          <p className="qi-modal-hint">
            Select one or more QIF files. Each becomes its own batch; the filename
            (without extension) is the Quicken account name. Set the currency for each.
          </p>
          <input type="file" accept=".qif,.QIF" multiple onChange={onPick} disabled={busy} />
          {files.length > 0 && (
            <table className="qi-table" style={{ marginTop: "0.75rem" }}>
              <thead>
                <tr>
                  <th>File</th>
                  <th>Account name</th>
                  <th>Currency</th>
                </tr>
              </thead>
              <tbody>
                {files.map((f, i) => (
                  <tr key={i}>
                    <td className="qi-source-files"><code>{f.name}</code></td>
                    <td>{f.account}</td>
                    <td>
                      <input
                        className="qi-select"
                        style={{ width: "5rem" }}
                        value={f.currency}
                        maxLength={3}
                        onChange={(e) => setCurrency(i, e.target.value.toUpperCase())}
                        disabled={busy}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="qi-modal-footer">
          <button className="qi-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button
            className="qi-btn qi-btn-primary"
            onClick={submit}
            disabled={busy || files.length === 0}
          >
            {busy ? "Parsing…" : `Import ${files.length || ""} file(s)`}
          </button>
        </div>
      </div>
    </div>
  );
}

function BatchList({ batches, onPick, onRefresh }) {
  const [showImport, setShowImport] = useState(false);
  return (
    <div className="qi-section">
      <div className="qi-section-header">
        <h2>Quicken Import Batches</h2>
        <div className="qi-header-actions">
          <button className="qi-btn qi-btn-primary" onClick={() => setShowImport(true)}>
            New Import
          </button>
          <button className="qi-btn" onClick={onRefresh}>Refresh</button>
        </div>
      </div>
      {batches.length === 0 ? (
        <p className="qi-empty">
          No batches yet. Click <strong>New Import</strong> to upload a QIF file, then
          return here to map and promote it.
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
      {showImport && (
        <NewImportModal onClose={() => setShowImport(false)} onDone={onRefresh} />
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// VIEW 2 — Mapping panels
// ───────────────────────────────────────────────────────────────────────────
// ───────────────────────────────────────────────────────────────────────────
// BulkCreateModal — for each selected row, creates a new COA leaf under the
// chosen parent (name = Quicken name, currency = Quicken account's currency
// or parent's inferred default) and maps the Quicken name to it. Designed for
// the Historical Accounts workflow (Option J in CR019 §8.4) where you want
// per-account preservation but don't want to click through N modals.
// ───────────────────────────────────────────────────────────────────────────
// A COA node is a "transfer node" if it is, or descends from, an account named
// "Transfers" — mirrors the server's computeIsTransfer (ancestor named
// 'Transfers'). A new leaf created under such a parent is is_transfer=TRUE.
function isTransferNode(opt) {
  if (!opt) return false;
  return opt.name === "Transfers" || (opt.ancestorPath || []).includes("Transfers");
}

// Whether a selected row may get a NEW leaf under the chosen parent. Bulk-create
// only creates leaves whose role fits the parent, so a rejected role mapping
// never orphans a freshly-created leaf:
//   origin / both → Balance Sheet, non-transfer parent
//   target_only   → Transfer parent (under "Transfers") → creates a Transfer leaf
//   category      → P&L, non-transfer parent
function bulkEligibility(role, parent) {
  if (!parent) return { ok: false, reason: "pick a parent first" };
  const parentIsTransfer = isTransferNode(parent);
  if (role === "target_only") {
    if (parentIsTransfer) return { ok: true };
    return { ok: false, reason: "transfer target — parent must be under Transfers (creates a Transfer leaf)" };
  }
  if (role === "category") {
    if (parent.section === "profit_loss" && !parentIsTransfer) return { ok: true };
    return { ok: false, reason: "category — needs a P&L (income/expense) parent" };
  }
  // origin / both → Balance Sheet leaf
  if (parent.section === "balance_sheet" && !parentIsTransfer) return { ok: true };
  return { ok: false, reason: "balance-sheet account — needs a Balance Sheet parent" };
}

function BulkCreateModal({ open, selectedRows, parentOptions, batchId, onClose, onSuccess }) {
  const [parentId, setParentId] = useState("");
  const [saving, setSaving] = useState(false);
  const [results, setResults] = useState([]);
  // Per-row currency overrides — keyed by row.name. User can edit per-row in
  // the dialog before submitting. Falls back to row.quicken_currency, then
  // parent default, then USD.
  const [currencyOverrides, setCurrencyOverrides] = useState({});

  useEffect(() => {
    if (open) {
      setParentId("");
      setResults([]);
      setCurrencyOverrides({});
    }
  }, [open]);

  if (!open) return null;

  const parent = parentOptions.find((a) => a.id === parentId);
  const parentDefaultCurrency = inferCurrencyFromParent(parent);

  // Restrict the parent picker to containers that fit the selected rows' role,
  // so you can't pick a parent that would make every row ineligible. For a
  // homogeneous selection: transfer targets → Transfer containers, categories →
  // P&L containers, accounts → Balance Sheet containers. Mixed → show all (the
  // per-row eligibility guard still applies).
  const selRoles = new Set(selectedRows.map((r) => r.role));
  const allTransfer = selectedRows.length > 0 && [...selRoles].every((r) => r === "target_only");
  const allCategory = selectedRows.length > 0 && [...selRoles].every((r) => r === "category");
  const allBS = selectedRows.length > 0 && [...selRoles].every((r) => r === "origin" || r === "both");
  const eligibleParentOptions = parentOptions.filter((p) => {
    if (allTransfer) return isTransferNode(p);
    if (allCategory) return p.section === "profit_loss" && !isTransferNode(p);
    if (allBS) return p.section === "balance_sheet" && !isTransferNode(p);
    return true;
  });
  const parentScopeLabel = allTransfer
    ? "Transfer containers (under Transfers)"
    : allCategory
      ? "P&L containers"
      : allBS
        ? "Balance Sheet containers"
        : null;

  const resolveCurrency = (row) =>
    (currencyOverrides[row.name] || row.quicken_currency || parentDefaultCurrency || "USD")
      .toUpperCase();

  const setRowCurrency = (name, value) => {
    setCurrencyOverrides((prev) => ({ ...prev, [name]: value }));
  };

  // Currency mix summary across selected rows, after applying overrides.
  const ccyMix = (() => {
    const counts = new Map();
    for (const r of selectedRows) {
      const c = resolveCurrency(r);
      counts.set(c, (counts.get(c) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  })();

  const handleCreate = async () => {
    if (!parent) return;
    setSaving(true);
    setResults([]);
    const out = [];
    for (const row of selectedRows) {
      // Role-aware guard: skip rows whose role doesn't fit the parent BEFORE
      // creating anything, so we never make a leaf the mapping will reject.
      const elig = bulkEligibility(row.role, parent);
      if (!elig.ok) {
        out.push({ name: row.name, ok: false, error: elig.reason });
        setResults([...out]);
        continue;
      }
      try {
        const ccy = resolveCurrency(row);
        if (!/^[A-Z]{3}$/.test(ccy)) {
          throw new Error(`Invalid currency "${ccy}" — must be a 3-letter ISO code`);
        }
        const created = await Rest.fetchJson("/api/v2/util/coa/add", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            path: [parent.name],
            name: row.name,
            currency: ccy,
          }),
        });
        try {
          await Rest.post(`/quicken-import/batches/${batchId}/mappings`, {
            external_name: row.name,
            account_id: created.id,
          });
        } catch (mapErr) {
          // Atomic: if the mapping is rejected, undo the leaf we just created
          // (only when it was newly added, not a reactivated existing account)
          // so a failed map never orphans a COA entry.
          if (created?.id && !created.moved) {
            try { await Rest.del(`/accounts/${created.id}`); } catch { /* best-effort cleanup */ }
          }
          throw mapErr;
        }
        out.push({ name: row.name, id: created.id, currency: ccy, ok: true });
      } catch (err) {
        out.push({ name: row.name, ok: false, error: err?.message || String(err) });
      }
      setResults([...out]);
    }
    setSaving(false);
    onSuccess(out);
  };

  const okCount = results.filter((r) => r.ok).length;
  const failCount = results.filter((r) => !r.ok).length;
  const done = results.length === selectedRows.length && !saving;

  // Role-aware preview: how many selected rows will actually get a new leaf vs
  // be skipped (e.g. target_only names, which map to a Transfer leaf instead).
  const eligibleCount = parent
    ? selectedRows.filter((r) => bulkEligibility(r.role, parent).ok).length
    : 0;
  const skippedCount = selectedRows.length - eligibleCount;

  return (
    <div className="qi-modal-overlay" onClick={done ? onClose : undefined}>
      <div className="qi-modal qi-modal-wide" onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="qi-modal-header">
          Bulk-create {selectedRows.length} new leaves and map
        </div>
        <div className="qi-modal-body">
          <p className="qi-modal-hint">
            Each row will get a new COA leaf named after its Quicken account, placed under the
            selected parent, with currency from the Quicken account (defaults to parent's currency,
            then USD). The Quicken name is auto-mapped to its new leaf.
          </p>
          <label className="qi-modal-field">
            <span>Parent for all new leaves</span>
            <AccountPicker
              value={parentId}
              options={eligibleParentOptions}
              onChange={setParentId}
              placeholder="Search for a parent COA account…"
            />
            {parentScopeLabel && (
              <span className="qi-modal-hint">
                Restricted to <strong>{parentScopeLabel}</strong> — matches the selected rows' role.
              </span>
            )}
          </label>
          {parent && (
            <div className="qi-modal-hint">
              Each new leaf inherits section ({parent.section === "balance_sheet" ? "Balance Sheet" : "P&L"})
              and type from <strong>{parent.name}</strong>.
            </div>
          )}
          {parent && skippedCount > 0 && (
            <div className="qi-modal-error">
              ⚠ {skippedCount} of {selectedRows.length} selected row(s) don't fit{" "}
              <strong>{parent.name}</strong> and will be skipped (no leaf created) — see Status.
              Mixed-role selections can't share one parent; bulk-create rows of a single role at a time.
            </div>
          )}
          {ccyMix.length > 0 && (
            <div className="qi-modal-hint">
              Currency mix across new leaves:{" "}
              {ccyMix.map(([c, n], i) => (
                <span key={c}>
                  {i > 0 && ", "}<strong>{n}× {c}</strong>
                </span>
              ))}{" "}
              — each row gets its own leaf with its own currency, so there's no mixing inside any one leaf.
            </div>
          )}
          <table className="qi-table qi-bulk-table">
            <thead>
              <tr>
                <th>Quicken name</th>
                <th>Currency (editable)</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {selectedRows.map((r) => {
                const result = results.find((x) => x.name === r.name);
                const resolvedCcy = resolveCurrency(r);
                const isUnknown = !r.quicken_currency && !currencyOverrides[r.name];
                const elig = parent ? bulkEligibility(r.role, parent) : null;
                return (
                  <tr key={r.name}>
                    <td><code>{r.name}</code></td>
                    <td>
                      <input
                        type="text"
                        className={isUnknown ? "qi-bulk-ccy-unknown" : "qi-bulk-ccy"}
                        value={currencyOverrides[r.name] ?? r.quicken_currency ?? parentDefaultCurrency ?? "USD"}
                        onChange={(e) => setRowCurrency(r.name, e.target.value.toUpperCase())}
                        maxLength={3}
                        disabled={saving}
                        title={isUnknown
                          ? "Currency unknown for this Quicken account (no origin file). Verify before creating."
                          : `Quicken currency: ${r.quicken_currency || "(inherited)"}`}
                      />
                      {isUnknown && <span className="qi-ccy-unknown-flag" title="Currency unknown — please verify">?</span>}
                    </td>
                    <td>
                      {!result && !saving && elig && (elig.ok
                        ? <span className="qi-muted">will create</span>
                        : <span className="qi-status-error">skip — {elig.reason}</span>)}
                      {!result && saving && <span className="qi-muted">queued…</span>}
                      {result?.ok && <span className="qi-status-ok">✓ id={result.id} ({resolvedCcy})</span>}
                      {result?.ok === false && <span className="qi-status-error">✗ {result.error}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {done && (
            <div className={failCount > 0 ? "qi-modal-error" : "qi-modal-hint"}>
              {okCount} created, {failCount} failed.
            </div>
          )}
        </div>
        <div className="qi-modal-footer">
          <button className="qi-btn" onClick={onClose} disabled={saving}>
            {done ? "Close" : "Cancel"}
          </button>
          {!done && (
            <button
              className="qi-btn qi-btn-primary"
              onClick={handleCreate}
              disabled={saving || !parent || eligibleCount === 0}
            >
              {saving ? `Creating… (${results.length}/${selectedRows.length})` : `Create ${eligibleCount} & assign`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// BulkMapModal — map every selected row to ONE existing COA leaf. The catch-all
// path (CR019 §8.4 Option J): point many transfer targets at `Transfer -
// Historical`, or many categories at one P&L leaf, in one shot. Only works on a
// homogeneous-role selection (one leaf can't be valid for both an account and a
// category); the leaf picker is filtered to that role's valid leaves.
// ───────────────────────────────────────────────────────────────────────────
// Parent remounts this via a changing `key` on open, so useState defaults give
// a fresh dialog each time — no reset effect needed.
function BulkMapModal({ open, selectedRows, optionsForRole, batchId, onClose, onSuccess }) {
  const [targetId, setTargetId] = useState("");
  const [saving, setSaving] = useState(false);
  const [results, setResults] = useState([]);

  if (!open) return null;

  const selRoles = new Set(selectedRows.map((r) => r.role));
  const homogeneousRole = selRoles.size === 1 ? [...selRoles][0] : null;
  const options = homogeneousRole ? optionsForRole(homogeneousRole) : [];
  const target = options.find((a) => a.id === targetId);
  const roleLabel =
    homogeneousRole === "target_only" ? "Transfer category leaf"
      : homogeneousRole === "category" ? "P&L leaf"
        : homogeneousRole === "origin" || homogeneousRole === "both" ? "Balance Sheet leaf"
          : null;

  const handleMap = async () => {
    if (!target) return;
    setSaving(true);
    setResults([]);
    const out = [];
    for (const row of selectedRows) {
      try {
        await Rest.post(`/quicken-import/batches/${batchId}/mappings`, {
          external_name: row.name,
          account_id: target.id,
        });
        out.push({ name: row.name, ok: true });
      } catch (err) {
        out.push({ name: row.name, ok: false, error: err?.message || String(err) });
      }
      setResults([...out]);
    }
    setSaving(false);
    onSuccess(out);
  };

  const okCount = results.filter((r) => r.ok).length;
  const failCount = results.filter((r) => !r.ok).length;
  const done = results.length === selectedRows.length && !saving;

  return (
    <div className="qi-modal-overlay" onClick={done ? onClose : undefined}>
      <div className="qi-modal qi-modal-wide" onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="qi-modal-header">
          Bulk-map {selectedRows.length} selected → one leaf
        </div>
        <div className="qi-modal-body">
          {!homogeneousRole ? (
            <div className="qi-modal-error">
              Your selection mixes roles ({[...selRoles].join(", ")}). One leaf can't be valid for
              all of them — select rows of a single role (all transfer targets, all categories, or
              all accounts) and try again.
            </div>
          ) : (
            <>
              <p className="qi-modal-hint">
                Map all {selectedRows.length} selected <strong>{homogeneousRole}</strong> name(s) to
                one existing <strong>{roleLabel}</strong>. Nothing is created.
              </p>
              <label className="qi-modal-field">
                <span>Target leaf</span>
                <AccountPicker
                  value={targetId}
                  options={options}
                  onChange={setTargetId}
                  placeholder={`Search ${roleLabel}s…`}
                />
              </label>
              <table className="qi-table qi-bulk-table">
                <thead>
                  <tr><th>Quicken name</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {selectedRows.map((r) => {
                    const result = results.find((x) => x.name === r.name);
                    return (
                      <tr key={r.name}>
                        <td><code>{r.name}</code></td>
                        <td>
                          {!result && saving && <span className="qi-muted">queued…</span>}
                          {!result && !saving && target && <span className="qi-muted">will map</span>}
                          {result?.ok && <span className="qi-status-ok">✓ mapped</span>}
                          {result?.ok === false && <span className="qi-status-error">✗ {result.error}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {done && (
                <div className={failCount > 0 ? "qi-modal-error" : "qi-modal-hint"}>
                  {okCount} mapped, {failCount} failed.
                </div>
              )}
            </>
          )}
        </div>
        <div className="qi-modal-footer">
          <button className="qi-btn" onClick={onClose} disabled={saving}>
            {done ? "Close" : "Cancel"}
          </button>
          {!done && homogeneousRole && (
            <button
              className="qi-btn qi-btn-primary"
              onClick={handleMap}
              disabled={saving || !target}
            >
              {saving ? `Mapping… (${results.length}/${selectedRows.length})` : `Map ${selectedRows.length} & assign`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// ConfirmModal — styled in-app replacement for window.confirm(). Pass a config
// object (or null) via `state`; onConfirm/onCancel close it.
// ───────────────────────────────────────────────────────────────────────────
function ConfirmModal({ state, busy, onConfirm, onCancel }) {
  if (!state) return null;
  return (
    <div className="qi-modal-overlay" onClick={busy ? undefined : onCancel}>
      <div className="qi-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="qi-modal-header">{state.title}</div>
        <div className="qi-modal-body">
          <p className="qi-modal-hint" style={{ whiteSpace: "pre-line" }}>{state.message}</p>
        </div>
        <div className="qi-modal-footer">
          <button className="qi-btn" onClick={onCancel} disabled={busy}>Cancel</button>
          <button
            className={`qi-btn ${state.danger ? "qi-btn-danger" : "qi-btn-primary"}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Working…" : (state.confirmLabel || "Confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}

function MappingRow({ name, kind, role, mapped, accountOptions, onSave, onClear, onCreateRequest, selectable, selected, onToggleSelected }) {
  const [value, setValue] = useState(mapped?.mapped_account_id || "");
  const [busy, setBusy] = useState(false);

  // Keep local state in sync with parent prop (e.g., after a create-and-assign
  // round-trip re-fetches the batch detail).
  useEffect(() => {
    setValue(mapped?.mapped_account_id || "");
  }, [mapped?.mapped_account_id]);

  // Q3 role-mismatch banner: if there's an existing mapping that doesn't fit
  // the current role (e.g., target_only mapped to a BS leaf from a previous
  // session before role filter), surface so user can remap.
  const roleMismatch = useMemo(() => {
    if (!mapped?.mapped_account_id) return null;
    const isTransfer = !!mapped.mapped_is_transfer;
    const section = mapped.mapped_section;
    if ((role === "origin" || role === "both") && (isTransfer || section !== "balance_sheet")) {
      return `Current mapping is ${isTransfer ? "a Transfer category" : "a P&L leaf"}, but "${name}" is an origin account — should map to a Balance Sheet leaf. Pick a new target below.`;
    }
    if (role === "target_only" && !isTransfer) {
      return `Current mapping is ${section === "balance_sheet" ? "a Balance Sheet leaf" : "a P&L leaf"}, but "${name}" is a transfer target — should map to a Transfer category leaf (e.g., Transfer - Historical). Pick a new target below.`;
    }
    if (role === "category" && (isTransfer || section !== "profit_loss")) {
      return `Current mapping is ${isTransfer ? "a Transfer category" : "a Balance Sheet leaf"}, but "${name}" is a category — should map to a P&L leaf.`;
    }
    return null;
  }, [role, mapped?.mapped_account_id, mapped?.mapped_is_transfer, mapped?.mapped_section, name]);

  // Currency mismatch warning. Only meaningful when:
  //   - the Quicken row has a known currency (origin account, not just a
  //     cross-file transfer target reference), AND
  //   - the picker has a value pointing at a balance-sheet leaf (P&L
  //     aggregation uses base_amount in USD, so mismatch is harmless there).
  const quickenCurrency = mapped?.quicken_currency;
  const selectedLeaf = useMemo(
    () => (value ? accountOptions.find((a) => a.id === parseInt(value, 10)) : null),
    [accountOptions, value]
  );
  const showCurrencyWarning =
    quickenCurrency &&
    selectedLeaf &&
    selectedLeaf.section === "balance_sheet" &&
    selectedLeaf.currency &&
    selectedLeaf.currency !== quickenCurrency;

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
  const isOrigin = role === "origin" || role === "both";
  return (
    <tr className={`${isMapped ? "qi-mapped" : "qi-unmapped"}${isOrigin ? " qi-row-origin" : ""}`}>
      {selectable && (
        <td className="qi-checkbox-cell">
          <input
            type="checkbox"
            checked={!!selected}
            onChange={() => onToggleSelected && onToggleSelected()}
            aria-label={`Select ${name}`}
          />
        </td>
      )}
      <td>
        <code>{name}</code>
        {quickenCurrency ? (
          <span className="qi-ccy-badge" title="Currency of this Quicken account">
            {quickenCurrency}
          </span>
        ) : kind === "account" ? (
          <span
            className="qi-ccy-badge qi-ccy-badge-unknown"
            title="Currency unknown — this Quicken account only appears as a transfer target. Currency will be inferred from the COA leaf you map to (or you can override in the bulk-create dialog)."
          >
            ?
          </span>
        ) : null}
      </td>
      <td className="qi-kind">{kind}</td>
      <td>
        {(() => {
          const t = isOrigin
            ? { label: "BS", cls: "qi-type-bs", title: "Maps to a Balance Sheet account" }
            : role === "category"
              ? { label: "P&L", cls: "qi-type-pl", title: "Maps to an income/expense (P&L) account" }
              : { label: "Transfer", cls: "qi-type-transfer", title: "Maps to a Transfer category" };
          return <span className={`qi-type-badge ${t.cls}`} title={t.title}>{t.label}</span>;
        })()}
      </td>
      <td>
        <AccountPicker
          value={value ? parseInt(value, 10) : ""}
          options={accountOptions}
          onChange={(id) => setValue(id || "")}
          onCreateRequest={(query) => onCreateRequest(name, query)}
        />
        {showCurrencyWarning && (
          <div className="qi-ccy-warning">
            ⚠ Quicken account is <strong>{quickenCurrency}</strong>; target leaf
            is <strong>{selectedLeaf.currency}</strong>. Calibration on this
            account will sum mixed currencies and produce incorrect numbers
            (see CR §12).
          </div>
        )}
        {roleMismatch && (
          <div className="qi-role-mismatch">
            ⚠ {roleMismatch}
          </div>
        )}
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

function MappingPanel({ batchId, detail, onSaveMapping, onClearMapping, onBack, onProceed, onReload }) {
  const { batch, counts, names } = detail;
  const [filter, setFilter] = useState("all"); // all | unmapped | accounts | categories
  const [createModal, setCreateModal] = useState({
    open: false,
    forName: null,
    suggestedName: "",
  });
  const [selectedKeys, setSelectedKeys] = useState(new Set());
  const [bulkCreateOpen, setBulkCreateOpen] = useState(false);
  const [bulkMapOpen, setBulkMapOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmState, setConfirmState] = useState(null);
  const toast = useToast();

  // Distinguish "accounts" (referenced as origin or transfer target) from
  // "categories" (referenced as the L tag's category name). Each `names` row
  // already has a `kind` field.

  const filtered = useMemo(() => {
    // Origin/both rows are THE accounts being imported (their QIF was parsed) —
    // hoist them to the top so the account you're pulling is always first.
    // Array.prototype.sort is stable, so non-origin rows keep their API order.
    const isOriginRole = (r) => r === "origin" || r === "both";
    return names
      .filter((n) => {
        if (filter === "unmapped") return !n.mapped_account_id;
        if (filter === "mapped") return !!n.mapped_account_id;
        if (filter === "accounts") return n.kind === "account";
        if (filter === "categories") return n.kind === "category";
        return true;
      })
      .sort((a, b) => (isOriginRole(b.role) ? 1 : 0) - (isOriginRole(a.role) ? 1 : 0));
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

  // Q2 role-aware filter — each MappingRow gets a specific picker list:
  //   origin/both → BS leaf only (asset/liability)
  //   target_only → Transfer category leaf only (is_transfer=TRUE)
  //   category    → P&L leaf only (income/expense, not transfer)
  const bsLeafOptions = useMemo(
    () => leafOptions.filter((a) => a.section === "balance_sheet" && !a.is_transfer),
    [leafOptions]
  );
  const transferLeafOptions = useMemo(
    () => leafOptions.filter((a) => a.is_transfer),
    [leafOptions]
  );
  const plLeafOptions = useMemo(
    () => leafOptions.filter((a) => a.section === "profit_loss" && !a.is_transfer),
    [leafOptions]
  );
  const optionsForRole = (role) => {
    if (role === "target_only") return transferLeafOptions;
    if (role === "category") return plLeafOptions;
    return bsLeafOptions; // origin, both
  };

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

  const rowKey = (n) => `${n.kind}:${n.name}`;
  const selectedRows = useMemo(
    () => filtered.filter((n) => selectedKeys.has(rowKey(n))),
    [filtered, selectedKeys]
  );
  const allVisibleSelected = filtered.length > 0 && selectedRows.length === filtered.length;
  const toggleRow = (n) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      const k = rowKey(n);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };
  const toggleAllVisible = () => {
    setSelectedKeys((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev);
        for (const n of filtered) next.delete(rowKey(n));
        return next;
      }
      const next = new Set(prev);
      for (const n of filtered) next.add(rowKey(n));
      return next;
    });
  };
  const clearSelection = () => setSelectedKeys(new Set());

  const doBulkDeactivate = async (targetIds) => {
    setConfirmState(null);
    setBulkBusy(true);
    let okCount = 0;
    let failCount = 0;
    for (const id of targetIds) {
      try {
        await Rest.del(`/accounts/${id}`);
        okCount += 1;
      } catch (err) {
        failCount += 1;
        // eslint-disable-next-line no-console
        console.warn(`Failed to deactivate id=${id}:`, err);
      }
    }
    setBulkBusy(false);
    clearSelection();
    if (failCount === 0) {
      toast.showSuccess(`Deactivated ${okCount} COA leaf(s).`);
    } else {
      toast.showError(`Deactivated ${okCount}; ${failCount} failed (see console).`);
    }
    if (onReload) onReload();
  };

  const handleBulkDeactivate = () => {
    const mappedSelected = selectedRows.filter((n) => n.mapped_account_id);
    if (mappedSelected.length === 0) {
      toast.showError("Select mapped rows first — deactivation hides the TARGET COA leaves.");
      return;
    }
    const targetIds = [...new Set(mappedSelected.map((n) => n.mapped_account_id))];
    setConfirmState({
      title: `Deactivate ${targetIds.length} COA leaf(s)?`,
      message:
        "Mark the target COA leaves as inactive (is_active=false). They'll be hidden from default reports but their data and history remain queryable. You can re-activate from COA Management anytime.",
      confirmLabel: "Deactivate",
      danger: true,
      onConfirm: () => doBulkDeactivate(targetIds),
    });
  };

  const handleBulkCreateSuccess = (results) => {
    const okCount = results.filter((r) => r.ok).length;
    const failCount = results.length - okCount;
    if (failCount === 0) {
      toast.showSuccess(`Created ${okCount} leaves and mapped Quicken accounts.`);
    } else {
      toast.showError(`${okCount} succeeded, ${failCount} failed.`);
    }
    clearSelection();
    if (onReload) onReload();
  };

  const handleBulkMapSuccess = (results) => {
    const okCount = results.filter((r) => r.ok).length;
    const failCount = results.length - okCount;
    if (failCount === 0) {
      toast.showSuccess(`Mapped ${okCount} Quicken name(s).`);
    } else {
      toast.showError(`${okCount} mapped, ${failCount} failed.`);
    }
    clearSelection();
    if (onReload) onReload();
  };

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

      {selectedKeys.size > 0 && (
        <div className="qi-bulk-bar">
          <span className="qi-bulk-count">{selectedKeys.size} selected</span>
          <button
            className="qi-btn qi-btn-primary"
            onClick={() => setBulkCreateOpen(true)}
            disabled={bulkBusy}
          >
            Bulk-create new leaves & map
          </button>
          <button
            className="qi-btn qi-btn-primary"
            onClick={() => setBulkMapOpen(true)}
            disabled={bulkBusy}
            title="Map all selected names to one existing COA leaf (e.g. Transfer - Historical)"
          >
            Bulk-map to existing leaf
          </button>
          <button
            className="qi-btn qi-btn-danger"
            onClick={handleBulkDeactivate}
            disabled={bulkBusy}
            title="Mark target COA leaves as inactive — they'll be hidden from default reports"
          >
            Deactivate target leaves
          </button>
          <button className="qi-btn" onClick={clearSelection} disabled={bulkBusy}>
            Clear selection
          </button>
        </div>
      )}

      <table className="qi-table">
        <thead>
          <tr>
            <th className="qi-checkbox-cell">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleAllVisible}
                aria-label="Select all visible rows"
              />
            </th>
            <th>Quicken name</th>
            <th>Kind</th>
            <th>Type</th>
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
              role={n.role}
              mapped={n}
              accountOptions={optionsForRole(n.role)}
              onSave={onSaveMapping}
              onClear={onClearMapping}
              onCreateRequest={handleOpenCreateModal}
              selectable={true}
              selected={selectedKeys.has(rowKey(n))}
              onToggleSelected={() => toggleRow(n)}
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

      <BulkCreateModal
        open={bulkCreateOpen}
        selectedRows={selectedRows}
        parentOptions={containerOptions}
        batchId={batchId}
        onClose={() => setBulkCreateOpen(false)}
        onSuccess={(results) => {
          setBulkCreateOpen(false);
          handleBulkCreateSuccess(results);
        }}
      />

      <BulkMapModal
        key={bulkMapOpen ? "bulkmap-open" : "bulkmap-closed"}
        open={bulkMapOpen}
        selectedRows={selectedRows}
        optionsForRole={optionsForRole}
        batchId={batchId}
        onClose={() => setBulkMapOpen(false)}
        onSuccess={(results) => {
          setBulkMapOpen(false);
          handleBulkMapSuccess(results);
        }}
      />

      <ConfirmModal
        state={confirmState}
        busy={bulkBusy}
        onConfirm={() => confirmState?.onConfirm?.()}
        onCancel={() => setConfirmState(null)}
      />
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────────
// VIEW 3 — Pre-flight + Promote + Rollback
// ───────────────────────────────────────────────────────────────────────────
function PreflightView({ batch, preflight, onPromote, onRollback, onBack, busy }) {
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

      {preflight.roleInvalid?.length > 0 && (
        <div className="qi-alert qi-alert-error">
          <strong>{preflight.roleInvalid.length} stored mapping(s) don't fit their role</strong>{" "}
          — likely stale pre-pivot mappings. Go back to mapping and remap them (the picker flags
          role mismatches) before promoting.
          <ul>
            {preflight.roleInvalid.slice(0, 10).map((r) => (
              <li key={r.name}>
                <code>{r.name}</code> ({r.role}) → {r.is_transfer ? "transfer leaf" : r.section === "balance_sheet" ? "BS leaf" : "P&L leaf"}
              </li>
            ))}
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
      <p>{preflight.transferPairs} transfer row(s) detected — each becomes one transaction
        (transfer_matched=FALSE); pair them later in Transfer Analysis.</p>

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
  const [confirmState, setConfirmState] = useState(null);

  const loadBatches = useCallback(async () => {
    try {
      const rows = await Rest.get(`/quicken-import/batches?_t=${Date.now()}`);
      setBatches(rows);
    } catch (err) {
      toast.showError(`Failed to load batches: ${err.message}`);
    }
  }, [toast]);

  const loadDetail = useCallback(async (id) => {
    try {
      // Cache-bust: a stale/legacy service worker or HTTP cache can otherwise
      // serve a pre-mapping snapshot, so the table never reflects saved mappings.
      const data = await Rest.get(`/quicken-import/batches/${id}?_t=${Date.now()}`);
      setDetail(data);
    } catch (err) {
      toast.showError(`Failed to load batch: ${err.message}`);
    }
  }, [toast]);

  const loadPreflight = useCallback(async (id) => {
    try {
      const data = await Rest.get(`/quicken-import/batches/${id}/preflight?_t=${Date.now()}`);
      setPreflight(data);
    } catch (err) {
      toast.showError(`Failed to load pre-flight: ${err.message}`);
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
      toast.showSuccess(`Mapped "${externalName}"`);
    } catch (err) {
      toast.showError(`Failed to save mapping: ${err.message}`);
    }
  }, [pickedBatchId, loadDetail, toast]);

  const handleClearMapping = useCallback(async (externalName) => {
    try {
      await Rest.del(
        `/quicken-import/batches/${pickedBatchId}/mappings?external_name=${encodeURIComponent(externalName)}`
      );
      await loadDetail(pickedBatchId);
      toast.showSuccess(`Cleared mapping for "${externalName}"`);
    } catch (err) {
      toast.showError(`Failed to clear mapping: ${err.message}`);
    }
  }, [pickedBatchId, loadDetail, toast]);

  const handleGoToPreflight = useCallback(() => {
    setView("preflight");
    loadPreflight(pickedBatchId);
  }, [pickedBatchId, loadPreflight]);

  const doPromote = useCallback(async () => {
    setConfirmState(null);
    setBusy(true);
    try {
      const result = await Rest.post(`/quicken-import/batches/${pickedBatchId}/promote`);
      const totalRows = result.standaloneInserted + result.splitChildrenInserted + result.transferRowsInserted;
      const transferMsg = result.transferRowsInserted > 0
        ? ` — ${result.transferRowsInserted} transfer rows inserted unmatched; run Transfer Analysis to pair them`
        : "";
      toast.showSuccess(`Promoted: ${totalRows} rows${transferMsg}`);
      await loadDetail(pickedBatchId);
      await loadPreflight(pickedBatchId);
      await loadBatches();
    } catch (err) {
      toast.showError(`Promote failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }, [pickedBatchId, loadDetail, loadPreflight, loadBatches, toast]);

  const handlePromote = useCallback(() => {
    setConfirmState({
      title: "Promote this batch?",
      message: "This will insert rows into transactions and adjust opening_balance on touched accounts. Rollback is available afterward.",
      confirmLabel: "Promote",
      danger: false,
      onConfirm: doPromote,
    });
  }, [doPromote]);

  const doRollback = useCallback(async () => {
    setConfirmState(null);
    setBusy(true);
    try {
      const result = await Rest.post(`/quicken-import/batches/${pickedBatchId}/rollback`);
      toast.showSuccess(`Rolled back: ${result.deleted.transactions} transactions removed`);
      await loadDetail(pickedBatchId);
      await loadPreflight(pickedBatchId);
      await loadBatches();
    } catch (err) {
      toast.showError(`Rollback failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }, [pickedBatchId, loadDetail, loadPreflight, loadBatches, toast]);

  const handleRollback = useCallback(() => {
    setConfirmState({
      title: "Roll back this batch?",
      message: "This deletes all transactions imported by it and restores opening_balance on touched accounts. Mappings are preserved.",
      confirmLabel: "Roll back",
      danger: true,
      onConfirm: doRollback,
    });
  }, [doRollback]);

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
          onReload={() => loadDetail(pickedBatchId)}
        />
      )}
      {view === "preflight" && preflight && detail && (
        <PreflightView
          batch={detail.batch}
          preflight={preflight}
          onPromote={handlePromote}
          onRollback={handleRollback}
          onBack={() => setView("mapping")}
          busy={busy}
        />
      )}
      <ConfirmModal
        state={confirmState}
        busy={busy}
        onConfirm={() => confirmState?.onConfirm?.()}
        onCancel={() => setConfirmState(null)}
      />
    </div>
  );
}
