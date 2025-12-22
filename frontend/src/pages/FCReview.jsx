import { useEffect, useMemo, useState } from "react";
import NavigationMenu from "../components/NavigationMenu.jsx";
import FCReviewSelector from "../features/Forecast/FCReviewSelector.jsx";
import Rest from "../js/rest.js";
import "./PageLayout.css";

export default function FCReview() {
  const [scenarios, setScenarios] = useState([]);
  const [selectedScenario, setSelectedScenario] = useState("");
  const [loadError, setLoadError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [years, setYears] = useState([]);
  const [yearsLoading, setYearsLoading] = useState(false);
  const [yearsError, setYearsError] = useState("");
  const [cashAccounts, setCashAccounts] = useState([]);
  const [cashAccountMap, setCashAccountMap] = useState(new Map());
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [accountsError, setAccountsError] = useState("");
  const [balanceAccounts, setBalanceAccounts] = useState([]);
  const [balanceAccountMap, setBalanceAccountMap] = useState(new Map());
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState("");
  const [entries, setEntries] = useState([]);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [entriesError, setEntriesError] = useState("");
  const [baseActualTotals, setBaseActualTotals] = useState({
    level1: new Map(),
    level2: new Map(),
    net: null,
  });
  const [baseActualLoading, setBaseActualLoading] = useState(false);
  const [baseActualError, setBaseActualError] = useState("");
  const [baseBalanceTotals, setBaseBalanceTotals] = useState({
    level1: new Map(),
    level2: new Map(),
    level3: new Map(),
  });
  const [baseBalanceLoading, setBaseBalanceLoading] = useState(false);
  const [baseBalanceError, setBaseBalanceError] = useState("");

  const parseLevelAccounts = (data, includeMapping = false) => {
    if (!Array.isArray(data)) {
      return { rows: [], mapping: new Map() };
    }
    const mapping = new Map();
    const rows = data.flatMap((group) => {
      if (!group || typeof group !== "object") {
        return [];
      }
      return Object.entries(group).flatMap(([level1, children]) => {
        const rows = [{ label: level1, level: 1 }];
        if (Array.isArray(children)) {
          for (const child of children) {
            if (!child || typeof child !== "object") {
              continue;
            }
            const [level2] = Object.keys(child);
            if (level2) {
              rows.push({ label: level2, level: 2 });
              if (includeMapping) {
                mapping.set(level2, { level2, level1 });
                const addLeaf = (node) => {
                  if (typeof node === "string") {
                    mapping.set(node, { level2, level1 });
                    return;
                  }
                  if (Array.isArray(node)) {
                    node.forEach((item) => addLeaf(item));
                    return;
                  }
                  if (node && typeof node === "object") {
                    for (const [k, v] of Object.entries(node)) {
                      addLeaf(k);
                      addLeaf(v);
                    }
                  }
                };
                addLeaf(child[level2]);
              }
            }
          }
        }
        return rows;
      });
    });
    // Cash flow tables should only render level 1 and 2 rows.
    return { rows, mapping };
  };

  useEffect(() => {
    const loadScenarios = async () => {
      setIsLoading(true);
      try {
        const data = await Rest.fetchJson("/api/forecast/assumptions");
        const list = data?.scenarios || [];
        setScenarios(list);
        setSelectedScenario((current) => current || list[0]?.Name || "");
        setLoadError("");
      } catch (error) {
        setLoadError(error.message || "Failed to load scenarios");
      } finally {
        setIsLoading(false);
      }
    };

    loadScenarios();
  }, []);

  useEffect(() => {
    let isMounted = true;
    const loadCashAccounts = async () => {
      setAccountsLoading(true);
      setAccountsError("");
      try {
        const data = await Rest.fetchJson("/api/coa/CashFlow");
        if (!isMounted) {
          return;
        }
        const parsed = parseLevelAccounts(data, true);
        setCashAccounts(parsed.rows);
        setCashAccountMap(parsed.mapping);
      } catch (error) {
        if (isMounted) {
          setAccountsError(error.message || "Failed to load cash accounts");
        }
      } finally {
        if (isMounted) {
          setAccountsLoading(false);
        }
      }
    };

    loadCashAccounts();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    const loadBalanceAccounts = async () => {
      setBalanceLoading(true);
      setBalanceError("");
      try {
        const data = await Rest.fetchJson("/api/coa/BalanceSheet");
        if (!isMounted) {
          return;
        }
        const parsed = parseLevelAccounts(data, true);
        setBalanceAccounts(parsed.rows);
        setBalanceAccountMap(parsed.mapping);
      } catch (error) {
        if (isMounted) {
          setBalanceError(error.message || "Failed to load balance accounts");
        }
      } finally {
        if (isMounted) {
          setBalanceLoading(false);
        }
      }
    };

    loadBalanceAccounts();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedScenario) {
      setYears([]);
      return;
    }

    let isMounted = true;
    const loadYears = async () => {
      setYearsLoading(true);
      setYearsError("");
      try {
        const encodedScenario = encodeURIComponent(selectedScenario);
        const data = await Rest.fetchJson(
          `/api/forecast/scenarios/years/${encodedScenario}`
        );
        if (!isMounted) {
          return;
        }
        const list = Array.isArray(data?.years) ? data.years : [];
        const sorted = [...list].sort((a, b) => Number(a) - Number(b));
        setYears(sorted);
      } catch (error) {
        if (isMounted) {
          setYearsError(error.message || "Failed to load forecast years");
        }
      } finally {
        if (isMounted) {
          setYearsLoading(false);
        }
      }
    };

    loadYears();
    return () => {
      isMounted = false;
    };
  }, [selectedScenario]);

  useEffect(() => {
    if (!selectedScenario) {
      setEntries([]);
      return;
    }

    let isMounted = true;
    const loadEntries = async () => {
      setEntriesLoading(true);
      setEntriesError("");
      try {
        const encoded = encodeURIComponent(selectedScenario);
        const data = await Rest.fetchJson(
          `/api/forecast/entries?scenario=${encoded}`
        );
        if (!isMounted) {
          return;
        }
        const list = Array.isArray(data?.entries) ? data.entries : [];
        setEntries(list);
      } catch (error) {
        if (isMounted) {
          setEntriesError(error.message || "Failed to load forecast entries");
        }
      } finally {
        if (isMounted) {
          setEntriesLoading(false);
        }
      }
    };

    loadEntries();
    return () => {
      isMounted = false;
    };
  }, [selectedScenario]);

  const sortedYears = useMemo(
    () => [...years].sort((a, b) => Number(a) - Number(b)),
    [years]
  );
  const baseYear = sortedYears[0];
  const balanceLevel1Labels = useMemo(
    () =>
      new Set(
        balanceAccounts.filter((row) => row.level === 1).map((row) => row.label)
      ),
    [balanceAccounts]
  );
  const balanceLevel2Labels = useMemo(
    () =>
      new Set(
        balanceAccounts.filter((row) => row.level === 2).map((row) => row.label)
      ),
    [balanceAccounts]
  );
  const tableColSpan = Math.max(sortedYears.length + 1, 2);
  const tableError =
    accountsError ||
    balanceError ||
    yearsError ||
    entriesError ||
    baseActualError ||
    baseBalanceError;

  const cashRowsWithNet = useMemo(() => {
    const rows = [];
    for (const row of cashAccounts) {
      rows.push(row);
      if (row.label === "Transfers") {
        rows.push({
          label: "Net Cash flow = Income + Expense",
          level: 1,
          isNet: true,
        });
      }
    }
    return rows;
  }, [cashAccounts]);

  useEffect(() => {
    if (!baseYear) {
      setBaseActualTotals({ level1: new Map(), level2: new Map(), net: null });
      return;
    }

    let isMounted = true;
    const loadActuals = async () => {
      setBaseActualLoading(true);
      setBaseActualError("");
      try {
        const fromDate = `${baseYear}-01-01`;
        const toDate = `${baseYear}-12-31`;
        const report = await Rest.fetchCashFlowReport({
          fromDate,
          toDate,
          transfers: "exclude",
          includeUnrealizedGL: false,
        });
        if (!isMounted) {
          return;
        }
        const level1 = new Map();
        const level2 = new Map();
        let unrealizedAdjustment = 0;
        let unrealizedLevel2 = "";
        const traverse = (nodes, level = 1, parentLevel1 = "", parentLevel2 = "") => {
          if (!Array.isArray(nodes)) {
            return;
          }
          for (const node of nodes) {
            if (!node || typeof node !== "object") {
              continue;
            }
            const name = node.name;
            const total = Number(
              node.totalUSD !== undefined && node.totalUSD !== null
                ? node.totalUSD
                : node.total ?? 0
            );
            const nextLevel1 = level === 1 && name ? name : parentLevel1;
            const nextLevel2 =
              level === 2 && name ? name : level === 1 ? "" : parentLevel2;

            if (name === "Unrealized G/L") {
              unrealizedAdjustment += total;
              unrealizedLevel2 = nextLevel2 || unrealizedLevel2;
              continue;
            }
            if (level === 1 && name) {
              level1.set(name, total);
            } else if (level === 2 && name) {
              level2.set(name, total);
            }
            if (Array.isArray(node.children) && node.children.length > 0) {
              traverse(node.children, level + 1, nextLevel1, nextLevel2);
            }
          }
        };
        traverse(report, 1, "", "");
        if (unrealizedAdjustment) {
          const expenseTotal = level1.get("Expense") ?? 0;
          level1.set("Expense", expenseTotal - unrealizedAdjustment);
          if (unrealizedLevel2) {
            const l2Total = level2.get(unrealizedLevel2) ?? 0;
            level2.set(unrealizedLevel2, l2Total - unrealizedAdjustment);
          }
        }
        const income = level1.get("Income") ?? 0;
        const expense = level1.get("Expense") ?? 0;
        setBaseActualTotals({ level1, level2, net: income + expense });
      } catch (error) {
        if (isMounted) {
          setBaseActualError(
            error.message || "Failed to load base year actuals"
          );
        }
      } finally {
        if (isMounted) {
          setBaseActualLoading(false);
        }
      }
    };

    loadActuals();
    return () => {
      isMounted = false;
    };
  }, [baseYear]);

  useEffect(() => {
    if (!baseYear) {
      setBaseBalanceTotals({ level1: new Map(), level2: new Map(), level3: new Map() });
      return;
    }

    let isMounted = true;
    const loadBalance = async () => {
      setBaseBalanceLoading(true);
      setBaseBalanceError("");
      try {
        const asOfDate = `${baseYear}-12-31`;
        const report = await Rest.fetchBalanceReport(asOfDate);
        if (!isMounted) {
          return;
        }
        const level1 = new Map();
        const level2 = new Map();
        const level3Map = new Map();
        let assetTotal = 0;
        let liabilityTotal = 0;
        const aggregateValues = (nodes, path = []) => {
          if (!Array.isArray(nodes)) {
            return;
          }
          for (const node of nodes) {
            if (!node || typeof node !== "object") continue;
            const name = node.name;
            const children = Array.isArray(node.children) ? node.children : [];
            const hasChildren = children.length > 0;
            const newPath = [...path, name].filter(Boolean);

            if (hasChildren) {
              aggregateValues(children, newPath);
              continue;
            }

            const total = Number(node.totalUSD ?? 0);
            const mapping = balanceAccountMap.get(name);
            const l1 = mapping?.level1 || newPath[0];
            const l2 = mapping?.level2 || newPath[1];

            if (name) {
              level3Map.set(name, (level3Map.get(name) ?? 0) + total);
            }
            if (l1) {
              level1.set(l1, (level1.get(l1) ?? 0) + total);
              if (l1 === "Assets") {
                assetTotal += total;
              } else if (l1 === "Liabilities") {
                liabilityTotal += total;
              }
            }
            if (l2) {
              level2.set(l2, (level2.get(l2) ?? 0) + total);
            }
          }
        };

        const nodes = Array.isArray(report)
          ? report
          : Array.isArray(report?.["Balance Sheet Accounts"])
          ? report["Balance Sheet Accounts"]
          : [];
        aggregateValues(nodes, []);
        if (assetTotal) {
          level1.set("Assets", assetTotal);
        }
        if (liabilityTotal) {
          level1.set("Liabilities", liabilityTotal);
        }
        setBaseBalanceTotals({ level1, level2, level3: level3Map });
      } catch (error) {
        if (isMounted) {
          setBaseBalanceError(error.message || "Failed to load balance sheet");
        }
      } finally {
        if (isMounted) {
          setBaseBalanceLoading(false);
        }
      }
    };

    loadBalance();
    return () => {
      isMounted = false;
    };
  }, [baseYear, balanceAccountMap]);

  const entryMaps = useMemo(() => {
    const cashByLabel = new Map();
    const cashLevel1Totals = new Map();
    const balanceByLabel = new Map();
    const balanceLevel1Totals = new Map();
    for (const entry of entries) {
      const account = entry?.Account;
      const year = Number(entry?.Year);
      const amount = Number(entry?.Amount ?? 0);
      if (!account || Number.isNaN(year) || Number.isNaN(amount)) {
        continue;
      }
      // Cash mapping
      const cashMapping = cashAccountMap.get(account);
      const cashTarget = cashMapping?.level2 || account;
      const cashYearMap = cashByLabel.get(cashTarget) || new Map();
      cashYearMap.set(year, (cashYearMap.get(year) || 0) + amount);
      cashByLabel.set(cashTarget, cashYearMap);
      if (cashMapping?.level1) {
        const l1YearMap = cashLevel1Totals.get(cashMapping.level1) || new Map();
        l1YearMap.set(year, (l1YearMap.get(year) || 0) + amount);
        cashLevel1Totals.set(cashMapping.level1, l1YearMap);
      }

      // Balance mapping
      const balMapping = balanceAccountMap.get(account);
      const balL1 =
        balMapping?.level1 ||
        (balanceLevel1Labels.has(account) ? account : undefined);
      const balL2 =
        balMapping?.level2 ||
        (balanceLevel2Labels.has(account) ? account : undefined);
      const balTarget = balL2 || account;
      const balYearMap = balanceByLabel.get(balTarget) || new Map();
      balYearMap.set(year, (balYearMap.get(year) || 0) + amount);
      balanceByLabel.set(balTarget, balYearMap);
      if (balL1) {
        const l1YearMap = balanceLevel1Totals.get(balL1) || new Map();
        l1YearMap.set(year, (l1YearMap.get(year) || 0) + amount);
        balanceLevel1Totals.set(balL1, l1YearMap);
      }
    }
    return {
      cash: { byLabel: cashByLabel, level1Totals: cashLevel1Totals },
      balance: { byLabel: balanceByLabel, level1Totals: balanceLevel1Totals },
    };
  }, [entries, cashAccountMap, balanceAccountMap]);

  const formatAmount = (value) => {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
      return "-";
    }
    const num = Number(value);
    const formatted = Math.abs(num).toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
    return num < 0 ? `(${formatted})` : formatted;
  };

  const getCellValue = (row, year, isCashSection) => {
    if (isCashSection && year === baseYear) {
      if (row.isNet) {
        return baseActualTotals.net;
      }
      if (row.level === 1) {
        return baseActualTotals.level1.get(row.label) ?? null;
      }
      return baseActualTotals.level2.get(row.label) ?? null;
    }

    if (!isCashSection && year === baseYear) {
      if (row.level === 1) {
        return baseBalanceTotals.level1.get(row.label) ?? null;
      }
      if (row.level === 2) {
        return baseBalanceTotals.level2.get(row.label) ?? null;
      }
      return baseBalanceTotals.level3?.get(row.label) ?? null;
    }

    if (!isCashSection) {
      if (row.level === 1) {
        return entryMaps.balance.level1Totals.get(row.label)?.get(year) ?? null;
      }
      return entryMaps.balance.byLabel.get(row.label)?.get(year) ?? null;
    }

    if (row.isNet) {
      const incomeMap = entryMaps.cash.level1Totals.get("Income");
      const expenseMap = entryMaps.cash.level1Totals.get("Expense");
      const hasIncome = incomeMap?.has(year);
      const hasExpense = expenseMap?.has(year);
      if (!hasIncome && !hasExpense) {
        return null;
      }
      const income = incomeMap?.get(year) || 0;
      const expense = expenseMap?.get(year) || 0;
      return income + expense;
    }
    if (row.level === 1) {
      return entryMaps.cash.level1Totals.get(row.label)?.get(year) ?? null;
    }
    return entryMaps.cash.byLabel.get(row.label)?.get(year) ?? null;
  };

  return (
    <div className="page-shell">
      <NavigationMenu />
      <main className="page-main trans-budget-main">
        <FCReviewSelector
          scenarios={scenarios}
          selectedScenario={selectedScenario}
          setSelectedScenario={setSelectedScenario}
          isLoading={isLoading}
          loadError={loadError}
        />
        <section className="section-table">
          <div className="section-table__content">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "1rem",
              }}
            >
              <div>
                <p
                  style={{
                    margin: 0,
                    fontSize: "0.85rem",
                    color: "var(--muted)",
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                    fontWeight: 700,
                  }}
                >
                  Scenario review
                </p>
                <h3 style={{ margin: "0.1rem 0 0", color: "var(--ink)" }}>
                  {selectedScenario || "Select a scenario"}
                </h3>
              </div>
              <div
                style={{
                  padding: "0.4rem 0.75rem",
                  borderRadius: "999px",
                  background: "var(--surface-muted)",
                  border: "1px solid var(--border)",
                  color: "var(--muted)",
                  fontWeight: 700,
                }}
              >
                {sortedYears.length
                  ? `${sortedYears[0]} - ${
                      sortedYears[sortedYears.length - 1]
                    }`
                  : "No years"}
              </div>
            </div>
            <div className="trans-budget-table-wrapper">
              <table className="trans-budget-table fc-review-table">
                <thead>
                  <tr>
                    <th style={{ minWidth: "220px" }}>Account</th>
                    {sortedYears.length ? (
                      sortedYears.map((year) => (
                        <th key={year} className="trans-budget-table__value">
                          {year}
                        </th>
                      ))
                    ) : (
                      <th>Year</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {yearsLoading ||
                  accountsLoading ||
                  balanceLoading ||
                  entriesLoading ||
                  baseActualLoading ||
                  baseBalanceLoading ? (
                    <tr>
                      <td colSpan={tableColSpan}>Loading table...</td>
                    </tr>
                  ) : tableError ? (
                    <tr>
                      <td colSpan={tableColSpan} style={{ color: "#b91c1c" }}>
                        {tableError}
                      </td>
                    </tr>
                  ) : !selectedScenario ? (
                    <tr>
                      <td colSpan={tableColSpan}>
                        Choose a scenario to view the forecast table.
                      </td>
                    </tr>
                  ) : !sortedYears.length ? (
                    <tr>
                      <td colSpan={tableColSpan}>
                        No years available for this scenario.
                      </td>
                    </tr>
                  ) : !cashAccounts.length && !balanceAccounts.length ? (
                    <tr>
                      <td colSpan={tableColSpan}>
                        No chart of accounts data available.
                      </td>
                    </tr>
                  ) : (
                    <>
                      {cashRowsWithNet.map((row, index) => (
                        <tr key={`cash-${row.label}-${index}`}>
                          <td
                            style={{
                              fontWeight:
                                row.level === 1 ? 700 : row.level === 2 ? 600 : 500,
                              paddingLeft:
                                row.level === 3
                                  ? "2.25rem"
                                  : row.level === 2
                                  ? "1.5rem"
                                  : "0.75rem",
                            }}
                          >
                            {row.isNet
                              ? "Net Cash flow = Income + Expense"
                              : row.label}
                          </td>
                          {sortedYears.map((year) => (
                            <td
                              key={`${row.label}-${year}`}
                              className="trans-budget-table__value--numeric"
                              style={{
                                color:
                                  Number(getCellValue(row, year, true)) < 0
                                    ? "var(--danger)"
                                    : undefined,
                              }}
                            >
                              {formatAmount(getCellValue(row, year, true))}
                            </td>
                          ))}
                        </tr>
                      ))}
                      {balanceAccounts.length > 0 && cashAccounts.length > 0 && (
                        <tr>
                          <td
                            colSpan={tableColSpan}
                            style={{ borderTop: "3px solid var(--border)" }}
                          />
                        </tr>
                      )}
                      {balanceAccounts.map((row, index) => (
                        <tr
                          key={`balance-${row.label}-${index}`}
                          style={
                            index === 0 && cashAccounts.length === 0
                              ? { borderTop: "3px solid var(--border)" }
                              : undefined
                          }
                        >
                          <td
                            style={{
                              fontWeight:
                                row.level === 1 ? 700 : row.level === 2 ? 600 : 500,
                              paddingLeft:
                                row.level === 3
                                  ? "2.25rem"
                                  : row.level === 2
                                  ? "1.5rem"
                                  : "0.75rem",
                            }}
                          >
                            {row.label}
                          </td>
                          {sortedYears.map((year) => (
                            <td
                              key={`${row.label}-${year}`}
                              className="trans-budget-table__value--numeric"
                              style={{
                                color:
                                  Number(getCellValue(row, year, false)) < 0
                                    ? "var(--danger)"
                                    : undefined,
                              }}
                            >
                              {formatAmount(getCellValue(row, year, false))}
                            </td>
                          ))}
                        </tr>
                    ))}
                    </>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
