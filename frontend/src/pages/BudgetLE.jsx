import { useCallback, useEffect, useState } from "react";
import Rest from "../js/rest.js";
import LEGrid from "../features/BudgetLE/LEGrid.jsx";
import "./PageLayout.css";

/**
 * CR083 P0b — the Latest Estimate.
 *
 * Read-only in this increment: create an LE, look at it, delete it. Editing the
 * estimate months, finalise, recut and the warnings come next.
 *
 * One screen and no tab strip — §11.1 cut the Compare and Versions tabs with the
 * frozen-series reading the owner did not pick. Saved LEs are a picker in the
 * header, which on day one holds exactly one row.
 */
function BudgetLE() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [list, setList] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [grid, setGrid] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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
    Rest.get(`/budget/le/${selectedId}/grid`)
      .then((p) => { if (active) { setGrid(Rest.unwrap(p) || null); setError(""); } })
      .catch((e) => {
        if (!active) return;
        console.error("[BudgetLE] grid failed:", e);
        setError("Could not load that estimate.");
      });
    return () => { active = false; };
  }, [selectedId]);

  const handleCreate = async () => {
    setBusy(true);
    setError("");
    try {
      const le = Rest.unwrap(await Rest.post("/budget/le", { budgetYear: year }));
      await loadList(year);
      setSelectedId(le.id);
    } catch (e) {
      // The schema refuses a second live LE on the same cut, a January LE and a
      // December cut. Say which, rather than surfacing the constraint name.
      const msg = String(e?.message || "");
      setError(
        /budget_le_year_cut_uniq|duplicate/i.test(msg)
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

  const handleDelete = async () => {
    if (!selectedId) return;
    setBusy(true);
    try {
      await Rest.del(`/budget/le/${selectedId}`);
      setSelectedId(null);
      setGrid(null);
      await loadList(year);
    } catch (e) {
      console.error("[BudgetLE] delete failed:", e);
      setError("Could not delete that estimate.");
    } finally {
      setBusy(false);
    }
  };

  const years = [currentYear - 1, currentYear, currentYear + 1];

  return (
    <main className="page-container">
      <div className="realization-toolbar-header">
        <div className="realization-toolbar-header__text">
          <h1 className="realization-toolbar-header__title">Latest Estimate</h1>
          <p className="realization-toolbar-header__description">
            Where the year lands: actual months to the cut, plus an estimate for
            the rest. Read-only for now — editing comes next.
          </p>
        </div>
      </div>

      <section className="le-toolbar" aria-label="Estimate selection">
        <label className="le-toolbar__field">
          <span className="le-toolbar__label">Year</span>
          <select
            className="le-toolbar__select"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          >
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>

        <label className="le-toolbar__field">
          <span className="le-toolbar__label">Estimate</span>
          <select
            className="le-toolbar__select"
            value={selectedId ?? ""}
            onChange={(e) => setSelectedId(Number(e.target.value))}
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
          <button
            type="button"
            className="btn btn--outline"
            onClick={handleDelete}
            disabled={busy || !selectedId}
          >
            Delete
          </button>
        </div>
      </section>

      {error && <p className="le-error" role="alert">{error}</p>}

      {!list.length && !error && (
        <p className="le-empty">
          No estimate for {year} yet. <strong>New estimate</strong> takes the
          actual months up to the last complete month and carries the budget for
          the rest.
        </p>
      )}

      {grid && <LEGrid grid={grid} />}
    </main>
  );
}

export default BudgetLE;
