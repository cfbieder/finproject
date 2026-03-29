import { Fragment, useEffect, useState } from "react";
import Rest from "../../js/rest";
import "./FCModulesEdit.css";

const normalizeBaseDate = (value) => {
  if (!value) return "";
  const [year] = String(value).split("-");
  return year ? `${year}-12-13` : "";
};

const getBaseYear = (value, fallbackYear) => {
  const year = value ? String(value).slice(0, 4) : "";
  return year && year.length === 4 ? year : String(fallbackYear);
};

const baseYearOptions = (() => {
  const currentYear = new Date().getFullYear();
  const startYear = currentYear - 3;
  const endYear = currentYear + 40;
  return Array.from(
    { length: endYear - startYear + 1 },
    (_, index) => startYear + index
  );
})();

const formatWithCommas = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return "";
  }
  return num.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
};

const formatTwoDecimals = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return "";
  }
  return num.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

const evaluateNumericExpression = (value) => {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const normalized = raw.replace(/,/g, "");
  const asNumber = Number(normalized);
  if (Number.isFinite(asNumber)) return asNumber;
  if (!/^[\d+\-*/().\s]+$/.test(normalized)) return normalized;
  try {
    const result = Function(`"use strict"; return (${normalized});`)(); // limited to basic math
    const parsed = Number(result);
    return Number.isFinite(parsed) ? parsed : normalized;
  } catch {
    return normalized;
  }
};

const findBalanceNode = (nodes, targetName) => {
  if (!nodes || !targetName) return null;
  const normalizedTarget = String(targetName).trim();
  const stack = Array.isArray(nodes) ? [...nodes] : [nodes];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    const name = typeof node.name === "string" ? node.name.trim() : "";
    if (name === normalizedTarget) {
      return node;
    }
    if (Array.isArray(node.children)) {
      stack.push(...node.children);
    }
  }
  return null;
};

export default function FCModulesEditModal({
  isOpen,
  editForm,
  editError,
  editSaving,
  onClose,
  onFieldChange,
  onSubmit,
  refreshToken,
  traits = {},
  bsLevel2Options = [],
  getChildCategoriesForAccount = () => [],
  allModules = [],
}) {
  const isMatched = Boolean(editForm?.Matched);
  const nameOptions = getChildCategoriesForAccount(editForm?.Account);
  const effectiveName = isMatched
    ? editForm?.Name && nameOptions.includes(editForm.Name)
      ? editForm.Name
      : nameOptions.length
      ? nameOptions[0]
      : ""
    : editForm?.Name ?? "";
  const traitKey =
    (editForm?.Name && traits?.[editForm.Name] ? editForm.Name : "") ||
    (effectiveName && traits?.[effectiveName] ? effectiveName : "") ||
    editForm?.Account ||
    "";
  const accountTraits = traits?.[traitKey] || {};
  const traitType = accountTraits?.Type ?? "";
  const traitCurrency = accountTraits?.Currency ?? "";
  const [accountBalance, setAccountBalance] = useState({
    value: null,
    valueUSD: null,
    currency: "",
  });
  const [accountBalanceLoading, setAccountBalanceLoading] = useState(false);
  const [assumptions, setAssumptions] = useState(null);
  const [assumptionsLoading, setAssumptionsLoading] = useState(false);
  const [fcLines, setFcLines] = useState([]);
  const [fcBudgetTotals, setFcBudgetTotals] = useState({});
  const formatWithCommas = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) {
      return "";
    }
    return num.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  };
  const formatAccountValue = (value, currency) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return "-";
    }
    const formatted = parsed.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return currency ? `${formatted} ${currency}` : formatted;
  };
  const traitValueOptions = (() => {
    const typeValues = new Set();
    const currencyValues = new Set();
    for (const t of Object.values(traits || {})) {
      if (!t || typeof t !== "object") continue;
      if (t.Type) typeValues.add(t.Type);
      if (t.Currency) currencyValues.add(t.Currency);
    }
    return {
      Type: Array.from(typeValues).sort(),
      Currency: Array.from(currencyValues).sort(),
    };
  })();

  useEffect(() => {
    let isActive = true;
    if (!isOpen) return undefined;
    setAssumptionsLoading(true);
    (async () => {
      try {
        // Using v2 API (PostgreSQL)
        const data = await Rest.fetchJson("/api/v2/forecast/assumptions");
        if (isActive) {
          setAssumptions(data || null);
        }
      } catch (error) {
        console.error("Failed to fetch assumptions:", error);
        if (isActive) {
          setAssumptions(null);
        }
      } finally {
        if (isActive) {
          setAssumptionsLoading(false);
        }
      }
    })();
    return () => {
      isActive = false;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    (async () => {
      try {
        const [linesRes, budgetRes] = await Promise.all([
          Rest.get("/fc-lines"),
          Rest.get(`/fc-lines/budget-totals?budgetYear=${new Date().getFullYear()}`),
        ]);
        setFcLines(linesRes.data || []);
        const totMap = {};
        for (const t of budgetRes.data || []) {
          totMap[t.fc_line_id] = parseFloat(t.budget_total) || 0;
        }
        setFcBudgetTotals(totMap);
      } catch (err) {
        console.error("Failed to fetch FC Lines:", err);
      }
    })();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !editForm || !isMatched) return;
    if (traitType && editForm.Type !== traitType) {
      onFieldChange("Type", traitType);
    }
    if (traitCurrency && editForm.Currency !== traitCurrency) {
      onFieldChange("Currency", traitCurrency);
    }
  }, [
    editForm?.Currency,
    editForm?.Type,
    isOpen,
    isMatched,
    onFieldChange,
    traitCurrency,
    traitType,
  ]);

  useEffect(() => {
    if (!isOpen || !isMatched) return;
    if (nameOptions.length && !nameOptions.includes(editForm?.Name)) {
      onFieldChange("Name", nameOptions[0]);
    }
  }, [editForm?.Name, isMatched, isOpen, nameOptions, onFieldChange]);

  useEffect(() => {
    if (!isOpen || !editForm?.BaseDate) return;
    if (editForm.BaseDate.endsWith("-12-13")) return;
    const normalized = normalizeBaseDate(editForm.BaseDate);
    if (normalized && normalized !== editForm.BaseDate) {
      onFieldChange("BaseDate", normalized);
    }
  }, [editForm?.BaseDate, isOpen, onFieldChange]);

  useEffect(() => {
    let isActive = true;
    if (!isOpen || !isMatched) {
      setAccountBalance({ value: null, valueUSD: null, currency: "" });
      setAccountBalanceLoading(false);
      return undefined;
    }
    if (!isMatched || !effectiveName || !editForm?.BaseDate) {
      setAccountBalance({ value: null, valueUSD: null, currency: "" });
      setAccountBalanceLoading(false);
      return undefined;
    }
    setAccountBalanceLoading(true);
    (async () => {
      try {
        const report = await Rest.fetchBalanceReport(editForm.BaseDate);
        if (!isActive) return;
        const node = findBalanceNode(report, effectiveName);
        if (node) {
          const rawLocal = Number(node.total);
          const hasLocal = Number.isFinite(rawLocal);
          const rawUsd = Number(node.totalUSD);
          const hasUsd = Number.isFinite(rawUsd);
          const currency =
            typeof node.currency === "string" && node.currency
              ? node.currency
              : hasUsd && !hasLocal
              ? "USD"
              : "";
          const localValue = hasLocal ? rawLocal : hasUsd ? rawUsd : null;
          setAccountBalance({
            value: localValue,
            valueUSD: hasUsd ? rawUsd : null,
            currency,
          });
        } else {
          setAccountBalance({ value: null, valueUSD: null, currency: "" });
        }
      } catch (error) {
        console.error("Failed to fetch account balance:", error);
        if (isActive) {
          setAccountBalance({ value: null, valueUSD: null, currency: "" });
        }
      } finally {
        if (isActive) {
          setAccountBalanceLoading(false);
        }
      }
    })();
    return () => {
      isActive = false;
    };
  }, [effectiveName, editForm?.BaseDate, isMatched, isOpen, refreshToken]);

  const parseNumber = (value) => {
    const evaluated = evaluateNumericExpression(value);
    const num =
      typeof evaluated === "number"
        ? evaluated
        : Number(String(evaluated ?? "").replace(/,/g, ""));
    return Number.isFinite(num) ? num : null;
  };

  const resolveFxRate = (year) => {
    const currency = editForm?.Currency;
    if (!currency || currency === "USD") return 1;
    const fxRows = assumptions?.FX || [];
    const scenario = editForm?.Scenario;
    const relevant = fxRows
      .filter((row) => row?.Scenario === scenario)
      .sort((a, b) => Number(a?.Year) - Number(b?.Year));
    let rate = null;
    for (const row of relevant) {
      if (Number(row?.Year) <= Number(year)) {
        if (currency === "PLN" && row?.Rates?.USDPLN) {
          rate = row.Rates.USDPLN;
        } else if (currency === "EUR" && row?.Rates?.USDEUR) {
          rate = row.Rates.USDEUR;
        }
      }
    }
    if (rate === null && relevant.length) {
      const latest = relevant[relevant.length - 1];
      if (currency === "PLN" && latest?.Rates?.USDPLN)
        rate = latest.Rates.USDPLN;
      if (currency === "EUR" && latest?.Rates?.USDEUR)
        rate = latest.Rates.USDEUR;
    }
    return Number.isFinite(Number(rate)) ? Number(rate) : 1;
  };

  const baseValueNumber = parseNumber(editForm?.BaseValue);
  const marketValueNumber = parseNumber(editForm?.MarketValue);
  const baseYear = getBaseYear(editForm?.BaseDate, new Date().getFullYear());
  const getYearFromDate = (value) => {
    if (!value) return "";
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return String(date.getFullYear());
    }
    const raw = String(value);
    return /^\d{4}/.test(raw) ? raw.slice(0, 4) : "";
  };
  const accountValueRatio =
    isMatched &&
    Number.isFinite(Number(accountBalance.value)) &&
    Number.isFinite(Number(accountBalance.valueUSD)) &&
    Number(accountBalance.value) !== 0
      ? Number(accountBalance.valueUSD) / Number(accountBalance.value)
      : null;
  const fxRate = !isMatched ? resolveFxRate(baseYear) : 1;
  const computedBaseValueUSD =
    baseValueNumber === null
      ? ""
      : isMatched && accountValueRatio !== null
      ? baseValueNumber * accountValueRatio
      : baseValueNumber * fxRate;
  const computedMarketValueUSD =
    marketValueNumber === null
      ? ""
      : isMatched && accountValueRatio !== null
      ? marketValueNumber * accountValueRatio
      : marketValueNumber * fxRate;
  const accountValueAvailable = Number.isFinite(Number(accountBalance.value));

  const copyAccountValueTo = (field) => {
    if (!accountValueAvailable) return;
    onFieldChange(field, accountBalance.value);
  };

  useEffect(() => {
    if (!isOpen || !editForm) return;
    const normalizeNumeric = (value) => {
      if (value === "" || value === null || value === undefined) return "";
      const num = Number(String(value).replace(/,/g, ""));
      return Number.isFinite(num) ? num : "";
    };
    const baseUsdNext = normalizeNumeric(computedBaseValueUSD);
    const marketUsdNext = normalizeNumeric(computedMarketValueUSD);
    const baseUsdCurrent = normalizeNumeric(editForm.BaseValueUSD);
    const marketUsdCurrent = normalizeNumeric(editForm.MarketValueUSD);
    if (baseUsdNext !== baseUsdCurrent) {
      onFieldChange(
        "BaseValueUSD",
        computedBaseValueUSD === "" ? "" : computedBaseValueUSD
      );
    }
    if (marketUsdNext !== marketUsdCurrent) {
      onFieldChange(
        "MarketValueUSD",
        computedMarketValueUSD === "" ? "" : computedMarketValueUSD
      );
    }
  }, [
    computedBaseValueUSD,
    computedMarketValueUSD,
    editForm?.BaseValueUSD,
    editForm?.MarketValueUSD,
    isOpen,
    onFieldChange,
  ]);
  const scenarioDetails =
    assumptions?.scenarios?.find((s) => s?.Name === editForm?.Scenario) || null;
  const scenarioPeriodStart =
    scenarioDetails?.PeriodStart ?? assumptions?.PeriodStart ?? null;
  const scenarioPeriodEnd =
    scenarioDetails?.PeriodEnd ?? assumptions?.PeriodEnd ?? null;
  const currentYear = new Date().getFullYear();
  const transferYearStart = Number(scenarioPeriodStart) > 1900
    ? Number(scenarioPeriodStart)
    : currentYear;
  const transferYearEndCandidate = Number(scenarioPeriodEnd) > 1900
    ? Number(scenarioPeriodEnd)
    : transferYearStart + 20;
  const transferYearEnd = Math.max(transferYearStart, transferYearEndCandidate);
  const transferYearOptions = Array.from(
    { length: transferYearEnd - transferYearStart + 1 },
    (_, index) => transferYearStart + index
  );
  // For Income %, exclude budget year (year 1) since that's covered by Income Amount
  const incomePctYearOptions = transferYearOptions.filter((y) => y > transferYearStart);
  const transferFlagOptionsI = ["OneTime", "Periodic"];
  const transferFlagOptionsD = ["Full", "OneTime", "Periodic"];
  const incomePctLabel = (() => {
    const t = (editForm?.Type || "").toLowerCase();
    if (t.includes("deposit") || t.includes("fixed income") || t.includes("bond"))
      return "Yield / Deposit Rate %";
    return "Income / Yield %";
  })();
  const transferSections = [
    ["Invest", "Invest"],
    ["Dispose", "Dispose"],
    [incomePctLabel, "IncomePct"],
  ];

  const updateTransferEntry = (field, index, key, value) => {
    const current = Array.isArray(editForm?.[field]) ? editForm[field] : [];
    const next = current.map((entry, entryIndex) =>
      entryIndex === index ? { ...entry, [key]: value } : entry
    );
    onFieldChange(field, next);
  };

  const addTransferEntry = (field) => {
    const current = Array.isArray(editForm?.[field]) ? editForm[field] : [];
    const defaultYear =
      (Number.isFinite(Number(scenarioPeriodStart))
        ? String(scenarioPeriodStart)
        : "") ||
      getYearFromDate(editForm?.BaseDate) ||
      transferYearStart;

    // IncomePct uses Value instead of Amount and doesn't have Flag
    if (field === "IncomePct") {
      onFieldChange(field, [
        ...current,
        { Date: `${defaultYear}-07-01`, Amount: "", Value: "" },
      ]);
    } else {
      onFieldChange(field, [
        ...current,
        { Date: `${defaultYear}-07-01`, Amount: "", Flag: "OneTime" },
      ]);
    }
  };

  const removeTransferEntry = (field, index) => {
    const current = Array.isArray(editForm?.[field]) ? editForm[field] : [];
    const next = current.filter((_, entryIndex) => entryIndex !== index);
    onFieldChange(field, next);
  };

  const fields = [
    ["Account", "Account", "select"],
    ["Name", "Name", "text"],
    ["Matched", "Matched", "checkbox"],
    ["Base Date", "BaseDate", "date"],
    ["Type", "Type", "text"],
    ["Currency", "Currency", "text"],
    ["Base Value", "BaseValue", "number"],
    ["Base Value (USD)", "BaseValueUSD", "number"],
    ["Market Value", "MarketValue", "number"],
    ["Market Value (USD)", "MarketValueUSD", "number"],
    ["Growth (x Inflation)", "Growth", "number"],
    ["Expense Line", "ExpenseFcLineId", "fc-line-expense"],
    ["Expense Amount (Yr 1)", "ExpenseAmount", "number"],
    ["Expense Growth", "ExpenseGrowthMethod", "growth-method"],
    ["Income Line", "IncomeFcLineId", "fc-line-income"],
    ["Income Amount (Yr 1)", "IncomeAmount", "number"],
    ["Tax Rate Override (%)", "TaxRateOverride", "number"],
    ["Status", "SetupStatus", "setup-status"],
    ["Comment", "Comment", "textarea"],
  ];

  if (!isOpen || !editForm) {
    return null;
  }

  return (
    <div
      className="fc-modules-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Edit forecast module"
    >
      <div
        className="fc-modules-modal"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Header */}
        <div className="fc-modules-modal__header">
          <div className="fc-modules-modal__header-content">
            <div className="fc-modules-modal__icon">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M19 21V5C19 3.89543 18.1046 3 17 3H7C5.89543 3 5 3.89543 5 5V21M19 21H5M19 21H21M5 21H3M9 7H10M9 11H10M9 15H10M14 7H15M14 11H15M14 15H15"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div>
              <h3 className="fc-modules-modal__title">Edit Module</h3>
              <p className="fc-modules-modal__subtitle">
                Configure forecast module settings and transfers
              </p>
            </div>
          </div>
          <button
            className="fc-modules-modal__close"
            onClick={onClose}
            disabled={editSaving}
            type="button"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M6 18L18 6M6 6L18 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>

        <form onSubmit={onSubmit}>
          {/* Body */}
          <div className="fc-modules-modal__body">
            {/* Basic Configuration Section */}
            <div className="fc-modules-modal__section">
              <div className="fc-modules-modal__section-header">
                <h4 className="fc-modules-modal__section-title">
                  Basic Configuration
                </h4>
                {isMatched && (
                  <span className="fc-modules-modal__matched-badge">
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M9 12L11 14L15 10M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    Matched to COA
                  </span>
                )}
              </div>
              <div className="fc-modules-modal__fields-grid">
                {fields.map(([label, field, type, source]) => {
                  if (field === "Account") {
                    return (
                      <label key={field} className="fc-modules-modal__field">
                        <span className="fc-modules-modal__label">{label}</span>
                        {isMatched ? (
                          <input
                            className="fc-modules-modal__input"
                            value={editForm.Account ?? ""}
                            readOnly
                            disabled
                          />
                        ) : (
                          <select
                            className="fc-modules-modal__input"
                            value={editForm.Account ?? ""}
                            onChange={(event) =>
                              onFieldChange("Account", event.target.value)
                            }
                          >
                            {bsLevel2Options.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                            {editForm.Account &&
                              !bsLevel2Options.includes(
                                editForm.Account
                              ) && (
                                <option value={editForm.Account}>
                                  {editForm.Account}
                                </option>
                              )}
                          </select>
                        )}
                      </label>
                    );
                  }
                  if (field === "Name") {
                    if (isMatched) {
                      return (
                        <label key={field} className="fc-modules-modal__field">
                          <span className="fc-modules-modal__label">
                            {label}
                          </span>
                          <input
                            className="fc-modules-modal__input"
                            value={editForm.Name ?? ""}
                            readOnly
                            disabled
                          />
                        </label>
                      );
                    }
                    return (
                      <label key={field} className="fc-modules-modal__field">
                        <span className="fc-modules-modal__label">{label}</span>
                        <input
                          type="text"
                          className="fc-modules-modal__input"
                          value={editForm.Name ?? ""}
                          onChange={(event) =>
                            onFieldChange("Name", event.target.value)
                          }
                        />
                      </label>
                    );
                  }

                  if (field === "Matched") {
                    return (
                      <label key={field} className="fc-modules-modal__field">
                        <span className="fc-modules-modal__label">{label}</span>
                        <input
                          type="checkbox"
                          checked={Boolean(editForm.Matched)}
                          readOnly
                          disabled
                        />
                      </label>
                    );
                  }

                  if (field === "BaseDate") {
                    const selectedYear = getBaseYear(
                      editForm.BaseDate,
                      new Date().getFullYear()
                    );
                    return (
                      <label key={field} className="fc-modules-modal__field">
                        <span className="fc-modules-modal__label">{label}</span>
                        <div className="fc-modules-edit__base-date">
                          <select
                            className="fc-modules-modal__input"
                            value={selectedYear}
                            onChange={(event) =>
                              onFieldChange(
                                "BaseDate",
                                `${event.target.value}-12-13`
                              )
                            }
                          >
                            {baseYearOptions.map((year) => (
                              <option key={year} value={year}>
                                {year}
                              </option>
                            ))}
                          </select>
                          <span className="fc-modules-edit__base-date-hint">
                            Dec 13
                          </span>
                        </div>
                      </label>
                    );
                  }

                  if (field === "Type" || field === "Currency") {
                    const options = traitValueOptions[field] || [];
                    const currentValue = editForm[field] ?? "";
                    if (isMatched) {
                      if (field === "Type") {
                        // Type stays editable even when matched
                        const capitalize = (v) => v ? v.charAt(0).toUpperCase() + v.slice(1) : "";
                        const typeValue = capitalize(currentValue);
                        const typeOpts = (traits?.moduleTypes && traits.moduleTypes.length > 0)
                          ? traits.moduleTypes
                          : ["Asset", "Liability", "Deposit", "Fixed Income", "Bond", "Real Estate", "Private Equity", "Business"];
                        return (
                          <label
                            key={field}
                            className="fc-modules-modal__field"
                          >
                            <span className="fc-modules-modal__label">
                              {label}
                            </span>
                            <select
                              className="fc-modules-modal__input"
                              value={typeValue}
                              onChange={(e) => onFieldChange("Type", e.target.value)}
                            >
                              {typeOpts.map((opt) => (
                                <option key={opt} value={opt}>{opt}</option>
                              ))}
                              {typeValue && !typeOpts.includes(typeValue) && (
                                <option value={typeValue}>{typeValue}</option>
                              )}
                            </select>
                          </label>
                        );
                      }
                      return (
                        <Fragment key={field}>
                          <label
                            key={field}
                            className="fc-modules-modal__field"
                          >
                            <span className="fc-modules-modal__label">
                              {label}
                            </span>
                            <input
                              type="text"
                              className="fc-modules-modal__input"
                              value={accountTraits[field] ?? currentValue}
                              disabled
                            />
                          </label>
                          <label className="fc-modules-modal__field">
                            <span>Account Value</span>
                            <input
                              type="text"
                              className="fc-modules-modal__input"
                              value={
                                accountBalanceLoading
                                  ? "Loading..."
                                  : formatAccountValue(
                                      accountBalance.value,
                                      accountBalance.currency
                                    )
                              }
                              readOnly
                            />
                          </label>
                          <label className="fc-modules-modal__field">
                            <span>Account Value USD</span>
                            <input
                              type="text"
                              className="fc-modules-modal__input"
                              value={
                                accountBalanceLoading
                                  ? "Loading..."
                                  : formatAccountValue(
                                      accountBalance.valueUSD,
                                      "USD"
                                    )
                              }
                              readOnly
                            />
                          </label>
                        </Fragment>
                      );
                    }
                    return (
                      <label key={field} className="fc-modules-modal__field">
                        <span className="fc-modules-modal__label">{label}</span>
                        <select
                          className="fc-modules-modal__input"
                          value={currentValue}
                          onChange={(event) =>
                            onFieldChange(field, event.target.value)
                          }
                        >
                          {options.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                          {currentValue && !options.includes(currentValue) && (
                            <option value={currentValue}>{currentValue}</option>
                          )}
                        </select>
                      </label>
                    );
                  }

                  if (type === "fc-line-expense" || type === "fc-line-income") {
                    const isExpense = type === "fc-line-expense";
                    const lineType = isExpense ? "bs_module_expense" : "bs_module_income";
                    const lineField = isExpense ? "ExpenseFcLineId" : "IncomeFcLineId";
                    const amountField = isExpense ? "expense_amount" : "income_amount";
                    const availableLines = fcLines.filter((l) => l.line_type === lineType);
                    const currentValue = editForm[field] ?? "";
                    const lineId = currentValue ? Number(currentValue) : null;
                    const budgetTotal = lineId ? Math.abs(fcBudgetTotals[lineId] || 0) : 0;

                    // Compute allocation: how much of this line's budget is used by OTHER modules
                    const currentModuleId = editForm?.id;
                    const otherModulesAmount = lineId
                      ? allModules
                          .filter((m) => {
                            const mLineId = isExpense
                              ? (m.ExpenseFcLineId || m.expense_fc_line_id)
                              : (m.IncomeFcLineId || m.income_fc_line_id);
                            return Number(mLineId) === lineId && m.id !== currentModuleId;
                          })
                          .reduce((sum, m) => sum + Math.abs(parseFloat(isExpense ? (m.ExpenseAmount ?? m.expense_amount ?? 0) : (m.IncomeAmount ?? m.income_amount ?? 0))), 0)
                      : 0;
                    const thisModuleAmount = Math.abs(parseFloat(isExpense ? (editForm.ExpenseAmount ?? 0) : (editForm.IncomeAmount ?? 0)));
                    const remaining = budgetTotal - otherModulesAmount - thisModuleAmount;

                    return (
                      <label key={field} className="fc-modules-modal__field">
                        <span className="fc-modules-modal__label">{label}</span>
                        <select
                          className="fc-modules-modal__input"
                          value={currentValue || ""}
                          onChange={(event) =>
                            onFieldChange(field, event.target.value ? Number(event.target.value) : null)
                          }
                        >
                          <option value="">None</option>
                          {availableLines.map((line) => (
                            <option key={line.id} value={line.id}>
                              {line.name}
                              {fcBudgetTotals[line.id] ? ` (${Math.abs(fcBudgetTotals[line.id]).toLocaleString("en-US", { maximumFractionDigits: 0 })})` : ""}
                            </option>
                          ))}
                        </select>
                        {lineId && budgetTotal > 0 && (
                          <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)", marginTop: "0.2rem", lineHeight: 1.5 }}>
                            <span>Budget: <b>{budgetTotal.toLocaleString("en-US", { maximumFractionDigits: 0 })}</b></span>
                            {otherModulesAmount > 0 && (
                              <span> — Other modules: {otherModulesAmount.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
                            )}
                            <span> — Remaining: <b style={{ color: remaining < 0 ? "var(--danger, #ef4444)" : remaining === 0 ? "var(--success, #22c55e)" : undefined }}>
                              {remaining.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                            </b></span>
                          </div>
                        )}
                      </label>
                    );
                  }

                  if (type === "growth-method") {
                    const currentValue = editForm.ExpenseGrowthMethod || "inflation";
                    return (
                      <label key={field} className="fc-modules-modal__field">
                        <span className="fc-modules-modal__label">{label}</span>
                        <select
                          className="fc-modules-modal__input"
                          value={currentValue}
                          onChange={(event) =>
                            onFieldChange("ExpenseGrowthMethod", event.target.value)
                          }
                        >
                          <option value="inflation">Grow at Inflation</option>
                          <option value="pct_of_value">Grow as % of Asset Value</option>
                        </select>
                      </label>
                    );
                  }

                  if (type === "setup-status") {
                    const statusValue = editForm.SetupStatus || "new";
                    return (
                      <label key={field} className="fc-modules-modal__field">
                        <span className="fc-modules-modal__label">{label}</span>
                        <select
                          className="fc-modules-modal__input"
                          value={statusValue}
                          onChange={(event) => onFieldChange("SetupStatus", event.target.value)}
                        >
                          <option value="new">New</option>
                          <option value="in_progress">In Progress</option>
                          <option value="complete">Complete</option>
                        </select>
                      </label>
                    );
                  }

                  if (type === "textarea") {
                    return (
                      <label
                        key={field}
                        className="fc-modules-modal__field fc-modules-modal__field--full"
                      >
                        <span className="fc-modules-modal__label">{label}</span>
                        <textarea
                          className="fc-modules-modal__input fc-modules-modal__textarea"
                          value={editForm[field] ?? ""}
                          onChange={(event) =>
                            onFieldChange(field, event.target.value)
                          }
                          placeholder="Add a comment or note"
                          rows="2"
                        />
                      </label>
                    );
                  }

                  const isLockedField = source === "traits";
                  const isDerivedUsd =
                    field === "BaseValueUSD" || field === "MarketValueUSD";
                  const isValueField =
                    field === "BaseValue" ||
                    field === "MarketValue" ||
                    field === "BaseValueUSD" ||
                    field === "MarketValueUSD";
                  const isReadOnlyValue =
                    isDerivedUsd || (!isMatched && isValueField);
                  let inputValue = isLockedField
                    ? accountTraits[field] ?? ""
                    : editForm[field] ?? "";
                  if (field === "BaseValueUSD") {
                    inputValue = computedBaseValueUSD;
                  } else if (field === "MarketValueUSD") {
                    inputValue = computedMarketValueUSD;
                  }
                  if (!isMatched && isValueField) {
                    inputValue = 0;
                  }
                  if (isValueField) {
                    const formatted = formatWithCommas(inputValue);
                    inputValue =
                      formatted === "" &&
                      inputValue !== "" &&
                      !Number.isFinite(Number(inputValue))
                        ? inputValue
                        : formatted;
                  }
                  const inputClassName = [
                    "form-input",
                    isReadOnlyValue ? "fc-modules-edit__input--readonly" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  const resolvedType =
                    field === "BaseValue" ||
                    field === "MarketValue" ||
                    field === "BaseValueUSD" ||
                    field === "MarketValueUSD"
                      ? "text"
                      : type === "number"
                      ? "text"
                      : type;
                  const isLiabilityAccount = editForm?.account_type === "liability";
                  const tooltip =
                    field === "Growth"
                      ? "Multiplier of inflation (e.g. 1 = inflation, 0 = no growth, 2 = 2x inflation)"
                      : undefined;
                  const isNumericInput = type === "number" || isValueField;
                  const inputMode = isNumericInput ? "decimal" : undefined;
                  const handleNumericChange = (event) => {
                    const rawValue = event.target.value.replace(/,/g, "");
                    onFieldChange(field, rawValue);
                  };
                  const handleNumericBlur = (event) => {
                    const evaluated = evaluateNumericExpression(
                      event.target.value
                    );
                    if (Number.isFinite(evaluated)) {
                      onFieldChange(field, evaluated);
                    }
                  };

                  return (
                    <label
                      key={field}
                      className="fc-modules-modal__field"
                      title={tooltip}
                    >
                      <span>{label}</span>
                      <input
                        type={resolvedType}
                        inputMode={inputMode}
                        className={inputClassName}
                        value={inputValue}
                        title={tooltip}
                        readOnly={isReadOnlyValue}
                        disabled={isLockedField}
                        onChange={
                          isLockedField || isReadOnlyValue
                            ? undefined
                            : isNumericInput
                            ? handleNumericChange
                            : (event) =>
                                onFieldChange(field, event.target.value)
                        }
                        onBlur={
                          isLockedField || isReadOnlyValue || !isNumericInput
                            ? undefined
                            : handleNumericBlur
                        }
                      />
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Transfer Sections */}
            <div className="fc-modules-modal__transfers">
              {transferSections.map(([label, field]) => {
                const transfers = Array.isArray(editForm?.[field])
                  ? editForm[field]
                  : [];
                const transferFlagOptions =
                  field === "Invest"
                    ? transferFlagOptionsI
                    : transferFlagOptionsD;
                const isIncomePct = field === "IncomePct";
                return (
                  <div
                    key={field}
                    className="fc-modules-modal__transfer-section"
                  >
                    <div className="fc-modules-modal__transfer-header">
                      <h5 className="fc-modules-modal__transfer-title">
                        {label} {isIncomePct ? "" : "Transfers"}
                      </h5>
                      <button
                        type="button"
                        className="fc-modules-modal__add-transfer-button"
                        onClick={() => addTransferEntry(field)}
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <path
                            d="M12 5V19M5 12H19"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                        Add {label} {isIncomePct ? "Entry" : ""}
                      </button>
                    </div>
                    {transfers.length === 0 ? (
                      <div className="fc-modules-modal__transfer-empty">
                        <svg
                          width="48"
                          height="48"
                          viewBox="0 0 24 24"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <path
                            d="M9 5H7C5.89543 5 5 5.89543 5 7V19C5 20.1046 5.89543 21 7 21H17C18.1046 21 19 20.1046 19 19V7C19 5.89543 18.1046 5 17 5H15M9 5C9 6.10457 9.89543 7 11 7H13C14.1046 7 15 6.10457 15 5M9 5C9 3.89543 9.89543 3 11 3H13C14.1046 3 15 3.89543 15 5"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                        <p>No {label.toLowerCase()} entries</p>
                        <span>
                          Click "Add {label} {isIncomePct ? "Entry" : ""}" to
                          create a{" "}
                          {isIncomePct ? "percentage entry" : "transfer"}
                        </span>
                      </div>
                    ) : (
                      <div className="fc-modules-modal__transfer-list">
                        {transfers.map((entry, index) => {
                          // For IncomePct, use Value; for others use Amount
                          const fieldValue = isIncomePct
                            ? entry?.Value ?? entry?.Amount ?? ""
                            : entry?.Amount ?? "";
                          const fieldKey = isIncomePct ? "Value" : "Amount";

                          return (
                            <div
                              key={`${field}-${index}`}
                              className="fc-modules-modal__transfer-card"
                            >
                              <div className="fc-modules-modal__transfer-number">
                                {index + 1}
                              </div>
                              <div className="fc-modules-modal__transfer-fields">
                                <div className="fc-modules-modal__transfer-field">
                                  <label className="fc-modules-modal__transfer-label">
                                    Year
                                  </label>
                                  <select
                                    className="fc-modules-modal__input fc-modules-modal__input--small"
                                    required
                                    value={getYearFromDate(entry?.Date)}
                                    onChange={(event) =>
                                      updateTransferEntry(
                                        field,
                                        index,
                                        "Date",
                                        `${event.target.value}-07-01`
                                      )
                                    }
                                  >
                                    <option value="">Select year</option>
                                    {(isIncomePct ? incomePctYearOptions : transferYearOptions).map((year) => (
                                      <option key={year} value={year}>
                                        {year}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <div className="fc-modules-modal__transfer-field">
                                  <label
                                    className="fc-modules-modal__transfer-label"
                                    title={
                                      isIncomePct
                                        ? "Enter a % of market value"
                                        : undefined
                                    }
                                  >
                                    {isIncomePct ? "Percentage" : "Amount"}
                                  </label>
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    className="fc-modules-modal__input fc-modules-modal__input--small"
                                    value={fieldValue}
                                    title={
                                      isIncomePct
                                        ? "Enter a % of market value"
                                        : undefined
                                    }
                                    onChange={(event) =>
                                      updateTransferEntry(
                                        field,
                                        index,
                                        fieldKey,
                                        event.target.value.replace(/,/g, "")
                                      )
                                    }
                                    onBlur={(event) => {
                                      const evaluated =
                                        evaluateNumericExpression(
                                          event.target.value
                                        );
                                      if (Number.isFinite(evaluated)) {
                                        updateTransferEntry(
                                          field,
                                          index,
                                          fieldKey,
                                          evaluated
                                        );
                                      }
                                    }}
                                    placeholder={isIncomePct ? "0" : "0"}
                                    step={isIncomePct ? "0.01" : "1"}
                                  />
                                </div>
                                {!isIncomePct && (
                                  <div className="fc-modules-modal__transfer-field">
                                    <label className="fc-modules-modal__transfer-label">
                                      Type
                                    </label>
                                    <select
                                      className="fc-modules-modal__input fc-modules-modal__input--small"
                                      value={entry?.Flag ?? ""}
                                      onChange={(event) =>
                                        updateTransferEntry(
                                          field,
                                          index,
                                          "Flag",
                                          event.target.value
                                        )
                                      }
                                    >
                                      <option value="">Select type</option>
                                      {transferFlagOptions.map((flag) => (
                                        <option key={flag} value={flag}>
                                          {flag}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                )}
                              </div>
                              <button
                                type="button"
                                className="fc-modules-modal__transfer-remove"
                                onClick={() =>
                                  removeTransferEntry(field, index)
                                }
                                title="Remove this transfer"
                              >
                                <svg
                                  width="16"
                                  height="16"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  xmlns="http://www.w3.org/2000/svg"
                                >
                                  <path
                                    d="M19 7L18.1327 19.1425C18.0579 20.1891 17.187 21 16.1378 21H7.86224C6.81296 21 5.94208 20.1891 5.86732 19.1425L5 7M10 11V17M14 11V17M15 7V4C15 3.44772 14.5523 3 14 3H10C9.44772 3 9 3.44772 9 4V7M4 7H20"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                              </button>
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

          {/* Error Display */}
          {editError && (
            <div className="fc-modules-modal__error">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M12 9V13M12 17H12.01M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {editError}
            </div>
          )}

          {/* Footer Actions */}
          <div className="fc-modules-modal__footer">
            <button
              type="button"
              className="fc-modules-modal__button fc-modules-modal__button--cancel"
              onClick={onClose}
              disabled={editSaving}
            >
              Cancel
            </button>
            <button
              type="button"
              className="fc-modules-modal__button fc-modules-modal__button--cancel"
              onClick={() => copyAccountValueTo("MarketValue")}
              disabled={editSaving || !accountValueAvailable}
            >
              Copy Market
            </button>
            <button
              type="button"
              className="fc-modules-modal__button fc-modules-modal__button--cancel"
              onClick={() => copyAccountValueTo("BaseValue")}
              disabled={editSaving || !accountValueAvailable}
            >
              Copy Base
            </button>
            <button
              type="submit"
              className="fc-modules-modal__button fc-modules-modal__button--save"
              disabled={editSaving}
            >
              {editSaving ? (
                <>
                  <span className="fc-modules-modal__spinner"></span>
                  Saving...
                </>
              ) : (
                <>
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M19 21H5C3.89543 21 3 20.1046 3 19V5C3 3.89543 3.89543 3 5 3H16L21 8V19C21 20.1046 20.1046 21 19 21Z"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M17 21V13H7V21M7 3V8H15"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Save Changes
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
