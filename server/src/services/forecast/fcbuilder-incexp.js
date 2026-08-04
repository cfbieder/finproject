const fs = require("fs");
const path = require("path");
const { PATHS } = require("./constants");
const { getIndexValues, buildFcEntriesPayload, insertModuleEntries } = require("./fcbuilder-common");

const auditTrailDir = PATHS.AUDIT_TRAIL_DIR;
let auditTrailDirEnsured = false;

const ensureAuditTrailDir = () => {
  if (auditTrailDirEnsured) return;
  fs.mkdirSync(auditTrailDir, { recursive: true });
  auditTrailDirEnsured = true;
};

const sanitizeName = (value, fallback) => (value && String(value)) || fallback;

/**
 * CR069 P0 — the trail is keyed by the ITEM's name, matching the `module` label its
 * entries now carry. Both used to be the item's ACCOUNT, which is why the two agreed
 * and why the Review breakdown's click-through resolved; they still agree, and now
 * two items on one account get a trail each instead of overwriting one file.
 */
const writeEntriesAuditTrail = (dfCategories, scenarioName, moduleName) => {
  ensureAuditTrailDir();

  const safeScenario = sanitizeName(scenarioName, "scenario").replace(/[^a-z0-9]/gi, "_");
  const safeModule = sanitizeName(moduleName, "module").replace(/[^a-z0-9]/gi, "_");
  const filePath = path.join(auditTrailDir, `${safeScenario}_${safeModule}_entries.csv`);

  const columns = dfCategories.columns || [];
  const rows = dfCategories.values || [];
  const indexValues = getIndexValues(dfCategories);
  const lines = new Array(rows.length + 1);

  lines[0] = ["index", ...columns].join(",") + "\n";
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowParts = new Array(columns.length + 1);
    rowParts[0] = indexValues[i] ?? "";
    for (let j = 0; j < columns.length; j++) {
      rowParts[j + 1] = row?.[j] == null ? "" : row[j];
    }
    lines[i + 1] = rowParts.join(",") + "\n";
  }

  fs.writeFileSync(filePath, lines.join(""), "utf8");
};

const writeValuesToCategoryRow = (rowIndex, dfCategories, valuesToWrite, startYear) => {
  if (rowIndex < 0) return false;
  const startColumnIndex = dfCategories.columns.indexOf(startYear);
  if (startColumnIndex === -1) return false;

  const rowValues = dfCategories.values[rowIndex];
  const columnsLength = dfCategories.columns.length;
  const valuesLength = valuesToWrite.length;

  for (let i = 0; i < valuesLength; i++) {
    const columnIndex = startColumnIndex + i;
    if (columnIndex >= columnsLength) break;
    rowValues[columnIndex] = valuesToWrite[i];
  }
  return true;
};

/**
 * Compute a single income/expense item — PURE (no db, no fs): series math,
 * populates df_categories in place, returns the entries payload. Persistence
 * and audit-CSV writing are the caller's job (CR043 Phase 2.3).
 *
 * CR069 P0 — entries are labelled with the item's NAME, as the BS builder has always
 * done. They used to carry `module.Account` (the FC-line/account name), and the note
 * here claimed two items on one account therefore "overwrite each other via ON CONFLICT
 * at persist — live semantics, preserved". Both halves were false:
 *
 *  - The ON CONFLICT never fired. Its key is
 *    `(scenario_id, forecast_year, account, module, entry_type)` and neither builder
 *    writes `entry_type`; NULLs are distinct in a Postgres unique index, so the rows
 *    were always INSERTed side by side, never merged. The sums were right — which is
 *    why nothing ever looked wrong — but nothing was overwriting anything.
 *  - The attribution was lost. On prod's `2026 Base`, three of twelve items emitted no
 *    entry under their own name: `Retirement Home` filed under `Living Expenses`,
 *    `Car Purchase Chris` under `One-Off Items`, `Social Security` under `Total Salary`.
 *    Retirement Home's −200,000 in 2052 was visible only as Living Expenses carrying two
 *    rows that year. Every breakdown, per-module query and audit click-through was blind
 *    to them.
 *
 * Labelling by name changes no total (the gate is per-(account, year) sums identical to
 * the cent); it changes only which module each row is attributed to.
 *
 * @param {Object} module - Item data with v1-format fields (Account, Name, BaseValue, Growth, Changes)
 * @param {Object} scenario - Scenario config from forecast assumptions
 * @param {LabelFrame} df_assumptions - Assumptions frame
 * @param {LabelFrame} df_categories - Categories frame to populate
 * @param {Array} categories - Category names from assumptions
 * @param {Array} years - Years array
 * @param {number} scenarioId - PostgreSQL scenario ID (payload field only)
 */
function computeModule(module, scenario, df_assumptions, df_categories, categories, years, scenarioId) {
  console.log(`Processing account: ${module.Account}`);
  console.log(`Processing module: ${module.Name}`);

  const startyear = scenario.PeriodStart;
  const endyear = scenario.PeriodEnd;
  const yearsCount = endyear - startyear + 1;

  const inflationSeries = df_assumptions.column("Inflation").values;
  const periodStart = years[0];
  const inflationLen = inflationSeries.length;

  // Build FX rate array for non-USD currencies.
  //
  // CR051 F1 — fail loud on a missing/zero FX rate. A non-USD line divides by this rate below
  // (`incexpValues[i] / fxrates[i]`). If there is no `FX - <ccy>` assumption column, the old code
  // left the rate at 1.0 and silently booked the native amount as USD — ~4× too large for a PLN
  // line. If the column existed but held a 0 (a currency in use with no rate set for the year),
  // the division produced Infinity. Neither could fire before CR051, because no income/expense
  // line was ever non-USD; exposing the currency picker arms it. So a currency actually in use
  // with no usable rate is now a hard error, not a silent wrong number. (USD lines skip this block
  // entirely and keep fxrates = 1.)
  const fxrates = new Array(yearsCount).fill(1);
  if (module.Currency && module.Currency !== "USD") {
    const fxColumn =
      module.Currency === "PLN" ? categories[2] :
      module.Currency === "EUR" ? categories[3] : null;
    if (!fxColumn || !df_assumptions.columns.includes(fxColumn)) {
      throw new Error(
        `Income/expense "${module.Name}" is in ${module.Currency}, but scenario has no ` +
        `"${fxColumn || `FX - ${module.Currency}`}" assumption to convert it to USD.`
      );
    }
    const fxSeries = df_assumptions.column(fxColumn).values;
    for (let i = 0, year = startyear; year <= endyear; i++, year++) {
      const idx = year - periodStart;
      const rate = idx >= 0 && idx < fxSeries.length ? Number(fxSeries[idx]) : NaN;
      if (!Number.isFinite(rate) || rate <= 0) {
        throw new Error(
          `Income/expense "${module.Name}" (${module.Currency}) has no valid FX rate for ${year} ` +
          `(got ${rate}); set the "${fxColumn}" assumption for this scenario.`
        );
      }
      fxrates[i] = rate;
    }
  }

  const changeDValues = new Array(yearsCount).fill(0);
  const changePValues = new Array(yearsCount);
  const changeOValues = new Array(yearsCount).fill(0);
  const growth = module.Growth ?? 0;

  for (let i = 0, year = startyear; year <= endyear; i++, year++) {
    const idx = year - periodStart;
    changePValues[i] = idx >= 0 && idx < inflationLen ? inflationSeries[idx] * growth : 0;
  }

  if (Array.isArray(module.Changes)) {
    for (const entry of module.Changes) {
      if (!entry || !entry.Date || entry.Amount == null) continue;
      const year = new Date(entry.Date).getFullYear();
      const idx = year - startyear;
      if (idx >= 0 && idx < yearsCount) {
        if (entry.Flag[0] === "P") {
          changePValues[idx] = entry.Amount;
        } else if (entry.Flag[0] === "F") {
          changeDValues[idx] = entry.Amount;
        } else if (entry.Flag[0] === "O") {
          changeOValues[idx] = entry.Amount;
        }
      }
    }
  }

  const incexpValues = new Array(yearsCount);
  const baseValues = new Array(yearsCount);
  const taxValues = new Array(yearsCount).fill(0);
  const cashChange = new Array(yearsCount);

  // Calculate base and incexp values first, then apply deferred tax
  baseValues[0] = module.BaseValue * (1 + (changePValues[0] ?? 0) / 100) + (changeDValues[0] ?? 0);
  incexpValues[0] = baseValues[0] + (changeOValues[0] ?? 0);

  for (let i = 1; i < yearsCount; i++) {
    const year = startyear + i;
    const idx = year - periodStart;

    if (idx >= 0 && idx < inflationLen) {
      baseValues[i] = baseValues[i - 1] * (1 + changePValues[i] / 100) + changeDValues[i];
      incexpValues[i] = baseValues[i] + changeOValues[i];
    } else {
      baseValues[i] = 0;
      incexpValues[i] = 0;
    }
  }

  // Calculate tax values (deferred by one year — US tax is paid the year after the income)
  for (let i = 0; i < yearsCount; i++) {
    if (incexpValues[i] > 0) {
      const currentYearTax = -(incexpValues[i] * scenario.TaxRate) / 100;
      const targetIdx = i + 1 < yearsCount ? i + 1 : i;
      taxValues[targetIdx] += currentYearTax;
    }
  }

  // Convert LC to USD using FX rates
  const incexpValuesUSD = new Array(yearsCount);
  const taxValuesUSD = new Array(yearsCount);
  const cashChangeUSD = new Array(yearsCount);

  for (let i = 0; i < yearsCount; i++) {
    incexpValuesUSD[i] = incexpValues[i] / fxrates[i];
    taxValuesUSD[i] = taxValues[i] / fxrates[i];
    cashChangeUSD[i] = incexpValuesUSD[i] + taxValuesUSD[i];
  }

  // Clear and populate df_categories
  const dfCategoryValues = df_categories.values;
  for (let i = 0; i < dfCategoryValues.length; i++) {
    dfCategoryValues[i].fill(0);
  }

  let categoryRowIndex = df_categories.index.indexOf(module.Account);
  writeValuesToCategoryRow(categoryRowIndex, df_categories, incexpValuesUSD, startyear);

  if (module.Account === "Taxes") {
    for (let i = 0; i < taxValuesUSD.length; i++) {
      taxValuesUSD[i] += incexpValuesUSD[i];
    }
  }

  categoryRowIndex = df_categories.index.indexOf("Taxes");
  writeValuesToCategoryRow(categoryRowIndex, df_categories, taxValuesUSD, startyear);

  categoryRowIndex = df_categories.index.indexOf("Bank Accounts");
  writeValuesToCategoryRow(categoryRowIndex, df_categories, cashChangeUSD, startyear);

  return {
    moduleName: module?.Name,
    account: module?.Account,
    entries: buildFcEntriesPayload(df_categories, scenarioId, module?.Name, module?.Comment),
    audit: { dfCategories: df_categories },
  };
}

/**
 * Compatibility wrapper preserving the historical compute + audit-CSV + insert
 * flow in one call (tests and any external caller); index.js now stages these
 * itself via computeModule.
 */
async function processModule(module, scenario, df_assumptions, df_categories, categories, years, db, scenarioId) {
  const computed = computeModule(module, scenario, df_assumptions, df_categories, categories, years, scenarioId);
  writeEntriesAuditTrail(computed.audit.dfCategories, scenario?.Name, module?.Name);
  const inserted = await insertModuleEntries(db, computed.entries);
  return {
    moduleName: computed.moduleName,
    account: computed.account,
    entriesCount: inserted.length,
  };
}

module.exports = { processModule, computeModule, writeEntriesAuditTrail };
