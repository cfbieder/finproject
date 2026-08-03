import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Calendar,
  ChevronDown,
  Loader2,
  Search,
  Tag,
  Wallet,
  X,
} from "lucide-react";
import { ACTUAL_CONFIG } from "../../features/Transaction/transactionConfig.js";
import {
  periodToFilterFields,
  summarizeActualTotals,
} from "../../features/Transaction/transactionUtils.js";
import { useTransactions } from "../../features/Transaction/hooks/useTransactions.js";
import { buildPeriodChipLabel } from "../../components/PeriodSelector/PeriodSelector.jsx";
import { useCoa } from "../../hooks/useCoa.js";
import Rest from "../../js/rest.js";
import { parseDisplayDate } from "../../utils/dateHelpers.js";
import EmptyState from "../../components/EmptyState.jsx";
import MobilePickerSheet from "../MobilePickerSheet.jsx";
import MobilePeriodSheet from "../MobilePeriodSheet.jsx";
import { collectGroupedLeaves, collectAccountSections } from "../treeSections.js";

const config = ACTUAL_CONFIG;

// 100, not the desktop's 500: a phone renders 500 cards slowly and nobody
// scrolls past 100 before reaching for a filter.
const PAGE_SIZE = 100;
const SEARCH_DEBOUNCE_MS = 300;

const CURRENT_YEAR = new Date().getFullYear();
const CURRENT_MONTH = String(new Date().getMonth() + 1).padStart(2, "0");

const numFmt = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const money = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n < 0 ? `(${numFmt.format(Math.abs(n))})` : numFmt.format(n);
};

// parseDisplayDate, not `new Date(value)`: a date-only string parses as UTC
// midnight and renders a day early west of UTC (Known Issue #3).
const formatDate = (value) => {
  const d = parseDisplayDate(value);
  if (!d) return "—";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "2-digit",
  });
};

const initialPeriod = {
  fromMonth: CURRENT_MONTH,
  toMonth: CURRENT_MONTH,
  actualYear: CURRENT_YEAR,
  toYear: CURRENT_YEAR,
};

/**
 * One filter chip: a wide tap target that opens its sheet, plus an optional
 * clear. Two sibling buttons in a wrapper rather than one nested in the other —
 * a button may not contain a button, and a role="button" span inside one is the
 * same problem wearing a different hat.
 */
function FilterChip({ icon: Icon, label, active, onOpen, onClear, clearLabel }) {
  return (
    <div className={"m-fchip" + (active ? " m-fchip--active" : "")}>
      <button type="button" className="m-fchip__open" onClick={onOpen}>
        <Icon size={14} />
        <span className="m-fchip__label">{label}</span>
        {!onClear && <ChevronDown size={14} />}
      </button>
      {onClear && (
        <button
          type="button"
          className="m-fchip__clear"
          onClick={onClear}
          aria-label={clearLabel}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

/**
 * Actuals search for a phone (CR068 P1).
 *
 * Filtering is entirely server-side and the filter object is ACTUAL_CONFIG
 * shaped, so `useTransactions` — query building, batching, abort, row transform
 * — is reused verbatim from the desktop page. Rebuilding the query here is how
 * the two pages would start disagreeing about which rows August contains.
 */
export default function MobileTransactions() {
  const [filters, setFilters] = useState(() => ({
    ...config.defaultFilters,
    ...periodToFilterFields(initialPeriod),
  }));
  const [period, setPeriod] = useState(initialPeriod);
  const [sheet, setSheet] = useState(null); // "period" | "accounts" | "categories"
  const [searchText, setSearchText] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const [totals, setTotals] = useState({
    byCurrency: [],
    income: 0,
    expense: 0,
    net: 0,
    truncated: false,
  });

  const { plTree, bsTree } = useCoa();

  const categorySections = useMemo(() => collectGroupedLeaves(plTree), [plTree]);
  const accountSections = useMemo(() => collectAccountSections(bsTree), [bsTree]);

  const {
    transactions,
    hasMoreTransactions,
    isLoading,
    error,
    setTransactionLimit,
  } = useTransactions(config, filters);

  // Reset paging on any filter change — a new filter with an old offset shows
  // the tail of a result set the user has not seen the head of.
  const applyFilters = useCallback(
    (patch) => {
      setFilters((prev) => ({ ...prev, ...patch }));
      setTransactionLimit(PAGE_SIZE);
      setSheet(null);
    },
    [setTransactionLimit]
  );

  // Search goes to the SERVER, debounced. Filtering the loaded page client-side
  // (what the desktop box does) would search 100 of thousands of rows on a
  // phone and report "no results" for transactions that exist.
  useEffect(() => {
    const q = searchText.trim();
    const t = setTimeout(() => {
      setFilters((prev) => {
        if (prev.description === q && prev.descriptionEnabled === !!q) return prev;
        return { ...prev, descriptionEnabled: !!q, description: q };
      });
      setTransactionLimit(PAGE_SIZE);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchText, setTransactionLimit]);

  // Totals come from the server, not the loaded page — "load more" means the
  // rows on screen are never the whole answer.
  useEffect(() => {
    const controller = new AbortController();
    let isActive = true;
    (async () => {
      try {
        const query = new URLSearchParams();
        config.buildTotalsQuery(query, filters);
        const path = `${config.totalsEndpoint}?${query.toString()}`;
        const payload = await Rest.fetchJson(path, { signal: controller.signal });
        if (!isActive) return;
        setTotals({
          ...summarizeActualTotals(config.parseTotalsEntries(payload), config),
          truncated: payload?.truncated === true,
        });
      } catch (err) {
        if (err?.name === "AbortError" || !isActive) return;
        setTotals({
          byCurrency: [],
          income: 0,
          expense: 0,
          net: 0,
          truncated: false,
        });
      }
    })();
    return () => {
      isActive = false;
      controller.abort();
    };
  }, [filters]);

  const selectedAccounts = filters.accountEnabled ? filters.account : [];
  const selectedCategories = filters.categoryEnabled ? filters.category : [];

  const chipLabel = (list, plural) => {
    if (list.length === 0) return `All ${plural}`;
    if (list.length === 1) return list[0];
    return `${list.length} ${plural}`;
  };

  return (
    <div>
      <div className="m-searchbar">
        <input
          type="search"
          className="m-searchbar__input"
          placeholder="Search descriptions…"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Search descriptions"
        />
        {searchText ? (
          <button
            type="button"
            className="m-searchbar__clear"
            onClick={() => setSearchText("")}
            aria-label="Clear search"
          >
            <X size={18} />
          </button>
        ) : (
          <span className="m-searchbar__clear" aria-hidden="true">
            <Search size={17} />
          </span>
        )}
      </div>

      <div className="m-filterbar">
        <FilterChip
          icon={Calendar}
          label={buildPeriodChipLabel(filters)}
          active
          onOpen={() => setSheet("period")}
        />
        <FilterChip
          icon={Wallet}
          label={chipLabel(selectedAccounts, "accounts")}
          active={selectedAccounts.length > 0}
          onOpen={() => setSheet("accounts")}
          onClear={
            selectedAccounts.length > 0
              ? () => applyFilters({ accountEnabled: false, account: [] })
              : null
          }
          clearLabel="Clear account filter"
        />
        <FilterChip
          icon={Tag}
          label={chipLabel(selectedCategories, "categories")}
          active={selectedCategories.length > 0}
          onOpen={() => setSheet("categories")}
          onClear={
            selectedCategories.length > 0
              ? () => applyFilters({ categoryEnabled: false, category: [] })
              : null
          }
          clearLabel="Clear category filter"
        />
      </div>

      <div className="m-totals">
        <span className="m-totals__count">
          {transactions.length.toLocaleString()}
          {hasMoreTransactions ? "+" : ""} result
          {transactions.length === 1 ? "" : "s"}
        </span>
        {totals.byCurrency.map(({ currency, amount }) => (
          <span
            key={currency}
            className={"m-totals__item" + (amount < 0 ? " m-totals__item--neg" : "")}
          >
            {money(amount)} {currency}
          </span>
        ))}
        {totals.byCurrency.length > 0 && (
          <span className="m-totals__item m-totals__item--base">
            {money(totals.net)} base
          </span>
        )}
        {totals.truncated && (
          <span className="m-totals__warn">
            At least — totals cover the first 2,000 rows in range.
          </span>
        )}
      </div>

      {isLoading && transactions.length === 0 && (
        <div className="m-state">
          <Loader2 size={28} className="m-spin" />
          <span>Loading transactions…</span>
        </div>
      )}

      {error && (
        <div className="m-state m-state--error">
          <AlertTriangle size={28} />
          <span>{error}</span>
        </div>
      )}

      {!isLoading && !error && transactions.length === 0 && (
        <EmptyState variant="searching" message="No transactions match these filters" />
      )}

      {transactions.length > 0 && (
        <div className="m-tx-list">
          {transactions.map((entry) => {
            const amount = Number(entry.Amount);
            const isOpen = expandedId === entry._id;
            return (
              // A div, not a button: the expanded detail is a <dl>, and a
              // button may only contain phrasing content.
              <div
                className="m-tx m-tx--tappable"
                key={entry._id}
                role="button"
                tabIndex={0}
                aria-expanded={isOpen}
                onClick={() => setExpandedId(isOpen ? null : entry._id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setExpandedId(isOpen ? null : entry._id);
                  }
                }}
              >
                <span className="m-tx__desc">{entry.Description1 || "—"}</span>
                <span
                  className={
                    "m-tx__amt " +
                    (amount < 0 ? "m-tx__amt--neg" : "m-tx__amt--pos")
                  }
                >
                  {money(amount)}
                </span>
                <span className="m-tx__meta">
                  {formatDate(entry.Date)} · {entry.Account || "—"} ·{" "}
                  {entry.Category || "Uncategorized"}
                </span>
                {isOpen && (
                  <dl className="m-tx__detail">
                    <dt>Currency</dt>
                    <dd>{entry.Currency || "—"}</dd>
                    <dt>Base</dt>
                    <dd>
                      {money(entry.BaseAmount)} {entry.BaseCurrency || ""}
                    </dd>
                    {entry.Description2 && (
                      <>
                        <dt>Detail</dt>
                        <dd>{entry.Description2}</dd>
                      </>
                    )}
                  </dl>
                )}
              </div>
            );
          })}
        </div>
      )}

      {hasMoreTransactions && (
        <button
          type="button"
          className="m-seeall"
          onClick={() => setTransactionLimit((prev) => prev + PAGE_SIZE)}
          disabled={isLoading}
        >
          {isLoading ? "Loading…" : `Load ${PAGE_SIZE} more`}
        </button>
      )}

      <MobilePeriodSheet
        open={sheet === "period"}
        value={period}
        onClose={() => setSheet(null)}
        onApply={(next) => {
          setPeriod(next);
          applyFilters(periodToFilterFields(next));
        }}
      />

      <MobilePickerSheet
        open={sheet === "accounts"}
        multi
        sections={accountSections}
        selected={selectedAccounts}
        title="Accounts"
        searchPlaceholder="Search accounts…"
        emptyText="No matching accounts"
        onClose={() => setSheet(null)}
        onApply={(names) =>
          applyFilters({ accountEnabled: names.length > 0, account: names })
        }
      />

      <MobilePickerSheet
        open={sheet === "categories"}
        multi
        sections={categorySections}
        selected={selectedCategories}
        title="Categories"
        searchPlaceholder="Search categories…"
        emptyText="No matching categories"
        onClose={() => setSheet(null)}
        onApply={(names) =>
          applyFilters({ categoryEnabled: names.length > 0, category: names })
        }
      />
    </div>
  );
}
