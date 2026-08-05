import { Fragment, useEffect, useState } from "react";
import Rest from "../../js/rest";
import FCModuleAuditModal from "./FCModuleAuditModal.jsx";
import Modal from "../../components/Modal/Modal.jsx";
import FCModulesStreams from "./FCModulesStreams.jsx";
import "./FCModulesStreams.css";
import {
  fieldSectionsFor,
  isLoanModule,
  initialOpenSections,
  labelForType,
} from "./fcModulesEditSections.js";
import {
  resolveFxRate,
  localToUsd,
  allocateBudget,
  resolveInflationRate,
  firstForecastYearAmount,
} from "./utils/fcModuleFx.js";
import "./FCModulesEdit.css";

const normalizeBaseDate = (value) => {
  if (!value) return "";
  const [year] = String(value).split("-");
  return year ? `${year}-12-31` : "";
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
  scenarioName = "",
  onSave,
}) {
  const [generating, setGenerating] = useState(false);
  const isMatched = Boolean(editForm?.Matched);

  // CR064 P3 — which field sections are expanded. Seeded ONCE per module opened, not
  // derived on every render: recomputing from the live form would collapse a section
  // the moment its last field was cleared, out from under the cursor. `moduleKey`
  // reseeds when a different module is opened in the same mounted modal.
  const moduleKey = editForm?.id ?? "new";
  const [openSections, setOpenSections] = useState(() => new Set());
  useEffect(() => {
    if (!isOpen || !editForm) return;
    setOpenSections(initialOpenSections(editForm, fieldSectionsFor(editForm)));
    // Seeding is deliberately keyed to the module, not to the form's contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, moduleKey]);
  const toggleSection = (title) =>
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });

  // Cash sweep priority options (CR017): only ranks NOT already taken by another module
  // in this scenario, plus this module's own current rank and "Not in sweep". This makes
  // duplicate ranks impossible from the UI (the backend also rejects collisions).
  const currentSweepPriority =
    editForm?.CashSweepPriority == null || editForm?.CashSweepPriority === ""
      ? null
      : Number(editForm.CashSweepPriority);
  const takenSweepRanks = new Set(
    (allModules || [])
      .filter((m) => m.id !== editForm?.id && m.CashSweepPriority != null)
      .map((m) => Number(m.CashSweepPriority))
  );
  const sweepRankOptions = [];
  const maxSweepRank = takenSweepRanks.size + 1; // always exactly one new slot = the next free number
  for (let r = 1; r <= maxSweepRank; r++) {
    if (!takenSweepRanks.has(r) || r === currentSweepPriority) sweepRankOptions.push(r);
  }
  if (currentSweepPriority != null && !sweepRankOptions.includes(currentSweepPriority)) {
    sweepRankOptions.push(currentSweepPriority);
  }
  sweepRankOptions.sort((a, b) => a - b);

  const nameOptions = getChildCategoriesForAccount(editForm?.Account);
  const hasMultipleChildren = nameOptions.length > 1;
  const effectiveName = isMatched
    ? hasMultipleChildren
      ? editForm?.Account || ""
      : editForm?.Name && nameOptions.includes(editForm.Name)
      ? editForm.Name
      : nameOptions.length === 1
      ? nameOptions[0]
      : editForm?.Name || editForm?.Account || ""
    : editForm?.Name ?? "";
  const traitKey =
    (editForm?.Name && traits?.[editForm.Name] ? editForm.Name : "") ||
    (effectiveName && traits?.[effectiveName] ? effectiveName : "") ||
    editForm?.Account ||
    "";
  const accountTraits = traits?.[traitKey] || {};
  const traitType = accountTraits?.Type ?? "";
  const traitCurrency = accountTraits?.Currency ?? "";
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [accountBalance, setAccountBalance] = useState({
    value: null,
    valueUSD: null,
    currency: "",
  });
  const [accountBalanceLoading, setAccountBalanceLoading] = useState(false);
  const [assumptions, setAssumptions] = useState(null);
  const [, setAssumptionsLoading] = useState(false);
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
    if (value === null || value === undefined) {
      return "-";
    }
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

  // Auto-set Type and Currency from traits only on initial open (not on every change)
  const [traitApplied, setTraitApplied] = useState(false);
  useEffect(() => {
    if (!isOpen) { setTraitApplied(false); return; }
    if (traitApplied || !editForm || !isMatched) return;
    if (traitType && !editForm.Type) {
      onFieldChange("Type", traitType);
    }
    if (traitCurrency && !editForm.Currency) {
      onFieldChange("Currency", traitCurrency);
    }
    setTraitApplied(true);
  }, [isOpen, editForm, isMatched, traitType, traitCurrency, onFieldChange, traitApplied]);

  // No longer auto-default Name to first option — let the user type or pick freely

  useEffect(() => {
    if (!isOpen || !editForm?.BaseDate) return;
    if (editForm.BaseDate.endsWith("-12-31")) return;
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
        const report = await Rest.fetchBalanceReportV2(editForm.BaseDate);
        if (!isActive) return;
        const node = findBalanceNode(report, effectiveName);
        if (node) {
          let rawLocal, currency;
          const rawUsd = Number(node.totalUSD);
          const hasUsd = Number.isFinite(rawUsd);
          if (Array.isArray(node.children) && node.children.length > 0) {
            // Parent node: sum children's local values and detect currency
            let localSum = 0;
            let localCount = 0;
            let commonCurrency = null;
            for (const child of node.children) {
              const childLocal = Number(child.total);
              if (Number.isFinite(childLocal)) {
                localSum += childLocal;
                localCount++;
                const cc = typeof child.currency === "string" ? child.currency : "";
                if (commonCurrency === null) commonCurrency = cc;
                else if (commonCurrency !== cc) commonCurrency = "";
              }
            }
            rawLocal = localCount > 0 ? localSum : NaN;
            currency = commonCurrency || (hasUsd ? "USD" : "");
          } else {
            rawLocal = Number(node.total);
            currency =
              typeof node.currency === "string" && node.currency
                ? node.currency
                : hasUsd && !Number.isFinite(rawLocal)
                ? "USD"
                : "";
          }
          const hasLocal = Number.isFinite(rawLocal);
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
  // CR064 P0 — see utils/fcModuleFx.js. A matched module uses its own balance-sheet
  // ratio; anything else uses the scenario's FX assumption, and a module with neither
  // keeps whatever USD figure is stored instead of being handed one at a rate of 1.
  const fxRate = resolveFxRate({
    fxRows: assumptions?.FX,
    scenario: editForm?.Scenario,
    currency: editForm?.Currency,
    year: baseYear,
  });
  const toUsd = (localNumber) =>
    localToUsd({ localNumber, isMatched, accountValueRatio, fxRate });
  const computedBaseValueUSD = toUsd(baseValueNumber);
  const computedMarketValueUSD = toUsd(marketValueNumber);
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
    // CR064 P0 — `undefined` means the conversion is unavailable (a foreign-currency
    // module in a scenario with no FX rate for it). Leave the stored figure alone:
    // overwriting it is how a hand-typed correct value used to be replaced by the
    // local amount at an implied rate of 1.
    if (computedBaseValueUSD !== undefined && baseUsdNext !== baseUsdCurrent) {
      onFieldChange(
        "BaseValueUSD",
        computedBaseValueUSD === "" ? "" : computedBaseValueUSD
      );
    }
    if (computedMarketValueUSD !== undefined && marketUsdNext !== marketUsdCurrent) {
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
  const periodStartNum = Number(scenarioPeriodStart) > 1900
    ? Number(scenarioPeriodStart)
    : currentYear;
  // Invest/Dispose transfers available from Base Year (PeriodStart - 1) onward
  const transferYearStart = periodStartNum - 1;
  const transferYearEndCandidate = Number(scenarioPeriodEnd) > 1900
    ? Number(scenarioPeriodEnd)
    : transferYearStart + 20;
  const transferYearEnd = Math.max(transferYearStart, transferYearEndCandidate);
  const transferYearOptions = Array.from(
    { length: transferYearEnd - transferYearStart + 1 },
    (_, index) => transferYearStart + index
  );
  // Income % available from Period 1 (PeriodStart) onward
  const incomePctYearOptions = transferYearOptions.filter(y => y >= periodStartNum);
  const transferFlagOptionsI = ["OneTime", "Periodic"];
  const transferFlagOptionsD = ["Full", "OneTime", "Periodic"];
  const incomePctLabel = "Yield Spread";
  // CR062 — on a loan the principal schedule is DERIVED from the five assumptions,
  // so Invest/Dispose/Yield have nothing to say and the route rejects any non-empty
  // one. Showing an editor whose contents would be refused on save is worse than
  // showing none. Amortization years run drawYear+1 … endYear−1: the end year is
  // the remainder by construction and must not also carry a percentage.
  const isLoan = isLoanModule(editForm);
  // CR064 P6 — the engine's two income modes are mutually exclusive and the yield wins
  // on a SINGLE row (`hasIncomePct` in fcbuilder-module.js), discarding Income Amount
  // entirely. All six income-bearing modules in prod are in yield mode, so all six have
  // a dead Income Amount — United Beverages shows 192,266 typed while the engine books
  // 2% of a 15M valuation. Nothing in the form said so.
  const incomeIsYieldDriven =
    Array.isArray(editForm?.IncomePct) && editForm.IncomePct.length > 0;
  const loanDrawYear = Number(getYearFromDate(editForm?.LoanStartDate)) || null;
  const loanEndYear = Number(getYearFromDate(editForm?.LoanEndDate)) || null;
  const amortYearOptions =
    loanDrawYear && loanEndYear && loanEndYear > loanDrawYear
      ? Array.from({ length: loanEndYear - loanDrawYear - 1 }, (_, i) => loanDrawYear + 1 + i)
      : [];
  // CR064 §4.2 — the label is per type, the FIELDS never are. A private-equity fund
  // does not "invest" and "dispose", it draws capital calls and pays distributions;
  // a fixed-income holding's yield spread is a coupon spread. An unknown or renamed
  // type simply keeps the generic word — a lookup miss costs a noun, never a value.
  const transferSections = isLoan
    ? [["Amortization", "Amortization"]]
    : [
        [labelForType(editForm?.Type, "Invest", "Invest"), "Invest"],
        [labelForType(editForm?.Type, "Dispose", "Dispose"), "Dispose"],
        [labelForType(editForm?.Type, "IncomePct", incomePctLabel), "IncomePct"],
        // CR064 P6 — permanent step changes to amount-based income ("2027: +10,000").
        ["Income Steps", "IncomeSteps"],
      ];

  /**
   * CR062 — the one click that makes a loan simple: fill drawYear+1 … endYear−1
   * with 100/term %. The end year is deliberately left out; it repays whatever is
   * left, which is what makes the loan close at exactly zero instead of 40 cents
   * short (100/9 stored at 4dp sums to 99.9999%).
   */
  const fillStraightLine = () => {
    if (!amortYearOptions.length) return;
    const term = loanEndYear - loanDrawYear;
    const pct = Number((100 / term).toFixed(4));
    onFieldChange(
      "Amortization",
      amortYearOptions.map((year) => ({ Date: `${year}-07-01`, Pct: pct }))
    );
  };

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
    if (field === "Amortization") {
      // CR062 — default to the first unused schedule year rather than PeriodStart,
      // which is usually outside the loan's own window.
      const used = new Set(current.map((e) => String(e?.Date || "").slice(0, 4)));
      const nextYear = amortYearOptions.find((y) => !used.has(String(y))) ?? amortYearOptions[0] ?? defaultYear;
      onFieldChange(field, [...current, { Date: `${nextYear}-07-01`, Pct: "" }]);
    } else if (field === "IncomeSteps") {
      // First unused projected year, so two steps do not collide on the table's
      // (module_id, effective_date) key.
      const used = new Set(current.map((e) => String(e?.Date || "").slice(0, 4)));
      const nextYear = incomePctYearOptions.find((y) => !used.has(String(y)))
        ?? incomePctYearOptions[0] ?? defaultYear;
      onFieldChange(field, [...current, { Date: `${nextYear}-07-01`, Amount: "" }]);
    } else if (field === "IncomePct") {
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

  if (!isOpen || !editForm) {
    return null;
  }

  return (
    <>
      <Modal
        open={isOpen}
        onClose={onClose}
        bare
        dismissable={!editSaving}
        closeOnOutside={false}
        ariaLabel="Edit forecast module"
      >
        <div className="fc-modules-modal">
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
              <h3 className="fc-modules-modal__title">
                {editForm?.id ? "Edit Module" : "New Module"}
              </h3>
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
              {/* Status & Notes bar */}
              <div style={{ display: "flex", gap: "1rem", alignItems: "flex-start", padding: "0.5rem 0 0.75rem", borderBottom: "1px solid var(--border)", marginBottom: "0.75rem" }}>
                <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", minWidth: "10rem" }}>
                  <span className="fc-modules-modal__label">Status</span>
                  <select
                    className="fc-modules-modal__input"
                    value={editForm.SetupStatus ?? "new"}
                    onChange={(e) => onFieldChange("SetupStatus", e.target.value)}
                    style={{ width: "10rem" }}
                  >
                    <option value="new">New</option>
                    <option value="in_progress">In Progress</option>
                    <option value="complete">Complete</option>
                    <option value="exclude">Exclude</option>
                  </select>
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", minWidth: "8rem" }}>
                  <span className="fc-modules-modal__label" style={{ whiteSpace: "nowrap" }}>Sweep Priority</span>
                  <select
                    className="fc-modules-modal__input"
                    value={currentSweepPriority ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      onFieldChange("CashSweepPriority", v === "" ? null : parseInt(v, 10));
                    }}
                    title="Cash sweep order: 1 = primary (excess parked here, drained first on shortfall); 2, 3, … = backups drained in order. Ranks already used by another module aren't offered — clear that module's priority first to reassign."
                    style={{ width: "8rem" }}
                  >
                    <option value="">— Not in sweep —</option>
                    {sweepRankOptions.map((r) => (
                      <option key={r} value={r}>
                        {r === 1 ? "1 (primary)" : r}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", flex: 1 }}>
                  <span className="fc-modules-modal__label">Notes</span>
                  <textarea
                    className="fc-modules-modal__input"
                    value={editForm.Comment ?? ""}
                    onChange={(e) => onFieldChange("Comment", e.target.value)}
                    placeholder="Items to check, update, or review..."
                    style={{ resize: "vertical", minHeight: "2.2rem", lineHeight: "1.4", fontFamily: "inherit", fontSize: "0.85rem" }}
                    rows="1"
                  />
                </label>
              </div>
              {fieldSectionsFor(editForm).map(([sectionTitle, sectionFields]) => (
                <div key={sectionTitle} className="fc-modules-modal__field-group">
                  {/* CR064 P3 — an empty section collapses to a single "+ Add" line.
                      Always a button, never a hidden field: the value is still on the
                      form and still saved, so this can never hide a live number. */}
                  {openSections.has(sectionTitle) ? (
                    <>
                      <h5 className="fc-modules-modal__group-title">{sectionTitle}</h5>
                      {sectionTitle === "Income" && incomeIsYieldDriven && (
                        <p className="fc-modules-modal__mode-note">
                          This module is on <b>Yield Spread</b>: its income is a percentage
                          of market value, and the amount, growth and steps below are
                          <b> not used</b>. Remove the Yield Spread rows to drive income
                          from the amount instead.
                        </p>
                      )}
                    </>
                  ) : (
                    <button
                      type="button"
                      className="fc-modules-modal__group-toggle"
                      onClick={() => toggleSection(sectionTitle)}
                    >
                      + Add {sectionTitle.toLowerCase()}
                    </button>
                  )}
                  <div
                    className="fc-modules-modal__fields-grid"
                    hidden={!openSections.has(sectionTitle)}
                  >
                    {sectionFields.map(([rawLabel, field, type, source]) => {
                      let label = rawLabel;
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
                          list={isMatched && nameOptions.length > 0 ? "fc-name-suggestions" : undefined}
                          placeholder="Enter module name"
                        />
                        {isMatched && nameOptions.length > 0 && (
                          <datalist id="fc-name-suggestions">
                            {nameOptions.map((name) => (
                              <option key={name} value={name} />
                            ))}
                          </datalist>
                        )}
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
                                `${event.target.value}-12-31`
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
                            Dec 31
                          </span>
                        </div>
                      </label>
                    );
                  }

                  // CR046: income/expense window — the owner picks a YEAR, never a day.
                  // Stored as July 1, which is what gives the first and last year their
                  // 50% (the engine's half-year convention). Blank = unbounded.
                  if (type === "year") {
                    const raw = editForm[field] ?? "";
                    const selectedYear = raw ? String(raw).slice(0, 4) : "";
                    return (
                      <label key={field} className="fc-modules-modal__field">
                        <span className="fc-modules-modal__label">{label}</span>
                        <div className="fc-modules-edit__base-date">
                          <select
                            className="fc-modules-modal__input"
                            value={selectedYear}
                            onChange={(event) =>
                              onFieldChange(
                                field,
                                event.target.value ? `${event.target.value}-07-01` : null
                              )
                            }
                          >
                            <option value="">—</option>
                            {baseYearOptions.map((year) => (
                              <option key={year} value={year}>
                                {year}
                              </option>
                            ))}
                          </select>
                          <span className="fc-modules-edit__base-date-hint">
                            {/* CR062 — "50%" is CR046's income/expense-window hint and
                                is only true there. On a loan the draw year does carry
                                half a year of interest (the average-balance formula
                                gives it), but the END year repays the whole remaining
                                balance — showing "50%" against it reads as a half
                                repayment, which is exactly wrong. */}
                            {!selectedYear
                              ? ""
                              : field === "LoanStartDate"
                              ? "½ year of interest"
                              : field === "LoanEndDate"
                              ? "repays the balance"
                              : "50% in this year"}
                          </span>
                        </div>
                      </label>
                    );
                  }

                  // Module TYPE is the forecast module's own vocabulary — Real Estate,
                  // Stocks, Private Equity, Business — configured in Forecast Settings.
                  // It used to be rendered from that list only when the module was MATCHED;
                  // an unmatched module fell through to the generic trait branch below and
                  // was offered the COA's *account* types (asset / expense / income /
                  // liability) instead, so a new property could not be typed Real Estate at
                  // all. (Prod carries a lowercase "asset" module_type from that path.)
                  // The engine never reads module_type — it is descriptive — so this is a
                  // pure UI fix, but it is the same list either way now.
                  // CR062 P2 — which asset this loan is secured on. The list is every
                  // module in the SAME scenario that is not itself a loan and is not this
                  // module: a cross-scenario link would make the Equity report show
                  // another scenario's house against this mortgage, with both numbers
                  // real. The route refuses those too, but a picker that cannot offer
                  // them is the better guard.
                  if (type === "secured-asset") {
                    const current = editForm[field] ?? "";
                    const options = (allModules || [])
                      .filter(
                        (m) =>
                          m &&
                          m.LoanInterestRate == null &&
                          String(m.id) !== String(editForm?.id)
                      )
                      .map((m) => ({ id: m.id, name: m.Name || m.name }))
                      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
                    return (
                      <label key={field} className="fc-modules-modal__field">
                        <span className="fc-modules-modal__label">{label}</span>
                        <select
                          className="fc-modules-modal__input"
                          value={current === null ? "" : String(current)}
                          onChange={(e) =>
                            onFieldChange(field, e.target.value === "" ? null : Number(e.target.value))
                          }
                        >
                          <option value="">— Not secured —</option>
                          {options.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    );
                  }

                  if (field === "Type") {
                    const currentValue = editForm[field] ?? "";
                    const capitalize = (v) => (v ? v.charAt(0).toUpperCase() + v.slice(1) : "");
                    const typeValue = capitalize(currentValue);
                    // CR070 P0 (D3) — the list is derived in FCModuleManage from the scenario's
                    // own modules (plus Expense/Income, plus any configured appdata list). The
                    // hardcoded array that used to live here could not offer `Expense` or
                    // `Income` — the types on 60 of prod's 170 modules — so nothing could be
                    // retyped to either, while it offered three types with zero modules.
                    const typeOpts = (traits?.moduleTypes && traits.moduleTypes.length > 0)
                      ? traits.moduleTypes
                      : ["Expense", "Income"];
                    return (
                      <label key={field} className="fc-modules-modal__field">
                        <span className="fc-modules-modal__label">{label}</span>
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

                  if (field === "Currency") {
                    const options = traitValueOptions[field] || [];
                    const currentValue = editForm[field] ?? "";
                    if (isMatched) {
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
                            <span>PY Actual ({editForm?.BaseDate ? new Date(editForm.BaseDate).getFullYear() : ""})</span>
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
                            <span>PY Actual (USD)</span>
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
                    const availableLines = fcLines.filter((l) => l.line_type === lineType);
                    const currentValue = editForm[field] ?? "";
                    const lineId = currentValue ? Number(currentValue) : null;
                    // CR064 P7 — this whole block used to add up THREE DIFFERENT CURRENCIES
                    // and call the answer "Remaining".
                    //
                    //   `fcBudgetTotals` is SUM(budget_entries.base_amount) — always USD.
                    //   `expense_amount` / `income_amount` are in the MODULE's currency
                    //   (the engine divides them by the FX series to get USD).
                    //
                    // So on a PLN module the hint compared a USD budget against a PLN
                    // input, and reconciled to zero when the two numbers matched as
                    // digits. That is exactly what happened to United Beverages: its
                    // dividend budget is 690,000 PLN = 192,266 USD, and the module holds
                    // **192,266** — the USD figure typed into a PLN field, with the hint
                    // reporting "Remaining: -0" as though it balanced. Inert only while
                    // the module is in yield mode (CR064 §6.1); in amount mode it would
                    // book about a quarter of the intended dividend.
                    //
                    // Everything is now added up in USD — the one unit all the inputs can
                    // be converted to — and then presented in the module's own currency,
                    // labelled, so the number on screen is in the same unit as the field
                    // being typed into.
                    const budgetUSD = lineId ? Math.abs(fcBudgetTotals[lineId] || 0) : 0;
                    const moduleCcy = editForm?.Currency || "USD";
                    /** Native units per USD for `ccy` in this scenario; null = cannot convert. */
                    const unitsPerUsd = (ccy) =>
                      resolveFxRate({
                        fxRows: assumptions?.FX,
                        scenario: editForm?.Scenario,
                        currency: ccy,
                        year: baseYear,
                      });

                    const currentModuleId = editForm?.id;
                    const otherRows = lineId
                      ? allModules.filter((m) => {
                          const mLineId = isExpense
                            ? (m.ExpenseFcLineId || m.expense_fc_line_id)
                            : (m.IncomeFcLineId || m.income_fc_line_id);
                          return Number(mLineId) === lineId && m.id !== currentModuleId;
                        })
                      : [];
                    // A module whose currency has no rate is EXCLUDED and counted, never
                    // added in as though it were USD — that is the bug, one level down.
                    const alloc = allocateBudget({
                      budgetUSD,
                      moduleCurrency: moduleCcy,
                      thisAmount: parseFloat(isExpense ? (editForm.ExpenseAmount ?? 0) : (editForm.IncomeAmount ?? 0)) || 0,
                      others: otherRows.map((m) => ({
                        amount: parseFloat(
                          isExpense
                            ? (m.ExpenseAmount ?? m.expense_amount ?? 0)
                            : (m.IncomeAmount ?? m.income_amount ?? 0)
                        ) || 0,
                        currency: m.Currency || m.currency || "USD",
                      })),
                      rateFor: unitsPerUsd,
                    });
                    const fmt = (n) => n === null || n === undefined
                      ? "—"
                      : n.toLocaleString("en-US", { maximumFractionDigits: 0 });
                    const budgetShown = alloc.budget;
                    const otherShown = alloc.others;
                    const remainingShown = alloc.remaining;
                    const unconvertible = alloc.unconvertible;
                    const otherModulesUSD = alloc.others === null ? 0 : alloc.others;
                    const isForeign = moduleCcy !== "USD";

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
                              {fcBudgetTotals[line.id] ? ` (${Math.abs(fcBudgetTotals[line.id]).toLocaleString("en-US", { maximumFractionDigits: 0 })} USD)` : ""}
                            </option>
                          ))}
                        </select>
                        {lineId && budgetUSD > 0 && (
                          <div className="fc-modules-modal__budget-hint">
                            <span>
                              Budget: <b>{fmt(budgetShown)} {moduleCcy}</b>
                              {isForeign && alloc.canConvert && (
                                <span className="fc-modules-modal__budget-usd">
                                  {" "}({fmt(budgetUSD)} USD @ {unitsPerUsd(moduleCcy)})
                                </span>
                              )}
                            </span>
                            {otherModulesUSD > 0 && (
                              <span> — Other modules: {fmt(otherShown)} {moduleCcy}</span>
                            )}
                            <span> — Remaining: <b style={{
                              color: remainingShown === null ? undefined
                                : remainingShown < 0 ? "var(--danger, #C0504D)"
                                : Math.round(remainingShown) === 0 ? "var(--success, #5B8C5B)"
                                : undefined,
                            }}>
                              {fmt(remainingShown)} {moduleCcy}
                            </b></span>
                            {!alloc.canConvert && isForeign && (
                              <div className="fc-modules-modal__budget-warn">
                                No {moduleCcy} rate in this scenario, so the budget cannot be
                                shown in {moduleCcy}. The amount you type is in <b>{moduleCcy}</b>;
                                the budget above is <b>{fmt(budgetUSD)} USD</b>.
                              </div>
                            )}
                            {unconvertible > 0 && (
                              <div className="fc-modules-modal__budget-warn">
                                {unconvertible} other module{unconvertible > 1 ? "s" : ""} on this
                                line could not be converted and {unconvertible > 1 ? "are" : "is"} excluded.
                              </div>
                            )}
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
                          placeholder="Items to check, update, or review..."
                          rows="2"
                        />
                      </label>
                    );
                  }

                  // CR064 P8 — "(Base Yr)" made the owner do the arithmetic: the field
                  // holds a base-year figure, the engine grows it, and in August 2026 the
                  // number you actually have in mind is 2027's. Name the year, and show
                  // the year that follows — without moving the anchor, which the cash
                  // sweep's opening cash and the deferred base-year tax both read.
                  const isAmountField = field === "IncomeAmount" || field === "ExpenseAmount";
                  // CR064 P9 — the amount is anchored to the SCENARIO's base year
                  // (`PeriodStart − 1`), NOT to the module's own `BaseDate`. The engine
                  // grows it with `periodNum = year − periodStart + 1`, so one inflation
                  // step lands it on PeriodStart and `base_date` never enters the
                  // calculation. Labelling it from `BaseDate` was wrong for 18 of the 21
                  // modules in prod — CVC Fund VIII read "(2025)" for a figure the engine
                  // treats as 2026, and the derived hint said "→ 2026" for income the
                  // module output books in 2027.
                  const anchorYear = Number(scenarioPeriodStart) > 1900
                    ? Number(scenarioPeriodStart) - 1
                    : Number(baseYear);
                  const period1 = anchorYear + 1;
                  if (isAmountField && Number.isFinite(anchorYear)) {
                    label = label.replace("(Base Yr)", `(${anchorYear})`);
                  }
                  // The figure the engine will actually project for the first forecast
                  // year. Suppressed where the amount does not drive the stream: a
                  // yield-mode module ignores it (§6.1), and a pct-of-value expense is
                  // driven by the asset rather than by this number.
                  let nextYearHint = null;
                  if (isAmountField && Number.isFinite(period1)) {
                    const amountDrives =
                      field === "IncomeAmount" ? !incomeIsYieldDriven
                        : (editForm?.ExpenseGrowthMethod || "inflation") === "inflation";
                    const growthMult = field === "IncomeAmount" ? editForm?.IncomeGrowth : 1;
                    const projected = amountDrives
                      ? firstForecastYearAmount({
                          baseAmount: parseNumber(editForm?.[field]),
                          inflationPct: resolveInflationRate({
                            inflationRows: assumptions?.inflation,
                            scenario: editForm?.Scenario,
                            year: period1,
                          }),
                          growthMultiplier: growthMult,
                        })
                      : null;
                    if (projected !== null) {
                      const ccy = editForm?.Currency || "USD";
                      const rate = resolveFxRate({
                        fxRows: assumptions?.FX,
                        scenario: editForm?.Scenario,
                        currency: ccy,
                        year: baseYear,
                      });
                      const asUsd = rate ? projected / rate : null;
                      nextYearHint = `→ ${period1}: ${projected.toLocaleString("en-US", { maximumFractionDigits: 0 })} ${ccy}${
                        ccy !== "USD" && asUsd !== null
                          ? ` · ${asUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })} USD`
                          : ""
                      }`;
                    }
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
                  // CR064 P0 — `undefined` = no FX rate to convert with, so show the
                  // stored figure rather than blanking a controlled input.
                  if (field === "BaseValueUSD" && computedBaseValueUSD !== undefined) {
                    inputValue = computedBaseValueUSD;
                  } else if (
                    field === "MarketValueUSD" &&
                    computedMarketValueUSD !== undefined
                  ) {
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
                      {nextYearHint && (
                        <span className="fc-modules-modal__next-year">{nextYearHint}</span>
                      )}
                    </label>
                  );
                    })}
                  </div>
                </div>
              ))}

              {/* CR069 P3 — the module's P&L streams, one card each. A card IS a row: adding
                  one inserts a stream, removing one deletes it. That is what lets this form
                  show only what a module actually has, which CR064 §5 could not do safely
                  while these were columns sent on every save. */}
              <div className="fc-modules-modal__field-group">
                <h5 className="fc-modules-modal__group-title">Income &amp; Expenses</h5>
                <FCModulesStreams
                  streams={editForm.Streams || []}
                  onChange={(next) => onFieldChange("Streams", next)}
                  fcLines={fcLines}
                  periodYears={baseYearOptions}
                  currency={editForm.Currency}
                />
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
                const isAmortization = field === "Amortization";
                const isPctRow = isIncomePct || isAmortization;
                // CR064 P6 — a step is a signed AMOUNT (so not a pct row) but has no
                // Flag: "Periodic" and "OneTime" describe transfers, and a step is a
                // permanent change to the income level rather than an event.
                const isIncomeSteps = field === "IncomeSteps";
                const isNoFlagRow = isPctRow || isIncomeSteps;
                // CR064 P6 — the same collapse-when-empty rule as the field sections
                // (§4.1). A schedule with no rows is one "+ Add" line, so Yield Spread
                // simply is not offered on a business that has none — and IS offered the
                // moment one exists, which a type gate could never guarantee.
                const scheduleKey = `schedule:${field}`;
                if (transfers.length === 0 && !openSections.has(scheduleKey)) {
                  return (
                    <div key={field} className="fc-modules-modal__transfer-section">
                      <button
                        type="button"
                        className="fc-modules-modal__group-toggle"
                        onClick={() => toggleSection(scheduleKey)}
                      >
                        + Add {label.toLowerCase()}
                      </button>
                    </div>
                  );
                }

                return (
                  <div
                    key={field}
                    className="fc-modules-modal__transfer-section"
                  >
                    <div className="fc-modules-modal__transfer-header">
                      <h5 className="fc-modules-modal__transfer-title">
                        {label} {isNoFlagRow ? "" : "Transfers"}
                      </h5>
                      {isIncomePct && (
                        <span style={{ fontSize: "0.75em", color: "var(--muted)", fontWeight: 400 }}>
                          Annual yield above/below inflation (%)
                        </span>
                      )}
                      {isAmortization && (
                        <span style={{ fontSize: "0.75em", color: "var(--muted)", fontWeight: 400 }}>
                          % of the original amount repaid each year — {loanEndYear || "the end year"} repays the remainder
                        </span>
                      )}
                      {isAmortization && (
                        <button
                          type="button"
                          className="fc-modules-modal__add-transfer-button"
                          onClick={fillStraightLine}
                          disabled={!amortYearOptions.length}
                          title={
                            amortYearOptions.length
                              ? `Fill ${amortYearOptions[0]}\u2013${amortYearOptions[amortYearOptions.length - 1]} with ${(100 / (loanEndYear - loanDrawYear)).toFixed(4)}% each`
                              : "Set the year taken and the end year first"
                          }
                        >
                          Straight line
                        </button>
                      )}
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
                        Add {label} {isNoFlagRow ? "Entry" : ""}
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
                          Click "Add {label} {isNoFlagRow ? "Entry" : ""}" to
                          create a{" "}
                          {isIncomeSteps ? "step change" : isPctRow ? "percentage entry" : "transfer"}
                        </span>
                      </div>
                    ) : (
                      <div className="fc-modules-modal__transfer-list">
                        {transfers.map((entry, index) => {
                          // IncomePct uses Value, Amortization uses Pct (CR062),
                          // everything else uses Amount.
                          const fieldValue = isAmortization
                            ? entry?.Pct ?? ""
                            : isIncomePct
                            ? entry?.Value ?? entry?.Amount ?? ""
                            : entry?.Amount ?? "";
                          const fieldKey = isAmortization ? "Pct" : isIncomePct ? "Value" : "Amount";

                          return (
                            <div
                              key={`${field}-${index}`}
                              className="fc-modules-modal__transfer-card"
                            >
                              <div className="fc-modules-modal__transfer-number">
                                {index + 1}
                              </div>
                              <div className="fc-modules-modal__transfer-fields">
                                {!isNoFlagRow && (
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
                                <div className="fc-modules-modal__transfer-field">
                                  <label className="fc-modules-modal__transfer-label">
                                    {entry?.Flag === "Periodic" ? "Start Year" : "Year"}
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
                                    {(isAmortization ? amortYearOptions : (isIncomePct || isIncomeSteps) ? incomePctYearOptions : transferYearOptions).map((year) => (
                                      <option key={year} value={year}>
                                        {year}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                {entry?.Flag === "Periodic" && (
                                  <div className="fc-modules-modal__transfer-field">
                                    <label className="fc-modules-modal__transfer-label">
                                      End Year <span style={{ fontSize: "0.75em", color: "var(--muted)" }}>(optional)</span>
                                    </label>
                                    <select
                                      className="fc-modules-modal__input fc-modules-modal__input--small"
                                      value={getYearFromDate(entry?.DateEnd) || ""}
                                      onChange={(event) =>
                                        updateTransferEntry(
                                          field,
                                          index,
                                          "DateEnd",
                                          event.target.value ? `${event.target.value}-07-01` : null
                                        )
                                      }
                                    >
                                      <option value="">No end (until depleted)</option>
                                      {transferYearOptions
                                        .filter((y) => y >= Number(getYearFromDate(entry?.Date) || 0))
                                        .map((year) => (
                                          <option key={year} value={year}>
                                            {year}
                                          </option>
                                        ))}
                                    </select>
                                  </div>
                                )}
                                <div className="fc-modules-modal__transfer-field">
                                  <label
                                    className="fc-modules-modal__transfer-label"
                                    title={
                                      isIncomePct
                                        ? "Annual yield above/below inflation (%)"
                                        : undefined
                                    }
                                  >
                                    {isPctRow ? "Percentage" : entry?.Flag === "Periodic" ? "Amount / Year" : "Amount"}
                                  </label>
                                  <input
                                    type="text"
                                    inputMode="decimal"
                                    className="fc-modules-modal__input fc-modules-modal__input--small"
                                    value={fieldValue}
                                    title={
                                      isIncomePct
                                        ? "Annual yield above/below inflation (%)"
                                        : entry?.Flag === "Periodic"
                                        ? "Amount disposed each year"
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
                                    placeholder="0"
                                    step={isPctRow ? "0.01" : "1"}
                                  />
                                </div>
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
            {/* A draft (no id) has never been generated, so there is no output to view.
                Hidden rather than disabled: it would query an empty module name. */}
            {editForm?.id ? (
              <button
                type="button"
                className="fc-modules-modal__button fc-modules-modal__button--cancel"
                onClick={() => setShowAuditModal(true)}
              >
                View Output
              </button>
            ) : null}
            <button
              type="button"
              className="fc-modules-modal__button fc-modules-modal__button--generate"
              disabled={generating || editSaving || !scenarioName}
              style={{ marginRight: "auto" }}
              onClick={async () => {
                if (!scenarioName || generating) return;
                setGenerating(true);
                try {
                  if (onSave) {
                    const saved = await onSave();
                    if (!saved) return;
                  }
                  await Rest.fetchJson(
                    `/api/v2/forecast/generate/${encodeURIComponent(scenarioName)}`,
                    { method: "POST" }
                  );
                } catch (e) {
                  console.error("Generate failed:", e);
                } finally {
                  setGenerating(false);
                }
              }}
            >
              {generating ? "Saving & Generating..." : "Generate"}
            </button>
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
              PY → Market Value
            </button>
            <button
              type="button"
              className="fc-modules-modal__button fc-modules-modal__button--cancel"
              onClick={() => copyAccountValueTo("BaseValue")}
              disabled={editSaving || !accountValueAvailable}
            >
              PY → Cost Basis
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
                  {editForm?.id ? "Save Changes" : "Create Module"}
                </>
              )}
            </button>
          </div>
        </form>
        </div>
      </Modal>
      <FCModuleAuditModal
        isOpen={showAuditModal}
        onClose={() => setShowAuditModal(false)}
        scenario={editForm?.Scenario}
        moduleName={editForm?.Name}
      />
    </>
  );
}
