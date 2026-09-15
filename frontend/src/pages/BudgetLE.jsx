import { useCallback, useEffect, useState } from "react";
import Rest from "../js/rest.js";
import Modal from "../components/Modal/Modal.jsx";
import LEGrid from "../features/BudgetLE/LEGrid.jsx";
import LECategorySheet from "../features/BudgetLE/LECategorySheet.jsx";
import LEDeviations from "../features/BudgetLE/LEDeviations.jsx";
import LEAdvisories from "../features/BudgetLE/LEAdvisories.jsx";
import "./PageLayout.css";

/**
 * CR083 — the Latest Estimate.
 *
 * Create an LE, read the summary in Chart-of-Accounts order, and edit any
 * category's estimate months in its own worksheet. A draft can be FINALISED:
 * its actual months are re-read and snapshotted, its full-year budget is frozen
 * beside them, and it can no longer be edited (§4.2). A final LE can be RE-CUT,
 * which supersedes it and starts a new draft; deleting that draft restores the
 * final LE it replaced (owner decision, 2026-09-14).
 *
 * One screen and no tab strip — §11.1 cut the Compare and Versions tabs with the
 * frozen-series reading the owner did not pick. Saved LEs are a picker in the
 * header. The confirm is the Radix `<Modal>`, not `ConfirmModal`, which CR086 §5
 * measured as having no Esc and no focus trap.
 */
const CONFIRM = {
  finalize: {
    title: "Finalise this estimate?",
    action: "Finalise",
    body: (le) =>
      `Finalising freezes ${le.name}: the actual months are re-read from the ledger and snapshotted, `
      + "the full-year budget is frozen beside them, and the estimate can no longer be edited. "
      + "Bookings that land later show up as drift, never as a silent change. To change it afterwards, re-cut it.",
  },
  recut: {
    title: "Re-cut this estimate?",
    action: "Re-cut",
    body: (le) =>
      `Re-cutting supersedes ${le.name} and starts a new draft on the same cut, re-reading the actual months `
      + "and carrying this estimate's months forward. The final version stays on record; deleting the new draft restores it.",
  },
  delete: {
    title: "Delete this estimate?",
    action: "Delete",
    body: (le) =>
      le.status === "draft"
        ? `Delete ${le.name}? This cannot be undone. If it was re-cut from a final estimate, that estimate is restored.`
        : `Delete ${le.name}? A final estimate is the record of what you said; deleting it cannot be undone.`,
  },
};

function BudgetLE() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [list, setList] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [grid, setGrid] = useState(null);
  const [deviations, setDeviations] = useState(null);
  const [advisories, setAdvisories] = useState(null);
  const [drift, setDrift] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [openCategory, setOpenCategory] = useState(null);

  const selected = list.find((l) => l.id === selectedId) || null;

  const loadList = useCallback(async (y) => {
    try {
      const rows = Rest.rows(await Rest.get(`/budget/le?year=${y}`));
      setList(rows);
      setSelectedId((prev) => (rows.some((r) => r.id === prev) ? prev : rows[0]?.id ?? null));
      if (!rows.length) setGrid(null);
    } catch (e) {
      console.error("[BudgetLE] list failed:", e);
      setError("Could not load the list of estimates.");
    }
  }, []);

  useEffect(() => { loadList(year); }, [year, loadList]);

  useEffect(() => {
    if (!selectedId) return undefined;
    let active = true;
    // Advisory reads: a failure clears the panel and never blocks the page.
    const advisory = (path, set) =>
      Rest.get(path)
        .then((p) => { if (active) set(Rest.unwrap(p) || null); })
        .catch(() => { if (active) set(null); });
    advisory(`/budget/le/${selectedId}/deviations`, setDeviations);
    advisory(`/budget/le/${selectedId}/advisories`, setAdvisories);
    advisory(`/budget/le/${selectedId}/drift`, setDrift);
    Rest.get(`/budget/le/${selectedId}/grid`)
      .then((p) => { if (active) { setGrid(Rest.unwrap(p) || null); setError(""); } })
      .catch((e) => {
        if (!active) return;
        console.error("[BudgetLE] grid failed:", e);
        setError("Could not load that estimate.");
      });
    return () => { active = false; };
  }, [selectedId, refreshKey]);

  const handleCreate = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const le = Rest.unwrap(await Rest.post("/budget/le", { budgetYear: year }));
      await loadList(year);
      setSelectedId(le.id);
    } catch (e) {
      // The schema refuses a second live LE on the same cut, a January LE and a
      // December cut. Say which, rather than surfacing the constraint name.
      const msg = String(e?.message || "");
      setError(
        // The open draft is named by the server, with the month-end order to follow.
        // (The error handler sends `{ error, status }` only, so match the 409's sentence.)
        e?.status === 409 && /still a draft/i.test(msg)
          ? msg
          : /budget_le_year_cut_uniq|duplicate/i.test(msg)
          ? `An estimate already exists for that cut. Delete it first, or wait for the next month to close.`
          : /not_january/i.test(msg)
            ? "An estimate needs at least one closed month — January is the earliest cut."
            : /not_month_13/i.test(msg)
              ? "December is not a cut: an estimate after December is just the actual year."
              : "Could not create the estimate."
      );
    } finally {
      setBusy(false);
    }
  };

  const runConfirmed = async () => {
    const kind = confirm;
    if (!kind || !selected) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (kind === "finalize") {
        await Rest.post(`/budget/le/${selected.id}/finalize`, {});
        await loadList(year);
        setRefreshKey((k) => k + 1);
        setNotice(`${selected.name} is final.`);
      } else if (kind === "recut") {
        const le = Rest.unwrap(await Rest.post(`/budget/le/${selected.id}/recut`, {}));
        await loadList(year);
        setSelectedId(le.id);
        setNotice(`${selected.name} is superseded; ${le.name} is a new draft.`);
      } else {
        const payload = await Rest.del(`/budget/le/${selected.id}`);
        const result = payload ? Rest.unwrap(payload) : null;
        setSelectedId(null);
        setGrid(null);
        await loadList(year);
        if (result?.restored) {
          setSelectedId(result.restored.id);
          setNotice(`Deleted ${selected.name}; ${result.restored.name} is final again.`);
        }
      }
    } catch (e) {
      console.error(`[BudgetLE] ${kind} failed:`, e);
      // A 409 carries the server's own sentence (e.g. "only a draft can be finalised").
      setError(e?.status === 409 && e?.message ? e.message : `Could not ${CONFIRM[kind].action.toLowerCase()} that estimate.`);
    } finally {
      setConfirm(null);
      setBusy(false);
    }
  };

  const years = [currentYear - 1, currentYear, currentYear + 1];
  const spec = confirm ? CONFIRM[confirm] : null;

  // Every panel renders only data for the SELECTED estimate. After a switch or a
  // recut the previous LE's figures would otherwise sit above the next one's until
  // its fetches land. Gated here rather than cleared in an effect, which the
  // set-state-in-effect lint rule (and the lint-debt ratchet) forbid.
  const forSelected = (d) => (d && (d.leId ?? d.le?.id) === selectedId ? d : null);
  const shownGrid = forSelected(grid);

  return (
    <main className="page-container">
      <div className="report-toolbar-header">
        <div className="report-toolbar-header__text">
          <h1 className="report-toolbar-header__title">Latest Estimate</h1>
          <p className="report-toolbar-header__description">
            Where the year lands: actual months to the cut, plus an estimate for
            the rest. Click a category to open its month-by-month worksheet.
          </p>
        </div>
      </div>

      <section className="le-toolbar" aria-label="Estimate selection">
        <label className="le-toolbar__field">
          <span className="le-toolbar__label">Year</span>
          <select
            className="le-toolbar__select"
            value={year}
            onChange={(e) => { setNotice(""); setYear(Number(e.target.value)); }}
          >
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>

        <label className="le-toolbar__field">
          <span className="le-toolbar__label">Estimate</span>
          <select
            className="le-toolbar__select"
            value={selectedId ?? ""}
            onChange={(e) => { setNotice(""); setSelectedId(Number(e.target.value)); }}
            disabled={!list.length}
          >
            {!list.length && <option value="">none yet</option>}
            {list.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}{l.label ? ` — ${l.label}` : ""} · {l.status} · actuals to {String(l.actual_through).slice(0, 10)}
              </option>
            ))}
          </select>
        </label>

        <div className="le-toolbar__actions">
          <button type="button" className="btn btn--primary" onClick={handleCreate} disabled={busy}>
            {busy ? "Working…" : "New estimate"}
          </button>
          {selected?.status === "draft" && (
            <button type="button" className="btn btn--outline" onClick={() => setConfirm("finalize")} disabled={busy}>
              Finalise
            </button>
          )}
          {selected?.status === "final" && (
            <button type="button" className="btn btn--outline" onClick={() => setConfirm("recut")} disabled={busy}>
              Re-cut
            </button>
          )}
          <button
            type="button"
            className="btn btn--outline"
            onClick={() => setConfirm("delete")}
            disabled={busy || !selected}
          >
            Delete
          </button>
        </div>
      </section>

      {error && <p className="le-error" role="alert">{error}</p>}
      {notice && <p className="le-notice" role="status">{notice}</p>}

      {!list.length && !error && (
        <p className="le-empty">
          No estimate for {year} yet. <strong>New estimate</strong> takes the
          actual months up to the last complete month and carries the budget for
          the rest.
        </p>
      )}

      {shownGrid && <LEAdvisories advisories={forSelected(advisories)} drift={forSelected(drift)} />}

      {shownGrid && (
        <LEDeviations data={forSelected(deviations)} onOpenCategory={setOpenCategory} />
      )}

      {shownGrid && <LEGrid grid={shownGrid} onOpenCategory={setOpenCategory} />}

      {openCategory != null && selectedId && (
        <LECategorySheet
          leId={selectedId}
          categoryId={openCategory}
          onClose={() => setOpenCategory(null)}
          // Re-read the summary after a save so the grid, the roll-ups and the
          // NET line cannot drift from the worksheet that just changed them.
          onSaved={() => setRefreshKey((k) => k + 1)}
        />
      )}

      <Modal
        open={spec != null}
        onClose={busy ? undefined : () => setConfirm(null)}
        dismissable={!busy}
        title={spec ? spec.title : ""}
        footer={
          spec && (
            <>
              <button type="button" className="btn btn--outline" onClick={() => setConfirm(null)} disabled={busy}>
                Cancel
              </button>
              <button type="button" className="btn btn--primary" onClick={runConfirmed} disabled={busy}>
                {busy ? "Working…" : spec.action}
              </button>
            </>
          )
        }
      >
        {spec && selected && <p className="le-confirm">{spec.body(selected)}</p>}
      </Modal>
    </main>
  );
}

export default BudgetLE;
