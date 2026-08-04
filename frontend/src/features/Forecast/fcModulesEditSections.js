// CR041: FCModulesEdit fields grouped into titled sections so expense and
// income configuration no longer interleave on the same grid rows.
// Tuples are [label, field, type] as consumed by the modal's field renderer.
export const FIELD_SECTIONS = [
  ["General", [
    ["Account", "Account", "select"],
    ["Name", "Name", "text"],
    ["Matched", "Matched", "checkbox"],
    ["Base Date", "BaseDate", "date"],
    ["Type", "Type", "text"],
    ["Currency", "Currency", "text"],
  ]],
  ["Valuation", [
    ["Cost Basis", "BaseValue", "number"],
    ["Cost Basis (USD)", "BaseValueUSD", "number"],
    ["Market Value", "MarketValue", "number"],
    ["Market Value (USD)", "MarketValueUSD", "number"],
    ["Growth (x Inflation)", "Growth", "number"],
  ]],
  // CR046: the Start/End YEARS bound WHEN a stream runs, never how much — the amount
  // stays a base-year figure compounded at inflation. Blank = unbounded (the old
  // behavior). Stored as July 1, so the first and last year each carry 50% of the amount,
  // the same half-year convention the engine already uses for an acquisition year and a
  // Full disposal. Ownership still wins: an asset bought in 2035 pays nothing before then,
  // whatever the start year says.
  // CR069 P3 — the "Expenses" and "Income" SECTIONS are gone. They rendered COLUMNS that
  // existed on every module whether or not it had that flow, and `fcModulePayload` sent all of
  // them on every save — so hiding one never cleared it, which is the whole reason CR064 §5
  // refused to gate this form on module type. A stream is a ROW: `FCModulesStreams` renders
  // one card per stream and removing the card removes the row, so there is nothing left to go
  // stale. The CR046 window, the CR047 income tax override and the CR064 P6 growth multiplier
  // all moved onto the card with the stream that owns them.
  // CR047: two taxes, two rates.
  //  - "Full" (TaxRateOverride, migration 010) overrides EVERYTHING on the module: the gain
  //    on disposal AND the recurring income. Blank ⇒ the scenario rate.
  //  - "Recurring Income" (IncomeTaxRateOverride) overrides the recurring income ONLY —
  //    dividends, rent, yield — and never the gain on a disposal. It wins over Full when
  //    both are set. For income that arrives already taxed elsewhere: United Beverages'
  //    dividend is net of Polish tax, so the incremental US tax on it is ~3%, while a sale
  //    of the business is still an ordinary capital gain at the full rate.
  // Blank on either = fall back (no change). 0 is a real rate, not "unset".
  ["Tax", [
    // CR069 P3 — only the GAINS rate lives on the module now: a capital gain belongs to the
    // valuation. The recurring-income override belongs to the income stream and is edited on
    // its card, which is also what makes it possible to have two income streams taxed
    // differently — something a single module column could never express.
    ["Capital Gains Tax Override (%)", "TaxRateOverride", "number"],
  ]],
];

// CR062 — a LOAN is configured from five assumptions, not from the valuation and
// expense fields an asset uses. Its interest is derived from the rate and the
// running balance, so an Expense Amount would be meaningless next to it, and its
// income fields have nothing to describe.
//
// The engine keys on `loan_interest_rate`, never on this Type. Type only decides
// which fields are shown — see `isLoanModule` below for why that split matters.
export const LOAN_FIELD_SECTIONS = [
  ["General", [
    ["Account", "Account", "select"],
    ["Name", "Name", "text"],
    ["Matched", "Matched", "checkbox"],
    ["Base Date", "BaseDate", "date"],
    ["Type", "Type", "text"],
    ["Currency", "Currency", "text"],
  ]],
  ["Loan", [
    ["Original Loan Amount", "LoanPrincipal", "number"],
    ["Year Taken (July 1)", "LoanStartDate", "year"],
    ["Interest Rate (%)", "LoanInterestRate", "number"],
    ["End Year — repays the remainder", "LoanEndDate", "year"],
    ["Outstanding Today (negative)", "MarketValue", "number"],
    ["Outstanding Today (USD)", "MarketValueUSD", "number"],
    // CR062 P2 — which asset this debt is secured on. ANY module qualifies, not
    // just Real Estate: a margin loan against a brokerage account and a
    // shareholder loan against a business are the same shape. Blank = unsecured,
    // which simply means the loan does not appear on the Equity report.
    ["Secured Against", "SecuredAssetModuleId", "secured-asset"],
  ]],
  ["Tax", [
    ["Capital Gains Tax Override (%)", "TaxRateOverride", "number"],
  ]],
];

/**
 * CR062 — does this form describe a loan?
 *
 * Matched case-insensitively AND with a fallback to the rate itself, because
 * `Type` is free text backed by a list the owner edits in Forecast Settings (prod
 * already carries a lowercase "asset"). If the type were the only signal, renaming
 * or mistyping it would hide the Loan section while the engine — which keys on
 * `loan_interest_rate` alone — went on charging interest, leaving live assumptions
 * that could not be edited or even seen.
 */
export const isLoanModule = (form) =>
  String(form?.Type || "").trim().toLowerCase() === "loan" ||
  form?.LoanInterestRate != null;

export const fieldSectionsFor = (form) =>
  (isLoanModule(form) ? LOAN_FIELD_SECTIONS : FIELD_SECTIONS);

// ---------------------------------------------------------------------------
// CR064 P3 — collapse a section that has nothing in it.
//
// The owner's complaint that started this ("Loan got its own form — shouldn't the
// other types?") is real: Real Estate never uses Income (0 of 40 modules), Business
// never uses Expenses (0 of 18), Liability and Asset use neither, and Tax is unused
// on all 103 modules in the database. But per-TYPE field sets are the wrong fix —
// `module_type` is a free-text list the owner edits (prod carries both `Asset` and
// `asset`), and a hidden field is not a cleared one: fcModulePayload sends every
// field on every save, so hiding a section would leave a stale expense charging the
// P&L invisibly. That is why CR062's Loan carve-out needed a preview endpoint and a
// confirmed delete, per type.
//
// Emptiness needs neither. A section that is empty is collapsed and reopens on one
// click; a section with anything in it is open. It cannot hide a live value BY
// CONSTRUCTION, it needs no confirm dialog, and it works for the tenth type the
// owner invents next. See CR064 §4.1 / §5.
// ---------------------------------------------------------------------------

/** Sections that stay open even when empty — the ones every module is defined by. */
export const ALWAYS_OPEN_SECTIONS = new Set(["General", "Valuation", "Loan"]);

/** Fields whose default value is not "empty" in the raw sense. */
const FIELD_DEFAULTS = { ExpenseGrowthMethod: "inflation" };

/** Is this one field unset? Zero counts as unset: a 0 expense charges nothing. */
export const fieldIsEmpty = (form, field) => {
  const value = form?.[field];
  if (value === null || value === undefined || value === "") return true;
  if (value === FIELD_DEFAULTS[field]) return true;
  if (Array.isArray(value)) return value.length === 0;
  const num = Number(value);
  return Number.isFinite(num) && num === 0;
};

/** Does this section hold anything at all? */
export const sectionHasContent = (form, fields) =>
  (fields || []).some(([, field]) => !fieldIsEmpty(form, field));

/**
 * Sections open on first render: the always-open ones, plus any that carry a value.
 * Recomputed only when the modal opens — collapsing a section the moment its last
 * field is cleared would yank it out from under the cursor.
 */
export const initialOpenSections = (form, sections) => {
  const open = new Set();
  for (const [title, fields] of sections || []) {
    if (ALWAYS_OPEN_SECTIONS.has(title) || sectionHasContent(form, fields)) open.add(title);
  }
  return open;
};

// ---------------------------------------------------------------------------
// CR064 §4.2 — per-type LABELS. Cosmetic only, and deliberately not per-type
// fields: a lookup miss (an unknown or renamed type) costs a generic word, never a
// value. `Invest`/`Dispose` are what a private-equity fund does least like — all ten
// PE modules use both, and both are really capital calls and distributions.
// ---------------------------------------------------------------------------
const TYPE_LABELS = {
  "private equity": { Invest: "Capital Call", Dispose: "Distribution" },
  "fixed income": { IncomePct: "Coupon Spread" },
};

/** The label for `field` on a module of `type`, or `fallback` when there is no override. */
export const labelForType = (type, field, fallback) =>
  TYPE_LABELS[String(type || "").trim().toLowerCase()]?.[field] ?? fallback;
