import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, AlertTriangle, Loader2 } from "lucide-react";
import Rest from "../../js/rest.js";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const formatKpi = (value) => {
  const n = value ?? 0;
  return n < 0
    ? `(${currencyFormatter.format(Math.abs(n))})`
    : currencyFormatter.format(n);
};

const getToday = () => {
  const d = new Date();
  const pad = (v) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const formatAsOf = (iso) => {
  try {
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
};

const findTopLevel = (accounts, name) => {
  if (!Array.isArray(accounts)) return null;
  return (
    accounts.find((a) => (a.name ?? "").toLowerCase() === name.toLowerCase()) ||
    null
  );
};

// Flatten an account subtree to its leaf accounts (no children).
const flattenLeaves = (account, out = []) => {
  if (!account) return out;
  const children = Array.isArray(account.children) ? account.children : [];
  if (children.length === 0) {
    out.push(account);
    return out;
  }
  for (const c of children) flattenLeaves(c, out);
  return out;
};

// Build the list of Level-1 groups (children of "Assets" and "Liabilities").
const buildLevel1Groups = (report) => {
  const assets = findTopLevel(report, "assets");
  const liabilities = findTopLevel(report, "liabilities");
  const groups = [];
  if (assets) {
    for (const child of assets.children ?? []) {
      groups.push({ key: `A:${child.name}`, kind: "asset", node: child });
    }
  }
  if (liabilities) {
    for (const child of liabilities.children ?? []) {
      groups.push({ key: `L:${child.name}`, kind: "liability", node: child });
    }
  }
  return groups;
};

export default function MobileBalance() {
  const [asOfDate] = useState(getToday);
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [openKeys, setOpenKeys] = useState(() => new Set());

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError("");
    Rest.fetchBalanceReportV2(asOfDate)
      .then((data) => {
        if (cancelled) return;
        setReport(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message ?? "Failed to load balance report");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [asOfDate]);

  const kpis = useMemo(() => {
    if (!report) return null;
    const assets = findTopLevel(report, "assets")?.totalUSD ?? 0;
    const liabilities = findTopLevel(report, "liabilities")?.totalUSD ?? 0;
    return {
      netWorth: assets + liabilities,
      assets,
      liabilities,
    };
  }, [report]);

  const groups = useMemo(() => buildLevel1Groups(report), [report]);

  const toggle = useCallback((key) => {
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  if (isLoading && !report) {
    return (
      <div className="m-state">
        <Loader2 size={28} className="m-spin" />
        <span>Loading balances…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="m-state m-state--error">
        <AlertTriangle size={28} />
        <span>{error}</span>
      </div>
    );
  }

  if (!report) return null;

  return (
    <div>
      <div className="m-page-meta">
        <span className="m-pill">As of {formatAsOf(asOfDate)}</span>
      </div>

      {kpis && (
        <div className="m-kpis">
          <div className="m-kpi m-kpi--hero">
            <span className="m-kpi__label">Net Worth</span>
            <span
              className={
                "m-kpi__value" +
                (kpis.netWorth < 0 ? " m-kpi__value--negative" : "")
              }
            >
              {formatKpi(kpis.netWorth)}
            </span>
          </div>
          <div className="m-kpi">
            <span className="m-kpi__label">Total Assets</span>
            <span className="m-kpi__value m-kpi__value--positive">
              {formatKpi(kpis.assets)}
            </span>
          </div>
          <div className="m-kpi">
            <span className="m-kpi__label">Total Liabilities</span>
            <span
              className={
                "m-kpi__value" +
                (kpis.liabilities < 0 ? " m-kpi__value--negative" : "")
              }
            >
              {formatKpi(kpis.liabilities)}
            </span>
          </div>
        </div>
      )}

      <h2 className="m-section-h">Accounts</h2>
      <div className="m-groups">
        {groups.map(({ key, node }) => {
          const isOpen = openKeys.has(key);
          const total = node.totalUSD ?? 0;
          const leaves = isOpen ? flattenLeaves(node) : [];
          return (
            <div
              key={key}
              className={"m-group" + (isOpen ? " m-group--open" : "")}
            >
              <button
                type="button"
                className="m-group__header"
                onClick={() => toggle(key)}
                aria-expanded={isOpen}
              >
                <ChevronRight size={18} className="m-group__chev" />
                <span className="m-group__name">{node.name}</span>
                <span
                  className={
                    "m-group__total" + (total < 0 ? " m-group__total--neg" : "")
                  }
                >
                  {formatKpi(total)}
                </span>
              </button>
              {isOpen && leaves.length > 0 && (
                <div className="m-group__leaves">
                  {leaves.map((leaf, i) => {
                    const amt = leaf.totalUSD ?? 0;
                    return (
                      <div className="m-leaf" key={`${leaf.name}-${i}`}>
                        <span className="m-leaf__name">{leaf.name}</span>
                        <span
                          className={
                            "m-leaf__amt" +
                            (amt < 0 ? " m-leaf__amt--neg" : "")
                          }
                        >
                          {formatKpi(amt)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
