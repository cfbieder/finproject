const fs = require("fs");
const path = require("path");
const { PATHS } = require("./constants");
const { LabelFrame } = require("./frame");
const { getIndexValues, buildFcEntriesPayload, insertModuleEntries } = require("./fcbuilder-common");
const { computeStreamSeries, applyStreamWindow, yearIndex } = require("./fcbuilder-stream");

const auditTrailDir = PATHS.AUDIT_TRAIL_DIR;
let auditTrailDirEnsured = false;

const ensureAuditTrailDir = () => {
  if (auditTrailDirEnsured) return;
  fs.mkdirSync(auditTrailDir, { recursive: true });
  auditTrailDirEnsured = true;
};

const sanitizeName = (value, fallback) => (value && String(value)) || fallback;

const writeValuesToCategoryRow = (rowIndex, dfCategories, valuesToWrite, startYear) => {
  if (rowIndex < 0) return false;
  let startColumnIndex = dfCategories.columns.indexOf(startYear);
  let valueOffset = 0;

  // If startYear is before the first column, offset into the values array
  if (startColumnIndex === -1) {
    const firstCol = dfCategories.columns[0];
    if (startYear < firstCol) {
      valueOffset = firstCol - startYear;
      startColumnIndex = 0;
    } else {
      return false;
    }
  }

  const rowValues = dfCategories.values[rowIndex];
  const columnsLength = dfCategories.columns.length;
  const valuesLength = valuesToWrite.length;

  for (let i = valueOffset; i < valuesLength; i++) {
    const columnIndex = startColumnIndex + (i - valueOffset);
    if (columnIndex >= columnsLength) break;
    rowValues[columnIndex] = valuesToWrite[i];
  }
  return true;
};

/** Add a series onto a frame row rather than overwriting it — two streams may share a line. */
const addValuesToCategoryRow = (rowIndex, dfCategories, valuesToWrite, startYear) => {
  if (rowIndex < 0) return false;
  const existing = dfCategories.values[rowIndex].slice();
  const merged = new Array(valuesToWrite.length);
  let startColumnIndex = dfCategories.columns.indexOf(startYear);
  let valueOffset = 0;
  if (startColumnIndex === -1) {
    const firstCol = dfCategories.columns[0];
    if (startYear < firstCol) {
      valueOffset = firstCol - startYear;
      startColumnIndex = 0;
    } else {
      return false;
    }
  }
  for (let i = 0; i < valuesToWrite.length; i++) merged[i] = valuesToWrite[i];
  for (let i = valueOffset; i < merged.length; i++) {
    const columnIndex = startColumnIndex + (i - valueOffset);
    if (columnIndex >= dfCategories.columns.length) break;
    merged[i] += existing[columnIndex];
  }
  return writeValuesToCategoryRow(rowIndex, dfCategories, merged, startYear);
};

const writeAuditTrail = (dfModuleLC, dfModuleUSD, dfCategories, scenario, module) => {
  ensureAuditTrailDir();
  const scenarioName = sanitizeName(scenario?.Name, "scenario").replace(/[^a-z0-9]/gi, "_");
  const moduleName = sanitizeName(module?.Name, "module").replace(/[^a-z0-9]/gi, "_");

  const writeCsvWithHeaders = (df, suffix) => {
    if (!df) return;
    const filePath = path.join(auditTrailDir, `${scenarioName}_${moduleName}_${suffix}.csv`);
    const columns = df.columns || [];
    const rows = df.values || [];
    const indexValues = getIndexValues(df);
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

  writeCsvWithHeaders(dfModuleLC, "LC");
  writeCsvWithHeaders(dfCategories, "entries");
  writeCsvWithHeaders(dfModuleUSD, "USD");
};

/**
 * Compute ONE module — PURE (no db, no fs). CR069 P2: this is now the only builder.
 *
 * A module is identity + OPTIONAL valuation + zero-or-more P&L streams. `has_valuation`
 * decides whether the balance path runs at all:
 *
 *   TRUE   a balance-sheet module, exactly as before — market value, growth, invest/dispose,
 *          realized/unrealized gains, transfers, the CR041 ownership gate.
 *   FALSE  a pure flow container: every converted Expenditure item. No valuation, no
 *          transfers, and the ownership gate does not apply — a stream with nothing behind it
 *          cannot be "not yet owned". That distinction is the whole reason
 *          `forecast_income_expense` had to be a separate table: CR041's gate reads a market
 *          value of 0 across the horizon as "never owned" and zeroes every amount stream.
 *
 * Everything a stream does now lives in fcbuilder-stream.js and is proved equivalent to the
 * three implementations it replaces by `__tests__/fcbuilder-stream.test.js`.
 */
function computeModule(module, scenario, df_assumptions, df_categories, categories, years, scenarioId) {
  console.log(`Processing module: ${module.Name}`);
  console.log(`Processing account: ${module.Account}`);

  const hasValuation = module.HasValuation !== false;

  // A flow module anchors at PeriodStart — which is precisely what fcbuilder-incexp did
  // (`const startyear = scenario.PeriodStart`), and why `forecast_income_expense.base_date`
  // was a column its own engine never read. A valuation module keeps its own base date,
  // because its VALUE series starts there. CR069 Decision 6 states the split as a rule:
  // valuation anchors at base_date, every stream anchors at the base year.
  const startyear = hasValuation
    ? new Date(module.BaseDate).getFullYear()
    : scenario.PeriodStart;
  const endyear = scenario.PeriodEnd;
  const yearsCount = endyear - startyear + 1;
  const yearsArr = new Array(yearsCount);

  for (let i = 0, year = startyear; year <= endyear; i++, year++) {
    yearsArr[i] = year;
  }

  const baseValues = new Array(yearsCount).fill(hasValuation ? (module.BaseValue ?? 0) : 0);
  const marketValues = new Array(yearsCount).fill(hasValuation ? (module.MarketValue ?? 0) : 0);
  const fxrates = new Array(yearsCount).fill(1);
  const investValues = new Array(yearsCount).fill(0);
  const disposeValues = new Array(yearsCount).fill(0);

  const inflationSeries = df_assumptions.column(categories[1]).values;
  const periodStart = years[0];
  const inflationLen = inflationSeries.length;

  // CR064 P13 — a module labelled USD whose local and USD value columns DISAGREE is
  // lying about one of them, and nothing downstream can tell which.
  //
  // The asymmetry is what makes this worth failing on. A wrong non-USD label is
  // self-announcing: the FX branch below fires, the value is divided by ~3.9, and the
  // balance sheet shows a number off by a factor the owner spots immediately. A wrong
  // USD label is SILENT — the branch never runs, `fxrates` keeps its `fill(1)`, and
  // `marketValues[i] / 1` posts the LOCAL amount to a USD balance sheet forever.
  //
  // Found in production: `PLN Credit Cards` carried market_value −24,542.66 (PLN) against
  // market_value_usd −6,832.01, with currency 'USD' inherited from the parent rollup
  // account — 18,250 of liability that does not exist, invisible for as long as nobody
  // divided one column by the other. Trivially satisfied by a flow module, whose value
  // columns are all zero.
  if ((module.Currency || "USD") === "USD") {
    const mvGap = Math.abs((module.MarketValue ?? 0) - (module.MarketValueUSD ?? 0));
    const bvGap = Math.abs((module.BaseValue ?? 0) - (module.BaseValueUSD ?? 0));
    if (mvGap > 0.01 || bvGap > 0.01) {
      throw new Error(
        `Module "${module.Name}" is marked USD but its local and USD values disagree ` +
        `(market ${module.MarketValue} vs ${module.MarketValueUSD}, ` +
        `base ${module.BaseValue} vs ${module.BaseValueUSD}). ` +
        `Set the module's currency to the one the values are actually in, or make the ` +
        `two columns match — the engine cannot convert a currency it is told is USD.`
      );
    }
  }

  // FX. The two halves behave differently and BOTH behaviours are preserved deliberately:
  //
  //   flow      FAILS LOUD on a missing or unusable rate. This is CR051 F1 — before it, a
  //             PLN expense line with no `FX - PLN` assumption silently booked the native
  //             amount as USD, ~4× too large, and a zero rate produced Infinity.
  //   valuation leaves the rate at 1 when the assumption column is absent, and carries the
  //             first rate backwards for pre-period years.
  //
  // Collapsing them onto the stricter rule would be an improvement and a BEHAVIOUR CHANGE,
  // which this CR's gate forbids; it is a candidate for a follow-up, not for a refactor whose
  // contract is "no number moves".
  if (module.Currency && module.Currency !== "USD") {
    const fxColumn =
      module.Currency === "PLN" ? categories[2] :
      module.Currency === "EUR" ? categories[3] : null;

    if (!hasValuation) {
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
    } else if (fxColumn && df_assumptions.columns.includes(fxColumn)) {
      const fxSeries = df_assumptions.column(fxColumn).values;
      const firstFxRate = fxSeries[0] || 1;
      for (let i = 0, year = startyear; year <= endyear; i++, year++) {
        const idx = year - periodStart;
        if (idx >= 0 && idx < fxSeries.length) {
          fxrates[i] = fxSeries[idx];
        } else if (idx < 0) {
          // Pre-period years: use first available FX rate
          fxrates[i] = firstFxRate;
        }
      }
    }
  }

  const growthPct = hasValuation ? (module.Growth ?? 0) : 0;
  const growthValues = new Array(yearsCount).fill(0);
  for (let i = 0, year = startyear; year <= endyear; i++, year++) {
    const idx = year - periodStart;
    growthValues[i] = idx >= 0 && idx < inflationLen ? growthPct * inflationSeries[idx] : 0;
  }

  const unrealizedGainValues = new Array(yearsCount).fill(0);
  const realizedGainValues = new Array(yearsCount).fill(0);

  // ── THE BALANCE PATH — valuation modules only ──────────────────────────────────────
  if (hasValuation) {
    // Investment transactions. Periodic entries expand from Date to DateEnd (or the horizon).
    if (Array.isArray(module.Invest)) {
      for (const entry of module.Invest) {
        if (!entry || !entry.Date || entry.Amount == null) continue;
        const startIdx = new Date(entry.Date).getFullYear() - startyear;
        if (entry.Flag === "Periodic") {
          const endYear = entry.DateEnd ? new Date(entry.DateEnd).getFullYear() : endyear;
          const endIdx = Math.min(endYear - startyear, yearsCount - 1);
          for (let j = Math.max(0, startIdx); j <= endIdx; j++) {
            investValues[j] += entry.Amount;
          }
        } else {
          if (startIdx >= 0 && startIdx < yearsCount) investValues[startIdx] = entry.Amount;
        }
      }
    }

    // Disposals, same expansion rules.
    if (Array.isArray(module.Dispose)) {
      for (const entry of module.Dispose) {
        if (!entry || !entry.Date || entry.Amount == null) continue;
        const startIdx = new Date(entry.Date).getFullYear() - startyear;
        if (entry.Flag === "Periodic") {
          const endYear = entry.DateEnd ? new Date(entry.DateEnd).getFullYear() : endyear;
          const endIdx = Math.min(endYear - startyear, yearsCount - 1);
          for (let j = Math.max(0, startIdx); j <= endIdx; j++) {
            disposeValues[j] += -entry.Amount;
          }
        } else if (entry.Flag !== "Full") {
          if (startIdx >= 0 && startIdx < yearsCount) disposeValues[startIdx] = -entry.Amount;
        }
      }
    }

    // Apply base year (idx 0) invest/dispose to starting values
    if (investValues[0] !== 0 || disposeValues[0] !== 0) {
      const origMarket = marketValues[0];
      const origBase = baseValues[0];
      // Cap dispose so market value cannot go negative
      const availableMarket = origMarket + investValues[0];
      if (disposeValues[0] < -availableMarket && availableMarket > 0) {
        disposeValues[0] = -availableMarket;
      } else if (availableMarket <= 0) {
        disposeValues[0] = 0;
      }
      const safeDisposeAdj = origMarket === 0 ? 0 : (disposeValues[0] * origBase) / origMarket;
      baseValues[0] = origBase + investValues[0] + safeDisposeAdj;
      marketValues[0] = origMarket + investValues[0] + disposeValues[0];
      realizedGainValues[0] = -disposeValues[0] + (origMarket === 0 ? 0 : (disposeValues[0] * origBase) / origMarket);
    }

    for (let i = 1; i < yearsCount; i++) {
      unrealizedGainValues[i] = marketValues[i - 1] * (growthValues[i] / 100);

      const prevMarket = marketValues[i - 1];
      const prevBase = baseValues[i - 1];

      // Cap dispose so market value cannot go negative
      const availableMarket = prevMarket + unrealizedGainValues[i] + investValues[i];
      if (disposeValues[i] < -availableMarket && availableMarket > 0) {
        disposeValues[i] = -availableMarket;
      } else if (availableMarket <= 0) {
        disposeValues[i] = 0;
      }

      const safeDisposeAdjustment = prevMarket === 0 ? 0 : (disposeValues[i] * prevBase) / prevMarket;

      baseValues[i] = prevBase + investValues[i] + safeDisposeAdjustment;
      marketValues[i] = prevMarket + unrealizedGainValues[i] + investValues[i] + disposeValues[i];
      realizedGainValues[i] = -disposeValues[i] + (prevMarket === 0 ? 0 : (disposeValues[i] * prevBase) / prevMarket);
    }
  }

  // CR041: ownership start — a module acquired mid-plan (base MV 0, value arriving via a
  // later Invest transfer) must not generate amount-based expense/income before acquisition.
  // Computed before Full disposals zero the series, so a same-year buy+dispose still
  // registers its acquisition year. 0 = owned from module start; -1 = never owned.
  //
  // CR069: a FLOW module is pinned to 0 (always "owned"). It has no acquisition to gate on,
  // and `findIndex` over an all-zero market value would return -1 — "never owned" — which
  // would zero every stream on it. Pinned by SKIPPING the gate, never by faking an
  // acquisition index, because index 0 is also the condition the base-year income tax below
  // keys on and a flow module must not acquire that tax.
  const baseOwned = (module.MarketValue ?? 0) !== 0;
  const acquisitionIdx = hasValuation ? (baseOwned ? 0 : marketValues.findIndex((v) => v !== 0)) : 0;

  // Handle "Full" disposals (valuation only — a flow module has nothing to dispose of)
  if (hasValuation && Array.isArray(module.Dispose)) {
    for (const entry of module.Dispose) {
      if (entry.Flag != "Full") continue;
      const idx = new Date(entry.Date).getFullYear() - startyear;
      if (idx >= 0 && idx < yearsCount) {
        // For base year (idx 0), use original module values as "previous"
        const prevMV = idx === 0 ? (module.MarketValue ?? 0) : marketValues[idx - 1];
        unrealizedGainValues[idx] = idx === 0 ? 0 : (marketValues[idx] - prevMV) / 2;
        disposeValues[idx] = -prevMV - unrealizedGainValues[idx];
        realizedGainValues[idx] = -disposeValues[idx] - baseValues[idx];
        baseValues[idx] = 0;
        marketValues[idx] = 0;
        for (let j = idx + 1; j < yearsCount; j++) {
          baseValues[j] = 0;
          marketValues[j] = 0;
          unrealizedGainValues[j] = 0;
          growthValues[j] = 0;
        }
      }
    }
  }

  // ── THE STREAMS ────────────────────────────────────────────────────────────────────
  //
  // One evaluator, one loop. What used to be ~180 lines of two near-parallel blocks (plus a
  // third file for inc/exp items) is a call per stream, because a stream is now a row rather
  // than a naming convention over column pairs.
  const loanRate = module.LoanRate != null ? Number(module.LoanRate) : null;
  const isLoan = loanRate != null && Number.isFinite(loanRate);
  const streams = Array.isArray(module.Streams) ? module.Streams : [];

  const streamCtx = {
    startyear, endyear, yearsCount, periodStart, inflationSeries, inflationLen,
    marketValues, baseMarketValue: module.MarketValue ?? 0, loanRate,
  };

  /** Per-stream computed series, in LC and signed, ready to post to its own line. */
  const computed = [];

  for (const stream of streams) {
    const series = computeStreamSeries(stream, streamCtx);
    const isDerived = (stream.mode || 'amount') === 'derived';
    const isAmountMode = (stream.mode || 'amount') === 'amount';

    // CR046 window. CR062: a loan's window is its own start/end dates expressed through the
    // balance path, so a window on top can only corrupt it — measured on the real builder, an
    // expense window on a loan turns 25,625…32,002 into a plausible-looking series that is
    // simply wrong. The backfill nulls those columns on a derived stream; this defends the
    // engine against a row that acquires them by any other path.
    const halvedByWindow = isDerived
      ? new Set()
      : applyStreamWindow(series, stream, startyear, yearsCount);

    // CR041 ownership gate — amount-driven streams on a VALUATION module only.
    //
    // MV-driven streams (yield, pct_of_value, a loan's interest) already scale with market
    // value: pre-purchase the average MV is 0 and the acquisition year averages to half, so
    // gating them would halve a year twice. A flow module is never gated at all.
    if (hasValuation && acquisitionIdx !== 0 && isAmountMode) {
      for (let i = 0; i < yearsCount; i++) {
        if (acquisitionIdx === -1 || i < acquisitionIdx) {
          series[i] = 0;
        } else if (i === acquisitionIdx && !halvedByWindow.has(i)) {
          // Don't halve a year the CR046 window already halved — that would leave 25%.
          series[i] /= 2;
        }
      }
    }

    // A Full disposal takes the streams with it: half in the sale year, nothing after.
    if (hasValuation && Array.isArray(module.Dispose)) {
      for (const entry of module.Dispose) {
        if (entry.Flag !== "Full") continue;
        const dispIdx = new Date(entry.Date).getFullYear() - startyear;
        if (dispIdx >= 0 && dispIdx < yearsCount) {
          if (dispIdx === 0) {
            // Base year disposal: base year stays as budget, zero all forecast years
            for (let j = 1; j < yearsCount; j++) series[j] = 0;
          } else {
            series[dispIdx] = series[dispIdx] / 2;
            for (let j = dispIdx + 1; j < yearsCount; j++) series[j] = 0;
          }
        }
      }
    }

    computed.push({ stream, series });
  }

  // ── TAX ────────────────────────────────────────────────────────────────────────────
  //
  // Two rates, because they are two different taxes (CR047):
  //  - gains  = tax_rate_override ?? scenario rate. A capital gain on disposal.
  //  - income = stream.tax_rate_override ?? tax_rate_override ?? scenario rate.
  //
  // The income override exists for income that arrives ALREADY TAXED elsewhere: United
  // Beverages' dividend is paid net of Polish tax, so the only incremental US tax on it is
  // ~3% — while a future sale of the business is still a normal capital gain at the full
  // rate. NULL falls back, so every existing module is byte-identical. 0 is a real rate
  // (income taxed at nothing), not "unset" — hence the `!= null` checks.
  const taxValues = new Array(yearsCount).fill(0);
  const scenarioRate = Number(scenario?.TaxRate ?? 0);
  const gainsRate = module.tax_rate_override != null ? Number(module.tax_rate_override) : scenarioRate;
  const gainsFactor = Number.isFinite(gainsRate) ? -gainsRate / 100 : 0;

  const streamIncomeFactor = (stream) => {
    const rate = stream.tax_rate_override != null
      ? Number(stream.tax_rate_override)
      : gainsRate;
    return Number.isFinite(rate) ? -rate / 100 : 0;
  };

  // Tax on the BASE YEAR's typed income, deferred to Period 1.
  //
  // This is the one place the two old builders genuinely diverged, and it is keyed on
  // `has_valuation` for exactly that reason: fcbuilder-module booked it whenever
  // `absIncomeAmount > 0 && acquisitionIdx === 0`, with NO yield-mode guard — so it fires on
  // an amount-mode module AND on the dead typed amounts of the three yield-mode ones
  // (CVC Fund VIII, Fidelity Stocks, Fidelity Fixed Income). fcbuilder-incexp had no such
  // block at all, taxing forecast years only. A converted flow item with positive income
  // (`Total Salary`, 3,786) must therefore NOT acquire it, or the gate fails.
  //
  // It is also why the backfill keeps a yield stream's typed amount instead of dropping it:
  // the amount is dead to the projection and live to this block.
  if (hasValuation && acquisitionIdx === 0) {
    for (const { stream } of computed) {
      if (stream.direction !== 'income') continue;
      const amount = Math.abs(parseFloat(stream.amount) || 0);
      if (!(amount > 0)) continue;
      const incomeFactor = streamIncomeFactor(stream);
      if (incomeFactor === 0) continue;

      // CR046: skipped when the income window has not opened by the base year — rent that
      // starts in 2030 earns nothing in the base year, so there is nothing to tax.
      const from = yearIndex(stream.start_date, startyear);
      const to = yearIndex(stream.end_date, startyear);
      const baseYearInWindow = (from == null || from <= 0) && (to == null || to >= 0);
      if (!baseYearInWindow) continue;

      const period1Idx = periodStart - startyear;
      if (period1Idx >= 0 && period1Idx < yearsCount) {
        // Tax what the base year actually EARNED: the full amount, halved when the window
        // opens or closes in the base year itself (the July-1 half year).
        const halvesBaseYear = from === 0 || to === 0;
        taxValues[period1Idx] += incomeFactor * amount * (halvesBaseYear ? 0.5 : 1);
      }
    }
  }

  // Tax deferred by one year — US tax is paid the year after the income or the gain.
  for (let i = 0; i < yearsCount; i++) {
    let currentYearTax = 0;
    if (gainsFactor !== 0 && realizedGainValues[i] > 0) {
      currentYearTax += gainsFactor * realizedGainValues[i];
    }
    for (const { stream, series } of computed) {
      if (stream.direction !== 'income') continue;
      if (series[i] > 0) currentYearTax += streamIncomeFactor(stream) * series[i];
    }
    if (currentYearTax !== 0) {
      const targetIdx = i + 1 < yearsCount ? i + 1 : i;
      taxValues[targetIdx] += currentYearTax;
    }
  }

  // ── FRAME ──────────────────────────────────────────────────────────────────────────

  // Convert LC to USD
  const toUSD = (series) => series.map((v, i) => v / (fxrates[i] || 1));
  const baseValuesUSD = baseValues.map((v, i) => v / (fxrates[i] || 1));
  const marketValuesUSD = marketValues.map((v, i) => v / (fxrates[i] || 1));
  const investValuesUSD = toUSD(investValues);
  const disposeValuesUSD = toUSD(disposeValues);
  const unrealizedGainValuesUSD = toUSD(unrealizedGainValues);
  const realizedGainValuesUSD = toUSD(realizedGainValues);
  const taxValuesUSD = toUSD(taxValues);

  if (hasValuation) {
    baseValuesUSD[0] = module.BaseValueUSD ?? 0;
    marketValuesUSD[0] = module.MarketValueUSD ?? 0;
    fxrates[0] = baseValuesUSD[0] !== 0 ? baseValues[0] / baseValuesUSD[0] : 1;
  }

  // Clear and populate df_categories
  const dfCategoryValues = df_categories.values;
  for (let i = 0; i < dfCategoryValues.length; i++) {
    dfCategoryValues[i].fill(0);
  }

  const transferValues = disposeValuesUSD.map((dispose, idx) => -dispose - investValuesUSD[idx]);

  if (hasValuation) {
    writeValuesToCategoryRow(
      df_categories.index.indexOf(module.Account), df_categories, marketValuesUSD, startyear
    );
    writeValuesToCategoryRow(
      df_categories.index.indexOf("Transfer - Bank"), df_categories, transferValues, startyear
    );
  }

  // Each stream posts to its OWN line — and ADDS rather than overwrites, because two streams
  // may legitimately share one (CR069 Decision 3: one category frame per module, so exactly
  // one entries row per module/account/year is ever written; the convergence loop's
  // `UPDATE … SET amount = amount + $1` would otherwise apply one delta to two rows).
  const streamsUSD = [];
  for (const { stream, series } of computed) {
    const usd = toUSD(series);
    streamsUSD.push({ stream, usd });
    const line = stream.lineName;
    if (!line) continue;   // no line = posts nowhere; see roadmap known issue (Sarasota)
    addValuesToCategoryRow(df_categories.index.indexOf(line), df_categories, usd, startyear);
  }

  // A flow item mapped to the Taxes line folds INTO the tax row rather than beside it — the
  // `module.Account === "Taxes"` special case fcbuilder-incexp carried. Keyed on the posting
  // line, which is what that comparison actually resolved to.
  const taxRowValues = taxValuesUSD.slice();
  if (!hasValuation) {
    for (const { stream, usd } of streamsUSD) {
      if (stream.lineName !== "Taxes") continue;
      for (let i = 0; i < taxRowValues.length; i++) taxRowValues[i] += usd[i];
    }
  }
  writeValuesToCategoryRow(df_categories.index.indexOf("Taxes"), df_categories, taxRowValues, startyear);

  // Cash: every stream, plus tax, plus the balance path's transfers.
  //
  // SUMMED IN THE OLD ORDER — income, then expense, then tax, then transfers — and that is
  // not fussiness. Floating-point addition is not associative, so reordering these terms
  // changes the last bits of the result. The engine then feeds that cash figure into the
  // sweep, whose band decides whether a year drains or deposits, and the income↔sweep
  // convergence loop iterates on the outcome with a $100 tolerance. A sub-cent difference at
  // the bottom is amplified by that feedback into hundreds of dollars: reordering this one
  // expression moved `2026 Downside` — the scenario that sits nearest the band — by up to
  // $25K on Fidelity Fixed Income, while the other four scenarios stayed byte-identical.
  //
  // The stream loop is ordered explicitly rather than relying on the loader's `ORDER BY
  // direction, id`, which sorts 'expense' before 'income' and would silently reintroduce it.
  const cashChange = new Array(yearsCount).fill(0);
  for (let i = 0; i < yearsCount; i++) {
    let sum = 0;
    for (const { stream, usd } of streamsUSD) if (stream.direction === 'income') sum += usd[i];
    for (const { stream, usd } of streamsUSD) if (stream.direction !== 'income') sum += usd[i];
    sum += taxValuesUSD[i];
    if (hasValuation) sum += transferValues[i];
    cashChange[i] = sum;
  }
  writeValuesToCategoryRow(df_categories.index.indexOf("Bank Accounts"), df_categories, cashChange, startyear);

  // ── AUDIT FRAMES ───────────────────────────────────────────────────────────────────
  const auditCols = {
    FX: fxrates, GrowthPct: growthValues,
    BaseValue: baseValues, MarketValue: marketValues,
    UnrealizedGain: unrealizedGainValues, RealizedGain: realizedGainValues,
    Invest: investValues, Dispose: disposeValues,
  };
  const auditColsUSD = {
    FX: fxrates, GrowthPct: growthValues,
    BaseValueUSD: baseValuesUSD, marketValuesUSD: marketValuesUSD,
    UnrealizedGain: unrealizedGainValuesUSD, RealizedGain: realizedGainValuesUSD,
    Invest: investValuesUSD, Dispose: disposeValuesUSD,
  };
  // One column per stream, labelled by its line — so the audit trail names what it posts to.
  // De-duplicated, since two streams may share a line and a frame cannot carry a repeated key.
  const usedLabels = new Set();
  for (const { stream, usd } of streamsUSD) {
    let label = stream.lineName || (stream.direction === 'income' ? 'Income' : 'Expense');
    while (usedLabels.has(label)) label += '_';
    usedLabels.add(label);
    const lc = computed.find((c) => c.stream === stream).series;
    auditCols[label] = lc;
    auditColsUSD[label] = usd;
  }
  auditCols.Tax = taxValues;
  auditColsUSD.Tax = taxValuesUSD;

  const df_module_LC = LabelFrame.fromColumns(auditCols, { index: yearsArr });
  const df_module_USD = LabelFrame.fromColumns(auditColsUSD, { index: yearsArr });

  return {
    moduleName: module?.Name,
    account: module?.Account,
    entries: buildFcEntriesPayload(df_categories, scenarioId, module?.Name, module?.Comment),
    audit: { dfModuleLC: df_module_LC, dfModuleUSD: df_module_USD, dfCategories: df_categories },
  };
}

/**
 * Compatibility wrapper preserving the historical compute + audit-CSV + insert
 * flow in one call (tests and any external caller); index.js now stages these
 * itself via computeModule.
 */
async function processModule(module, scenario, df_assumptions, df_categories, categories, years, db, scenarioId) {
  const computed = computeModule(module, scenario, df_assumptions, df_categories, categories, years, scenarioId);
  writeAuditTrail(computed.audit.dfModuleLC, computed.audit.dfModuleUSD, computed.audit.dfCategories, scenario, module);
  const inserted = await insertModuleEntries(db, computed.entries);
  return {
    moduleName: computed.moduleName,
    account: computed.account,
    entriesCount: inserted.length,
  };
}

module.exports = { processModule, computeModule, writeAuditTrail };
