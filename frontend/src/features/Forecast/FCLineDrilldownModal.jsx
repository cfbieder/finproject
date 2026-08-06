import { useEffect, useMemo, useState } from "react";
import Rest from "../../js/rest.js";
import Modal from "../../components/Modal/Modal.jsx";
import TransactionTable from "../Transaction/TransactionTable.jsx";
import { useTransactions } from "../Transaction/hooks/useTransactions.js";
import { useTransactionSelection } from "../Transaction/hooks/useTransactionSelection.js";
import { ACTUAL_CONFIG, BUDGET_CONFIG } from "../Transaction/transactionConfig.js";
import HierarchyFilter from "../../components/HierarchyFilter/HierarchyFilter.jsx";
import { useCoa } from "../../hooks/useCoa.js";
import "./FCLineDrilldownModal.css";

/**
 * CR072 QA — the transactions behind one FC line's figure, in a real modal.
 *
 * This replaces an inline per-account list. The owner asked for "a proper popup modal that we can
 * then filter similar to the actuals page", and the important design decision is that it REUSES
 * the Actuals page's machinery rather than reimplementing it: `useTransactions`, `ACTUAL_CONFIG`
 * and `TransactionTable`, the same three pieces `/trans-actual` is built from.
 *
 * That is not laziness, it is the point. A second, hand-rolled transaction list would drift from
 * the page it imitates — different date-range semantics, a search that filters the loaded page
 * instead of the server (the CR068 P1 defect), a different idea of which rows a category covers.
 * Sharing the parts makes those disagreements impossible.
 *
 * The categories are PRE-FILLED from the line's own leaves, so the modal opens showing the drill,
 * not every transaction in the year. Widening from there is one click, and the chip count says
 * how many leaves the line has — `Property Costs` is 35.
 */
/** The synthetic group holding the line's own leaf accounts, beside the real COA groups. */
const LINE_GROUP = "__fc_line__";

export default function FCLineDrilldownModal({
  isOpen,
  onClose,
  year,
  fcLineId,
  lineName,
  kind = "actual",
}) {
  const [leafNames, setLeafNames] = useState([]);
  const [leavesLoading, setLeavesLoading] = useState(false);
  const [search, setSearch] = useState("");
  // null means "not yet narrowed by hand" — the drill is still showing the line's own accounts.
  // Distinct from [], which the All pill emits and which means no category restriction at all.
  const [pickedCategories, setPickedCategories] = useState(null);

  // The line's leaf accounts, taken from the breakdown route — the same recursive CTE the total
  // itself uses, so the modal cannot disagree with the figure that opened it about which accounts
  // count. Deriving the leaves a second way here is exactly how the two would drift apart.
  useEffect(() => {
    let active = true;
    if (!isOpen || !fcLineId || !year) return undefined;
    setLeavesLoading(true);
    setSearch("");
    setPickedCategories(null);
    (async () => {
      try {
        const rows = kind === "budget"
          ? await Rest.fetchFcLineBudgetBreakdown(year, fcLineId)
          : await Rest.fetchFcLineActualBreakdown(year, fcLineId);
        if (!active) return;
        setLeafNames([...new Set((rows || []).map((r) => r.account_name).filter(Boolean))]);
      } catch {
        if (active) setLeafNames([]);
      } finally {
        if (active) setLeavesLoading(false);
      }
    })();
    return () => { active = false; };
  }, [isOpen, fcLineId, year, kind]);

  // The line's own accounts as a group, sitting beside the ordinary COA groups. Selecting the
  // line group re-checks all of its leaves, so the way back to the opening view is one click.
  const { plTree } = useCoa();
  const groups = useMemo(() => {
    const lineGroup = {
      key: LINE_GROUP,
      label: lineName || "This line",
      node: { name: lineName || "This line", children: leafNames.map((name) => ({ name })) },
    };
    return [lineGroup, ...(plTree || []).map((node) => ({ key: node.name, label: node.name, node }))];
  }, [plTree, leafNames, lineName]);

  const selectedCategories = pickedCategories ?? leafNames;

  // The budget row must read BUDGET entries, not transactions — the two totals come from
  // different tables, and pointing both drills at `/transactions` would have shown actuals
  // under a heading that says Budget.
  const config = kind === "budget" ? BUDGET_CONFIG : ACTUAL_CONFIG;
  const canSearch = config.hasDescriptionFilter;

  const filters = useMemo(() => ({
    ...config.defaultFilters,
    // A whole calendar year, which is what the figure on the card covers. Both month bounds are
    // set explicitly: `monthEnabled: false` alone falls through to `fromMonth`/`toMonth`, and the
    // Actuals defaults carry the CURRENT month — which would have shown one month under a
    // full-year figure.
    yearEnabled: true,
    monthEnabled: false,
    year: String(year),
    toYear: String(year),
    fromMonth: "01",
    toMonth: "12",
    categoryEnabled: selectedCategories.length > 0,
    category: selectedCategories,
    descriptionEnabled: canSearch && search.trim().length > 0,
    description: canSearch ? search.trim() : "",
  }), [config, year, selectedCategories, search, canSearch]);

  const idle = useMemo(
    () => ({ ...config.defaultFilters, yearEnabled: false }),
    [config]
  );
  const { transactions, isLoading, error, hasMoreTransactions, setTransactionLimit } =
    useTransactions(config, isOpen ? filters : idle);

  // `TransactionTable` does not take transactions — it takes `{ entry, rowId, isSelected }`
  // wrappers, which is what this hook produces. Sorting them by hand looked equivalent and was
  // not: every cell read `entry[column.key]` off an undefined `entry` and the render threw,
  // taking the module editor down with it.
  const { sortedTransactions, sortConfig, handleSort } =
    useTransactionSelection(transactions || []);

  // Totals per currency, because a line is routinely multi-currency — `Property Costs` draws on
  // EUR, PLN and USD. Only the base column may be summed across them; the locals are reported
  // separately for the same reason the breakdown splits them (the CR064 P8 class).
  const totals = useMemo(() => {
    const byCcy = {};
    let base = 0;
    for (const t of transactions || []) {
      const ccy = t?.Currency || t?.currency || "?";
      byCcy[ccy] = (byCcy[ccy] ?? 0) + Number(t?.Amount ?? t?.amount ?? 0);
      base += Number(t?.BaseAmount ?? t?.base_amount ?? 0);
    }
    return { byCcy, base };
  }, [transactions]);

  const fmt = (n) => Math.abs(n).toLocaleString(undefined, {
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  });

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      bare
      ariaLabel="FC line drill-down"
      /* This is a dialog inside a dialog (opened from the module editor). Outside-click dismissal
         is off because the click that opens it lands "outside" the not-yet-mounted layer. */
      closeOnOutside={false}
    >
      <div className="fc-drill">
        <div className="fc-drill__head">
          <div>
            <h3 className="fc-drill__title">{lineName || "Line"} — {year}</h3>
            <p className="fc-drill__sub">
              {kind === "budget" ? "Budget entries" : "Actual transactions"}
              {/* Says what is actually being counted, which stops being "this line" the moment
                  the reader narrows or widens the filter below. */}
              {leavesLoading ? " · loading accounts…"
                : selectedCategories.length === 0 ? " · every category"
                : pickedCategories == null
                  ? ` · ${leafNames.length} account${leafNames.length === 1 ? "" : "s"} on this line`
                  : ` · ${selectedCategories.length} categor${selectedCategories.length === 1 ? "y" : "ies"} selected`}
            </p>
          </div>
          <button type="button" className="fc-drill__close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="fc-drill__totals">
          {Object.entries(totals.byCcy).map(([ccy, v]) => (
            <div key={ccy} className="fc-drill__total">
              <span>{ccy}</span><strong>{fmt(v)}</strong>
            </div>
          ))}
          <div className="fc-drill__total fc-drill__total--base">
            <span>USD (base)</span><strong>{fmt(totals.base)}</strong>
          </div>
          <div className="fc-drill__total">
            <span>Rows</span><strong>{(transactions || []).length}</strong>
          </div>
        </div>

        {/* The totals above are summed over the LOADED rows. Past the batch size that makes them a
            partial sum, so the cap is stated rather than left to look like the whole. */}
        {hasMoreTransactions && (
          <p className="fc-drill__truncated">
            Showing the first {(transactions || []).length} rows — the totals above cover only
            these.{" "}
            <button type="button" onClick={() => setTransactionLimit((n) => n + 2000)}>
              Load more
            </button>
          </p>
        )}

        <div className="fc-drill__controls">
          {/* The same category filter the Actuals page uses, opened on the line's own accounts:
              type to narrow, tick to include, right-click to select only one, and the All pill to
              drop the restriction entirely. A second, bespoke picker here would be one more thing
              to disagree with that page about what a category covers. */}
          <HierarchyFilter
            label="Categories"
            groups={groups}
            initialGroupKey={LINE_GROUP}
            onSelectionChange={setPickedCategories}
          />
          {/* Offered only where the config reads it — BUDGET_CONFIG has no description filter,
              and a search box that silently does nothing is worse than no search box. Named for
              what the server actually matches: `description1 ILIKE … OR description2 ILIKE …`,
              and nothing else. */}
          {canSearch && (
            <input
              type="search"
              className="form-input"
              placeholder="Search descriptions…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          )}
        </div>

        <div className="fc-drill__table">
          <TransactionTable
            config={config}
            isLoading={isLoading || leavesLoading}
            error={error}
            hasTransactions={(transactions || []).length > 0}
            hasFilteredTransactions={sortedTransactions.length > 0}
            sortedTransactions={sortedTransactions}
            sortConfig={sortConfig}
            onSort={handleSort}
            showSelection={false}
          />
        </div>
      </div>
    </Modal>
  );
}
