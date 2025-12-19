import { Fragment, useEffect, useState } from "react";
import coa from "../../../../components/data/coa.json";
import coaTraits from "../../../../components/data/coa_traits.json";
import Rest from "../../js/rest";
import "./FCModulesEdit.css";

const balanceSheetLevel2Options = (() => {
  const entries =
    Array.isArray(coa) &&
    coa.find((entry) =>
      Object.prototype.hasOwnProperty.call(entry, "Balance Sheet Accounts")
    )?.["Balance Sheet Accounts"];

  const results = [];

  const walk = (nodes, depth) => {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      const [key, value] = Object.entries(node || {})[0] || [];
      if (!key) continue;
      if (depth === 2) {
        results.push(key);
      }
      if (Array.isArray(value)) {
        walk(value, depth + 1);
      } else if (value && typeof value === "object") {
        walk([value], depth + 1);
      }
    }
  };

  walk(entries, 1);
  return Array.from(new Set(results)).filter(
    (name) => name !== "Bank Accounts"
  );
})();

const getChildCategoriesForAccount = (accountName) => {
  if (!accountName) return [];

  const entries =
    Array.isArray(coa) &&
    coa.find((entry) =>
      Object.prototype.hasOwnProperty.call(entry, "Balance Sheet Accounts")
    )?.["Balance Sheet Accounts"];

  const children = [];

  const walk = (nodes, depth) => {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      const [key, value] = Object.entries(node || {})[0] || [];
      if (!key) continue;

      if (depth === 2 && key === accountName) {
        if (Array.isArray(value)) {
          for (const child of value) {
            if (child && typeof child === "object") {
              const childKey = Object.keys(child)[0];
              if (childKey) {
                children.push(childKey);
              }
            } else if (typeof child === "string") {
              children.push(child);
            }
          }
        } else if (typeof value === "string") {
          children.push(value);
        }
        return;
      }

      if (Array.isArray(value)) {
        walk(value, depth + 1);
      } else if (value && typeof value === "object") {
        walk([value], depth + 1);
      }
    }
  };

  walk(entries, 1);
  return Array.from(new Set(children));
};

const expenseCategoryOptions = (() => {
  const entries =
    Array.isArray(coa) &&
    coa.find((entry) =>
      Object.prototype.hasOwnProperty.call(entry, "Profit & Loss Accounts")
    )?.["Profit & Loss Accounts"];

  const collectLeafStrings = (node, results) => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach((item) => collectLeafStrings(item, results));
      return;
    }
    if (typeof node === "string") {
      const trimmed = node.trim();
      if (trimmed) results.push(trimmed);
      return;
    }
    if (typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        if (typeof value === "string") {
          const trimmed = value.trim() || key.trim();
          if (trimmed) results.push(trimmed);
          continue;
        }
        collectLeafStrings(value, results);
      }
    }
  };

  const findKey = (node, targetKey) => {
    if (!node || typeof node !== "object") return null;
    if (Object.prototype.hasOwnProperty.call(node, targetKey)) {
      return node[targetKey];
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = findKey(item, targetKey);
        if (found !== null && found !== undefined) {
          return found;
        }
      }
      return null;
    }
    for (const value of Object.values(node)) {
      if (value && typeof value === "object") {
        const found = findKey(value, targetKey);
        if (found !== null && found !== undefined) {
          return found;
        }
      }
    }
    return null;
  };

  const results = [];

  if (Array.isArray(entries)) {
    const expenseEntry = entries.find(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        Object.prototype.hasOwnProperty.call(entry, "Expense")
    );
    const expenseTree = expenseEntry?.Expense;
    const financialExpenses = findKey(expenseTree, "Financial Expenses");
    collectLeafStrings(financialExpenses, results);

    const propertyCosts = findKey(expenseTree, "Property Costs");
    const propertySp = findKey(propertyCosts, "Property - SP");
    const propertyOther = findKey(propertySp, "Property - Other");
    collectLeafStrings(propertyOther, results);
  }

  return Array.from(new Set(results)).sort();
})();

const incomeCategoryOptions = (() => {
  const entries =
    Array.isArray(coa) &&
    coa.find((entry) =>
      Object.prototype.hasOwnProperty.call(entry, "Profit & Loss Accounts")
    )?.["Profit & Loss Accounts"];

  const collectLeafStrings = (node, results) => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach((item) => collectLeafStrings(item, results));
      return;
    }
    if (typeof node === "string") {
      const trimmed = node.trim();
      if (trimmed) {
        results.push(trimmed);
      }
      return;
    }
    if (typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        if (typeof value === "string") {
          const trimmed = value.trim();
          const resolved = trimmed || key.trim();
          if (resolved) {
            results.push(resolved);
          }
          continue;
        }
        collectLeafStrings(value, results);
      }
    }
  };

  const findKey = (node, targetKey) => {
    if (!node || typeof node !== "object") return null;
    if (Object.prototype.hasOwnProperty.call(node, targetKey)) {
      return node[targetKey];
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = findKey(item, targetKey);
        if (found !== null && found !== undefined) {
          return found;
        }
      }
      return null;
    }
    for (const value of Object.values(node)) {
      if (value && typeof value === "object") {
        const found = findKey(value, targetKey);
        if (found !== null && found !== undefined) {
          return found;
        }
      }
    }
    return null;
  };

  const results = [];

  if (Array.isArray(entries)) {
    const incomeEntry = entries.find(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        Object.prototype.hasOwnProperty.call(entry, "Income")
    );
    const incomeTree = incomeEntry?.Income;
    const financialIncome = findKey(incomeTree, "Financial Income");
    collectLeafStrings(financialIncome, results);
  }

  return Array.from(new Set(results)).sort();
})();

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
    (editForm?.Name && coaTraits?.[editForm.Name] ? editForm.Name : "") ||
    (effectiveName && coaTraits?.[effectiveName] ? effectiveName : "") ||
    editForm?.Account ||
    "";
  const accountTraits = coaTraits?.[traitKey] || {};
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
    for (const traits of Object.values(coaTraits || {})) {
      if (!traits || typeof traits !== "object") continue;
      if (traits.Type) typeValues.add(traits.Type);
      if (traits.Currency) currencyValues.add(traits.Currency);
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
        const data = await Rest.fetchJson("/api/forecast/assumptions");
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
    const num = Number(String(value ?? "").replace(/,/g, ""));
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
  const scenarioPeriodEnd =
    assumptions?.scenarios?.find((s) => s?.Name === editForm?.Scenario)
      ?.PeriodEnd ?? null;
  const transferYearStart = new Date().getFullYear();
  const transferYearEnd = Number.isFinite(Number(scenarioPeriodEnd))
    ? Number(scenarioPeriodEnd)
    : transferYearStart + 40;
  const transferYearOptions = Array.from(
    { length: transferYearEnd - transferYearStart + 1 },
    (_, index) => transferYearStart + index
  );
  const transferSections = [
    ["Invest", "Invest"],
    ["Dispose", "Dispose"],
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
      getYearFromDate(editForm?.BaseDate) || transferYearStart;
    onFieldChange(field, [
      ...current,
      { Date: `${defaultYear}-07-01`, Amount: "", Flag: "" },
    ]);
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
    ["Growth %", "Growth", "number"],
    ["Expense Category", "ExpCategory", "text"],
    ["Expense %", "ExpensePct", "number"],
    ["Income Category", "IncomeCategory", "text"],
    ["Income %", "IncomePct", "number"],
  ];

  if (!isOpen || !editForm) {
    return null;
  }

  return (
    <div
      className="fc-scenarios-modal-overlay fc-modules-edit__overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Edit forecast module"
    >
      <div
        className="fc-scenarios-modal fc-modules-edit__modal"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className="fc-scenarios-modal__title">Edit Module</h3>
        <form onSubmit={onSubmit}>
          <div className="fc-modules-edit__form-grid">
            {fields.map(([label, field, type, source]) => {
              if (field === "Account") {
                return (
                  <label key={field} className="fc-scenarios-modal__field">
                    <span>{label}</span>
                    <select
                      className="form-input"
                      value={editForm.Account ?? ""}
                      onChange={(event) =>
                        onFieldChange("Account", event.target.value)
                      }
                    >
                      {balanceSheetLevel2Options.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                      {editForm.Account &&
                        !balanceSheetLevel2Options.includes(
                          editForm.Account
                        ) && (
                          <option value={editForm.Account}>
                            {editForm.Account}
                          </option>
                        )}
                    </select>
                  </label>
                );
              }
              if (field === "Name") {
                if (isMatched) {
                  return (
                    <label key={field} className="fc-scenarios-modal__field">
                      <span>{label}</span>
                      <select
                        className="form-input"
                        value={effectiveName}
                        onChange={(event) =>
                          onFieldChange("Name", event.target.value)
                        }
                      >
                        {nameOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                        {!nameOptions.length && (
                          <option value="">No options</option>
                        )}
                      </select>
                    </label>
                  );
                }
                return (
                  <label key={field} className="fc-scenarios-modal__field">
                    <span>{label}</span>
                    <input
                      type="text"
                      className="form-input"
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
                  <label key={field} className="fc-scenarios-modal__field">
                    <span>{label}</span>
                    <input
                      type="checkbox"
                      checked={Boolean(editForm.Matched)}
                      onChange={(event) =>
                        onFieldChange("Matched", event.target.checked)
                      }
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
                  <label key={field} className="fc-scenarios-modal__field">
                    <span>{label}</span>
                    <div className="fc-modules-edit__base-date">
                      <select
                        className="form-input"
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
                    return (
                      <label key={field} className="fc-scenarios-modal__field">
                        <span>{label}</span>
                        <input
                          type="text"
                          className="form-input"
                          value={accountTraits[field] ?? currentValue}
                          disabled
                        />
                      </label>
                    );
                  }
                  return (
                    <Fragment key={field}>
                      <label key={field} className="fc-scenarios-modal__field">
                        <span>{label}</span>
                        <input
                          type="text"
                          className="form-input"
                          value={accountTraits[field] ?? currentValue}
                          disabled
                        />
                      </label>
                      <label className="fc-scenarios-modal__field">
                        <span>Account Value</span>
                        <input
                          type="text"
                          className="form-input"
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
                      <label className="fc-scenarios-modal__field">
                        <span>Account Value USD</span>
                        <input
                          type="text"
                          className="form-input"
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
                  <label key={field} className="fc-scenarios-modal__field">
                    <span>{label}</span>
                    <select
                      className="form-input"
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

              if (field === "ExpCategory") {
                const currentValue = editForm.ExpCategory ?? "";
                return (
                  <label key={field} className="fc-scenarios-modal__field">
                    <span>{label}</span>
                    <div className="fc-modules-edit__expense-grid">
                      <select
                        className="form-input"
                        value={currentValue}
                        onChange={(event) =>
                          onFieldChange("ExpCategory", event.target.value)
                        }
                      >
                        {expenseCategoryOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                        {currentValue &&
                          !expenseCategoryOptions.includes(currentValue) && (
                            <option value={currentValue}>{currentValue}</option>
                          )}
                      </select>
                    </div>
                  </label>
                );
              }

              if (field === "IncomeCategory") {
                const currentValue = editForm.IncomeCategory ?? "";
                return (
                  <label key={field} className="fc-scenarios-modal__field">
                    <span>{label}</span>
                    <select
                      className="form-input"
                      value={currentValue}
                      onChange={(event) =>
                        onFieldChange("IncomeCategory", event.target.value)
                      }
                    >
                      {incomeCategoryOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                      {currentValue &&
                        !incomeCategoryOptions.includes(currentValue) && (
                          <option value={currentValue}>{currentValue}</option>
                        )}
                    </select>
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
                inputValue = formatWithCommas(inputValue);
              }
              const inputClassName = [
                "form-input",
                isReadOnlyValue ? "fc-modules-edit__input--readonly" : "",
              ]
                .filter(Boolean)
                .join(" ");

              return (
                <label key={field} className="fc-scenarios-modal__field">
                  <span>{label}</span>
                  <input
                    type={
                      field === "BaseValue" ||
                      field === "MarketValue" ||
                      field === "BaseValueUSD" ||
                      field === "MarketValueUSD"
                        ? "text"
                        : type
                    }
                    className={inputClassName}
                    value={inputValue}
                    readOnly={isReadOnlyValue}
                    disabled={isLockedField}
                    onChange={
                      isLockedField || isReadOnlyValue
                        ? undefined
                        : (event) =>
                            onFieldChange(
                              field,
                              event.target.value.replace(/,/g, "")
                            )
                    }
                  />
                </label>
              );
            })}
          </div>
          <div className="fc-modules-edit__transfers">
            {transferSections.map(([label, field]) => {
              const transfers = Array.isArray(editForm?.[field])
                ? editForm[field]
                : [];
              return (
                <div key={field} className="fc-modules-edit__transfer-section">
                  <div className="fc-modules-edit__transfer-header">
                    <span className="fc-modules-edit__transfer-label">
                      {label}
                    </span>
                    <button
                      type="button"
                      className="generate-report-button fc-modules-edit__add-button"
                      onClick={() => addTransferEntry(field)}
                    >
                      Add {label}
                    </button>
                  </div>
                  <div className="fc-modules-edit__transfer-columns">
                    <span>Date</span>
                    <span>Amount</span>
                    <span>Flag</span>
                    <span aria-hidden />
                  </div>
                  {transfers.length === 0 ? (
                    <div className="fc-modules-edit__transfer-empty">
                      No {label.toLowerCase()} entries.
                    </div>
                  ) : (
                    transfers.map((entry, index) => (
                      <div
                        key={`${field}-${index}`}
                        className="fc-modules-edit__transfer-row"
                      >
                        <select
                          className="form-input"
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
                          {transferYearOptions.map((year) => (
                            <option key={year} value={year}>
                              {year}
                            </option>
                          ))}
                        </select>
                        <input
                          type="number"
                          className="form-input"
                          value={entry?.Amount ?? ""}
                          onChange={(event) =>
                            updateTransferEntry(
                              field,
                              index,
                              "Amount",
                              event.target.value
                            )
                          }
                        />
                        <input
                          type="text"
                          className="form-input"
                          value={entry?.Flag ?? ""}
                          onChange={(event) =>
                            updateTransferEntry(
                              field,
                              index,
                              "Flag",
                              event.target.value
                            )
                          }
                        />
                        <button
                          type="button"
                          className="generate-report-button fc-modules-edit__remove-button"
                          onClick={() => removeTransferEntry(field, index)}
                        >
                          Remove
                        </button>
                      </div>
                    ))
                  )}
                </div>
              );
            })}
          </div>
          {editError && (
            <p className="trans-budget-edit-modal__error">{editError}</p>
          )}
          <div className="fc-scenarios-modal__actions">
            <button
              type="button"
              className="generate-report-button"
              onClick={onClose}
              disabled={editSaving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="generate-report-button"
              disabled={editSaving}
            >
              {editSaving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
