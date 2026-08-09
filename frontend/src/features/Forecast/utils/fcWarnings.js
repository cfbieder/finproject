/**
 * fcWarnings.js — CR045 Phase 1.
 *
 * Derives cash-health warnings for a generated forecast scenario.
 *
 * Why this exists: the engine already knew. When a scenario has no ranked sweep
 * module the sweep cannot fund a shortfall, so it writes a `Cash Shortfall` entry
 * and lets the bank balance run negative — and until now nothing in the UI said so.
 * A scenario that was $20M wrong looked exactly like one that was right (CR045 §1).
 *
 * Pure: every input is already loaded by FCReview. No fetch, no engine change.
 */

/** Below this (in dollars) a balance counts as zero — engine amounts carry cents. */
const EPSILON = 1;

const SHORTFALL_ACCOUNT = "Cash Shortfall";

/**
 * @param {Object} params
 * @param {Array<number|string>} params.years - forecast years, in display order
 * @param {Array<number>} params.bankBalanceByYear - running Bank Accounts balance, aligned to `years`
 * @param {Array<Object>} params.entries - raw engine entries { Year, Account, Amount, Module }
 * @param {Array<Object>} params.modules - scenario modules { Name, Account, CashSweepPriority }
 * @param {number|null} params.cashSweepLow - the scenario's low band, or null if unknown
 * @returns {Array<Object>} warnings, most severe first
 *   { id, severity: 'error'|'warning', title, detail, years: number[], amount: number|null }
 */
export function computeForecastWarnings({
  years = [],
  bankBalanceByYear = [],
  entries = [],
  modules = [],
  cashSweepLow = null,
  // CR075 — the scenario's real PeriodStart. `years[0]` is NOT it: FCReview unshifts
  // PeriodStart−1 AND PeriodStart−2 onto the display years, so years[0] is PeriodStart−2.
  // R7 was comparing disposal dates against that and silently under-reported — 20 disposals
  // dated in the budget year, across all five prod scenarios, which the engine never executes.
  // Falls back to the old value when a caller does not supply it, so nothing gets worse.
  periodStart = null,
  // CR075 — `{ [fcLineName]: amount }` for the BUDGET year, the same map the Review's year −1
  // column renders. Needed so a module implying base-year money with no budget behind it can be
  // reported rather than reading as a real zero.
  baseYearValues = null,
} = {}) {
  const warnings = [];
  if (!years.length) return warnings;

  const rankedModules = modules
    .filter((m) => m.CashSweepPriority != null && m.CashSweepPriority !== "")
    .map((m) => ({ ...m, rank: Number(m.CashSweepPriority) }))
    .sort((a, b) => a.rank - b.rank);

  // ---- W3: no sweep module configured -------------------------------------
  // The CR045 §1 root cause. Checked first: every other cash warning is
  // downstream of it, so naming it is what actually gets the user unstuck.
  if (modules.length > 0 && !rankedModules.some((m) => m.rank === 1)) {
    warnings.push({
      id: "no-sweep-module",
      severity: "error",
      title: "No cash-sweep module configured",
      detail:
        "No module in this scenario has sweep priority 1, so the forecast cannot move " +
        "cash in or out of your assets: excess cash is stranded and shortfalls are left " +
        "unfunded, driving the bank balance negative. Set a sweep priority on the Modules page.",
      years: [],
      amount: null,
    });
  }

  // ---- W2: unfunded shortfall ---------------------------------------------
  const shortfallByYear = new Map();
  for (const e of entries) {
    if (e.Account !== SHORTFALL_ACCOUNT) continue;
    const amt = Number(e.Amount) || 0;
    if (Math.abs(amt) <= EPSILON) continue;
    const year = Number(e.Year);
    shortfallByYear.set(year, (shortfallByYear.get(year) || 0) + amt);
  }
  if (shortfallByYear.size > 0) {
    const shortYears = [...shortfallByYear.keys()].sort((a, b) => a - b);
    // CR076 §3 — the shortfall is CUMULATIVE, so it must NOT be summed.
    //
    // `cash-sweep.js` declares `runningCash` once OUTSIDE the year loop and the shortfall entry
    // never adds back to it, so each year's row is `cashSweepLow − runningCash` on a balance that
    // already carries every prior unfunded year. Summing counts the same dollars once per year:
    // prod SRQ stored 2061 −169,573.32 and 2062 −1,017,119.05, and this rule reported $1.2M —
    // but 2062's figure ALREADY contains 2061's gap. The true terminal shortfall is 1,017,119.
    //
    // The worst year is therefore the honest headline, and for a monotonically deepening hole it
    // is also the last one. `Math.min` because the entries are stored negative.
    const worst = Math.min(...shortfallByYear.values());
    warnings.push({
      id: "unfunded-shortfall",
      severity: "error",
      title: "Cash shortfall the forecast could not fund",
      detail:
        "The sweep ran out of assets to sell: it could not raise enough cash to hold the " +
        "low band. This figure is the WORST year's gap to the band, not a total — each year's " +
        "shortfall already carries the years before it. Rank another module for the sweep to " +
        "draw on, or schedule a disposal.",
      years: shortYears,
      amount: worst,
    });
  }

  // ---- W1: cash goes negative ---------------------------------------------
  const negativeYears = [];
  let worstNegative = 0;
  years.forEach((year, i) => {
    const bal = Number(bankBalanceByYear[i]);
    if (!Number.isFinite(bal) || bal >= -EPSILON) return;
    negativeYears.push(Number(year));
    if (bal < worstNegative) worstNegative = bal;
  });
  if (negativeYears.length > 0) {
    warnings.push({
      id: "negative-cash",
      severity: "error",
      title: "Bank balance goes below zero",
      detail:
        "A negative cash balance is not a real outcome — the money has to come from " +
        "somewhere. Treat these years as unfunded, not as a plan.",
      years: negativeYears,
      amount: worstNegative,
    });
  }

  // ---- W4: cash below the low band (breached but still positive) -----------
  if (Number.isFinite(Number(cashSweepLow)) && Number(cashSweepLow) > 0) {
    const low = Number(cashSweepLow);
    const negativeSet = new Set(negativeYears);
    const belowYears = [];
    years.forEach((year, i) => {
      const bal = Number(bankBalanceByYear[i]);
      if (!Number.isFinite(bal)) return;
      if (negativeSet.has(Number(year))) return; // already reported as negative
      if (bal < low - EPSILON) belowYears.push(Number(year));
    });
    if (belowYears.length > 0) {
      warnings.push({
        id: "below-low-band",
        severity: "warning",
        title: "Cash below the sweep low band",
        detail:
          `The bank balance drops under the ${formatMoney(low)} low band in these years. ` +
          "Cash is still positive, but the sweep could not top it back up to target.",
        years: belowYears,
        amount: low,
      });
    }
  }

  // ---- W5 / W6: sweep sources drained -------------------------------------
  // An account's balance in a year is the sum of every engine entry against it
  // (the module builder's market value, plus the sweep's withdrawals and the
  // prior-years carry-forward) — the same sum the balance sheet row displays.
  const balanceByAccountYear = new Map();
  for (const e of entries) {
    const account = e.Account;
    if (!account || account === SHORTFALL_ACCOUNT) continue;
    if (!balanceByAccountYear.has(account)) balanceByAccountYear.set(account, new Map());
    const byYear = balanceByAccountYear.get(account);
    const year = Number(e.Year);
    byYear.set(year, (byYear.get(year) || 0) + (Number(e.Amount) || 0));
  }

  const exhausted = [];
  const overDrained = [];
  for (const mod of rankedModules) {
    const byYear = balanceByAccountYear.get(mod.Account);
    if (!byYear) continue;

    let hadBalance = false;
    let firstEmptyYear = null;
    let mostNegative = 0;
    let firstNegativeYear = null;

    for (const year of years.map(Number)) {
      const bal = byYear.get(year);
      if (bal == null) continue;
      if (bal > EPSILON) {
        hadBalance = true;
        continue;
      }
      if (hadBalance && firstEmptyYear == null) firstEmptyYear = year;
      if (bal < -EPSILON) {
        if (firstNegativeYear == null) firstNegativeYear = year;
        if (bal < mostNegative) mostNegative = bal;
      }
    }

    if (firstEmptyYear != null) {
      exhausted.push({ name: mod.Name, rank: mod.rank, year: firstEmptyYear });
    }
    if (firstNegativeYear != null) {
      overDrained.push({ name: mod.Name, year: firstNegativeYear, amount: mostNegative });
    }
  }

  if (exhausted.length > 0) {
    warnings.push({
      id: "sweep-source-exhausted",
      severity: "warning",
      title: "Sweep source fully drained",
      detail:
        exhausted
          .map((m) => `${m.name} (priority ${m.rank}) is drained to zero by ${m.year}`)
          .join("; ") +
        ". Once every ranked module is empty the sweep has nothing left to sell.",
      years: exhausted.map((m) => m.year).sort((a, b) => a - b),
      amount: null,
    });
  }

  if (overDrained.length > 0) {
    warnings.push({
      id: "module-over-drained",
      severity: "warning",
      title: "Sweep drew a module below zero",
      detail:
        overDrained
          .map((m) => `${m.name} ends at ${formatMoney(m.amount)} from ${m.year}`)
          .join("; ") +
        ". The sweep withdrew more than the module was later worth — the balance shown is not real.",
      years: overDrained.map((m) => m.year).sort((a, b) => a - b),
      amount: overDrained.reduce((worst, m) => Math.min(worst, m.amount), 0),
    });
  }

  warnings.push(...computeLoanWarnings(modules));
  warnings.push(...computeModuleIntegrityWarnings(modules, {
    periodStart: periodStart ?? years[0],
    baseYearValues,
  }));

  // CR077 — "idle cash is unpriced" was DROPPED as a rule, deliberately.
  //
  // It was written, and it fired on every scenario that has a sweep — which is all of them,
  // always, forever. A rule that cannot NOT fire carries no information: it is documentation
  // wearing a warning's clothes, and it is exactly the noise CR074 was built to remove. It also
  // permanently suppressed the all-clear, since that is gated on `warnings.length === 0`.
  //
  // The underlying point is real (the sweep sells a return-earning asset to hold a 0% balance,
  // and a shortfall costs nothing either), so it stays where it belongs: a decision in
  // CR076 §7 Q1, not a row the owner dismisses once per scenario and never thinks about again.
  //
  // The test for a new advisory: could this be absent on a plausible plan? If not, it is not a
  // finding.

  return warnings.map(classifyWarning);
}

/**
 * CR077 — is this a DEFECT or a JUDGEMENT?
 *
 * The panel had grown to mix two kinds of statement under one heading and one severity scale:
 * *"`Business Loan` is configured but excluded"* (the model is not doing what the data says) sat
 * beside *"`CVC Fund IX` both pays a yield and returns capital"* (a question only the owner can
 * answer). They demand different things — a defect is FIXED, a judgement is RECORDED — so mixing
 * them means re-triaging the same calls on every render, which is what CR074's dismissals exist
 * to relieve.
 *
 * Classified centrally rather than at each `push` site, so a new rule cannot silently default
 * into the wrong tab by omission: an unlisted id is INTEGRITY, the louder of the two, and a rule
 * that belongs in advice has to say so here.
 *
 * The test is not severity. It is: **if this is true, is something wrong — or is something
 * merely worth deciding?**
 */
const ADVISORY_PREFIXES = [
  "disposal-in-base-year-",            // the sale executes; this explains WHERE the money went
  "disposal-no-gain-",                 // is the cost basis a placeholder? only the owner knows
  "yield-and-dispose-",                // is the growth rate net of distributions? owner's call
  "foreign-income-no-tax-override-",   // which rate really applies to already-taxed income
  "growth-multiplier-outlier-",        // a deliberate write-off looks identical to a typo
  "escalation-below-inflation-",       // CR077 — a real-terms erosion the owner may have chosen
];

export function classifyWarning(w) {
  if (!w || typeof w.id !== "string") return w;
  const advisory = ADVISORY_PREFIXES.some((p) => w.id.startsWith(p));
  return { ...w, kind: advisory ? "advisory" : "integrity" };
}

/**
 * CR071 — where the forecast's numbers disagree with the owner's intent.
 *
 * Every rule here reports a *valid* configuration that the engine models faithfully and that the
 * owner probably did not mean. None of them corrects anything: Fin must not silently change a
 * figure the owner may have chosen (CR058's calibration modes and CR051's fail-loud 400 are the
 * precedents). A warning cannot hide a value, which is why this file is the right home and the
 * form is not.
 *
 * The rules are keyed on DATA, never on `module_type` — the same discipline `computeLoanWarnings`
 * uses, and for the same reason: the type is a free-text list the owner edits.
 *
 * `periodStart` is the first FORECAST year — the scenario's own PeriodStart, NOT `years[0]`,
 * which is PeriodStart−2 once the actual and budget columns are unshifted on. A date before it is
 * not in the plan.
 */
export function computeModuleIntegrityWarnings(modules = [], { periodStart = null, baseYearValues = null } = {}) {
  const out = [];
  const num = (v) => (v == null || v === "" ? null : Number(v));

  for (const mod of modules) {
    if (!mod) continue;
    const name = mod.Name || "(unnamed)";
    const streams = Array.isArray(mod.Streams) ? mod.Streams : [];
    const hasValuation = mod.HasValuation !== false;

    // ---- A1 (CR077): a flow that loses ground to inflation, deliberately or not ----
    //
    // `growth_mult` is a MULTIPLIER of inflation, so anything below 1 shrinks in real terms —
    // and the form's hint said the OPPOSITE of that until v3.21.0 (CR076 §11), while **70 of
    // 110** streams carry an explicit multiplier and most are below 1.
    //
    // This is advice, not a defect: a household may genuinely intend to spend less in real terms
    // with age, and `Social Security` at 0.25 turned out to be worth changing while `Healthcare`
    // at 1.1 and `Tax` at 0 were deliberate. The rule states the consequence and lets the owner
    // decide — which is the whole point of the advisory tab.
    //
    // Direction changes what it means, so it changes the sentence: an income below inflation is
    // a risk the owner carries; an expense below inflation makes the PLAN LOOK BETTER, which is
    // the more dangerous of the two because nothing else on the page flags optimism.
    for (const st of streams) {
      const mult = num(st?.growth_mult);
      if (mult == null || mult >= 1) continue;
      const isIncome = st?.direction === "income";
      const line = st?.fc_line_name || st?.lineName || null;
      const label = line ? `"${name}" → ${line}` : `"${name}"`;
      const pctOfInflation = Math.round(mult * 100);
      out.push({
        id: `escalation-below-inflation-${name}-${st?.direction || "?"}-${st?.id ?? "new"}`,
        severity: "info",
        title: isIncome
          ? `${label} rises at ${mult}× inflation, so it buys less every year`
          : `${label} rises at ${mult}× inflation, so the plan assumes it gets cheaper in real terms`,
        detail: isIncome
          ? `This income keeps only ${pctOfInflation}% of inflation, so its purchasing power falls ` +
            "every year of the plan. That is right only if you expect the payment itself to be " +
            "eroded — an indexed or contractual income should sit at 1."
          : `This cost keeps only ${pctOfInflation}% of inflation, so the plan assumes it shrinks ` +
            "in real terms year after year. That may be deliberate — spending often falls with " +
            "age — but it makes the forecast LOOK BETTER, and nothing else on this page says so. " +
            "A cost that simply tracks prices should sit at 1.",
        years: [],
        amount: null,
      });
    }

    // ---- R10: a growth MULTIPLIER that looks like a typed percentage -------
    //
    // CR076 §5 — `growth_rate` is a multiplier OF INFLATION, not a rate: the engine computes
    // `growthPct × inflation` (`fcbuilder-common.js: growthPctForYear`). So 0.8 means 0.8 ×
    // inflation, and −20 means −20 × inflation — which at a 2.5% assumption is −50% a year.
    //
    // `OCME Sp. z o.o.` carries exactly that in all five prod scenarios and decays from 56,500
    // PLN to 113 by 2032. Nothing flagged it: every OTHER module on prod sits in [−1, 1.5], so
    // it is a 13× outlier, and the only plausible reading is a PERCENTAGE typed into a
    // multiplier box.
    //
    // The threshold is set well clear of real data rather than at a round number — 1.5 is the
    // largest legitimate value in use (the CVC funds), so 5 cannot fire on anything the owner
    // has actually chosen while still catching a two-digit typo.
    const growthMult = num(mod.Growth);
    if (hasValuation && growthMult != null && Math.abs(growthMult) >= 5) {
      out.push({
        id: `growth-multiplier-outlier-${name}`,
        severity: "warning",
        title: `"${name}" grows at ${growthMult}× inflation — check this is a multiplier, not a percent`,
        detail:
          `This field is a MULTIPLIER of inflation, not a rate, so the engine applies ` +
          `${growthMult} × inflation every year. If you meant ${growthMult}% a year, the value ` +
          `here should be ${growthMult} divided by the inflation assumption instead. Every other ` +
          `module in this plan sits between −1 and 1.5.`,
        years: [],
        amount: null,
      });
    }

    // ---- R3: the type says loan, the data says not-loan -------------------
    // The sharpest rule in the CR, because the guard that would otherwise catch it is switched
    // off by the very condition that causes it: `computeLoanWarnings` returns early on
    // `LoanInterestRate == null`, which is exactly the state being reported here. Prod carried
    // `House Morgage` in this state in all five scenarios — 500,000 of principal, 19 amortization
    // rows, secured, and no interest rate, so the engine booked no debt at all.
    const looksLoan =
      String(mod.Type || "").trim().toLowerCase() === "loan" ||
      num(mod.LoanPrincipal) ||
      (Array.isArray(mod.Amortization) && mod.Amortization.length > 0) ||
      mod.SecuredAssetModuleId != null;
    if (looksLoan && mod.LoanInterestRate == null) {
      out.push({
        id: `type-data-loan-${name}`,
        severity: "error",
        title: `"${name}" is set up as a loan but has no interest rate`,
        detail:
          "The engine decides what a loan is from the interest rate, not the type — so with no " +
          "rate this module books no debt, no interest and no principal repayment. Everything " +
          "else about it (amount, years, schedule, security) is being ignored.",
        years: [],
        amount: num(mod.LoanPrincipal) ? -Math.abs(num(mod.LoanPrincipal)) : null,
      });
    }

    // ---- R8: configured, and excluded from the forecast --------------------
    // `setup_status` in ('new','exclude') removes a module from generation at four query sites,
    // and nothing on the modules table distinguishes "configured and excluded" from "configured
    // and live". Only fires when the module carries something worth generating, so a genuinely
    // blank draft stays quiet.
    const status = String(mod.SetupStatus || "new").toLowerCase();
    const carriesSomething =
      streams.length > 0 ||
      num(mod.MarketValue) ||
      num(mod.LoanPrincipal) ||
      (mod.DisposeCount ?? 0) > 0;
    if ((status === "new" || status === "exclude") && carriesSomething) {
      out.push({
        id: `configured-but-excluded-${name}`,
        severity: "info",
        title: `"${name}" is configured but excluded from the forecast`,
        detail:
          `Its status is "${status}", so nothing it holds reaches the projection. That may be ` +
          "deliberate — a module parked until a decision is made — but nothing else on the page " +
          "says so.",
        years: [],
        amount: null,
        dismissible: true,
      });
    }

    // ---- R6: a flow with no P&L line --------------------------------------
    // Cash moves and no line records it. CR069 §13 found four of these on prod; `Sarasota House`
    // alone is -45,000/yr for 21 years sitting outside every P&L breakdown.
    for (const st of streams) {
      if (st?.fc_line_id == null) {
        out.push({
          id: `stream-no-line-${name}-${st?.direction || "?"}-${st?.id ?? "new"}`,
          severity: "warning",
          title: `"${name}" has ${st?.direction === "income" ? "income" : "an expense"} with no P&L line`,
          detail:
            "The cash moves, but nothing books it to a line — so it is invisible to every P&L " +
            "breakdown and to the FC-line reports, while still changing the bank balance.",
          years: [],
          amount: num(st?.amount) ? -Math.abs(num(st.amount)) : null,
        });
      }
    }

    // ---- R1: income already taxed at source, taxed again -------------------
    // Only for a stream in a currency the module does not report in — that is the shape where
    // tax was almost certainly withheld abroad. United Beverages' dividend is net of Polish tax
    // (the project's own note says so) and is taxed again at the scenario rate here.
    const foreignCurrency = mod.Currency && String(mod.Currency).toUpperCase() !== "USD";
    for (const st of streams) {
      if (st?.direction !== "income") continue;
      if (!foreignCurrency) continue;
      if (st?.tax_rate_override != null) continue;
      out.push({
        id: `foreign-income-no-tax-override-${name}-${st?.id ?? "new"}`,
        severity: "warning",
        title: `"${name}" income is taxed at the full rate, in ${mod.Currency}`,
        detail:
          "Income earned abroad is often already taxed at source, and this stream carries no tax " +
          "override — so the scenario's full rate is applied on top. If it arrives net, set the " +
          "incremental rate on the stream instead.",
        years: [],
        amount: null,
      });
    }

    // ---- R5: cost basis equals market value AT THE BASE DATE ---------------
    //
    // This rule used to claim the sale "realizes no gain and pays no tax", on the reasoning that
    // the gain is `dispose × (1 − basis/market)` and so vanishes while the two are equal. That
    // reasoning read the equality at the BASE DATE and the engine reads it at the DISPOSAL YEAR.
    //
    // The basis is flat — nothing but an Invest moves it — while the market value compounds at
    // the module's growth every year. So by the time a disposal lands the two have separated, and
    // the engine's Full-disposal branch books `market(disposal) − basis` (fcbuilder-module.js).
    // Barkeria: 1,339,163 − 1,004,870 = **334,293** realized in 2040, on a module this rule was
    // calling gain-free. Measured on prod, the old wording was wrong on **30 of the 35 modules it
    // fired on** — 25 that grow, and 5 that SHRINK and therefore realize a loss.
    //
    // The equality is still worth reporting: a basis identical to market value on the base date is
    // usually a placeholder typed from today's value rather than the real purchase price, and then
    // the gain since PURCHASE is understated however the module grows. So the finding stays and
    // only the claim changes — to one that matches what the engine will actually do.
    const basis = num(mod.BaseValue);
    const market = num(mod.MarketValue);
    const growth = num(mod.GrowthRate);
    if (
      hasValuation &&
      (mod.DisposeFullCount ?? 0) > 0 &&
      basis != null && market != null && market !== 0 &&
      Math.abs(basis - market) < 0.005 &&
      market > 0   // a liability's basis equals its balance by construction; that is not a finding
    ) {
      const flat = growth == null || growth === 0;
      const shrinking = growth != null && growth < 0;
      out.push({
        id: `disposal-no-gain-${name}`,
        severity: "warning",
        title: flat
          ? `"${name}" is sold without realizing any gain`
          : shrinking
            ? `"${name}" is sold at a loss against its cost basis`
            : `"${name}" is taxed only on growth since the base date`,
        detail: flat
          ? `Cost basis and market value are both ${formatMoney(market)} and the module does not ` +
            "grow, so the sale realizes no gain and pays no tax. If the basis is a placeholder " +
            "rather than the real purchase price, the plan is understating the tax on this sale."
          : shrinking
            ? `Cost basis and market value are both ${formatMoney(market)} at the base date, but ` +
              "the module shrinks from there — so the disposal books a capital LOSS against the " +
              "basis. The engine does NOT apply that loss against any gain: no tax is reduced " +
              "anywhere by this sale. If the basis is a placeholder rather than the real purchase " +
              "price, that loss is wrong."
            : `Cost basis and market value are both ${formatMoney(market)} at the base date, so ` +
              "the sale is taxed on the growth since then and on nothing before it. That is right " +
              "only if the asset was acquired at today's value; if the basis is a placeholder " +
              "rather than the real purchase price, the plan is understating the gain.",
        years: [],
        amount: null,
      });
    }

    // ---- R9: base-year money the BUDGET does not carry (CR075) --------------
    //
    // Year −1 is the budget now, and the budget is the only source: a module's typed amounts no
    // longer contribute to it (they understated the base year by 152,802 on prod, and that
    // figure is the cash sweep's opening cash). The owner chose budget-only with no derived
    // fallback, on 2026-08-07, because a derived figure sitting beside a budgeted one
    // double-counts the moment a line is partly budgeted and cannot be told apart on screen.
    //
    // The cost of that choice is that an unbudgeted cost reads as a real zero. This rule is what
    // pays it: if a module says it earns or spends on a line in the base year and the budget
    // carries nothing there, say so. A gap the owner can see is a budgeting decision; a gap they
    // cannot is the CR049 §1 failure mode again.
    //
    // Skipped entirely when `baseYearValues` was not supplied — absent is not the same as empty,
    // and warning on every module because a fetch failed is worse than not warning.
    if (baseYearValues && typeof baseYearValues === "object") {
      const budgeted = (line) => Math.abs(Number(baseYearValues[line] ?? 0)) > 0.005;
      const unbudgeted = [];
      for (const st of streams) {
        const line = st?.fc_line_name;
        if (!line) continue;                       // no line at all is R6's finding, not this one
        // A stream produces base-year money when it carries an amount, or when its rate has
        // something to work on — a yield on a real balance is exactly the case that used to
        // vanish, so it must not be skipped here for carrying `amount = 0`.
        const drives = Math.abs(num(st.amount) ?? 0) > 0
          || (st.mode === "yield" && Math.abs(num(mod.MarketValue) ?? 0) > 0);
        if (drives && !budgeted(line)) unbudgeted.push(line);
      }
      // A loan's interest is derived, never typed, so it has no amount to test — its balance and
      // rate are what say it will charge. This is the case the old code special-cased.
      if (num(mod.LoanInterestRate) && Math.abs(num(mod.MarketValue) ?? 0) > 0) {
        for (const st of streams) {
          if (st?.mode === "derived" && st?.fc_line_name && !budgeted(st.fc_line_name)) {
            unbudgeted.push(st.fc_line_name);
          }
        }
      }
      const lines = [...new Set(unbudgeted)];
      if (lines.length > 0) {
        out.push({
          id: `unbudgeted-base-year-${name}`,
          severity: "warning",
          title: `"${name}" earns or spends in the budget year, but the budget has nothing on ${lines.length === 1 ? "its line" : "those lines"}`,
          detail:
            `Nothing is budgeted for ${lines.map((l) => `"${l}"`).join(", ")}${periodStart ? ` in ${periodStart - 1}` : ""}. ` +
            "The budget year is taken from the budget alone, so this module contributes nothing " +
            "to it — and that figure is also the cash sweep's opening cash. Budget the line, or " +
            "accept that the plan starts without it.",
          years: [],
          amount: null,
        });
      }
    }

    // ---- R7: a disposal dated in the BASE year -----------------------------
    //
    // CR076 §3 — this rule was WRONG, twice over, and fired on 20 prod rows saying so.
    //
    // It claimed a disposal dated before PeriodStart "never happens — the balance it was meant to
    // clear stays on the books for the whole plan." The engine indexes a disposal against the
    // MODULE'S OWN base year (`fcbuilder-module.js`: `new Date(entry.Date).getFullYear() -
    // startyear`, where `startyear` is the module's `base_date`), NOT against PeriodStart. Every
    // affected module has a 2025 base date, so a 2026 disposal is index 1 — inside the array, and
    // executed. Prod showed `US - Nokomis` booking 394,875 of proceeds with NO balance row left.
    //
    // CR075 §5 fixed this rule's INPUT (it was being handed PeriodStart−2) and took the panel from
    // 13 issues to 17. Nobody then checked whether its SENTENCE was true. It was not.
    //
    // What is actually true and worth saying: a base-year disposal executes, but its proceeds land
    // in the plan's OPENING CASH rather than in any forecast year, and its CGT falls the year
    // after — so it is invisible in the forecast columns. That is worth an `info`, not a warning.
    //
    // The original claim only holds when the disposal predates the module's own base date, which
    // is what `< periodStart - 1` approximates (0 such rows on prod).
    const disposeYear = mod.DisposeFirstYear != null ? Number(mod.DisposeFirstYear) : null;
    const baseYear = periodStart != null ? Number(periodStart) - 1 : null;
    if (periodStart != null && (mod.DisposeCount ?? 0) > 0 && disposeYear != null) {
      if (disposeYear < baseYear) {
        out.push({
          id: `disposal-before-start-${name}`,
          severity: "warning",
          title: `"${name}" disposes in ${disposeYear}, before the plan's base year`,
          detail:
            `The base year is ${baseYear}, so a disposal dated ${disposeYear} falls outside every ` +
            "column the engine builds — the balance it was meant to clear stays on the books for " +
            "the whole plan.",
          years: [],
          amount: null,
        });
      } else if (disposeYear === baseYear) {
        out.push({
          id: `disposal-in-base-year-${name}`,
          severity: "info",
          title: `"${name}" is sold in the base year ${disposeYear}`,
          detail:
            `The sale executes: the balance is cleared in the ${baseYear} column and the proceeds ` +
            `land in the plan's opening cash, not in any forecast year. Any capital-gains tax ` +
            `falls in ${baseYear + 1}.`,
          years: [],
          amount: null,
        });
      }
    }

    // ---- CVC: distributing twice, and the form cannot say which is meant ----
    // A yield pays out of the holding while a Dispose schedule returns capital from it. Both at
    // once is coherent ONLY if the growth rate is net of the distributions; if it is gross, one
    // of the two is counted twice. This reports the ambiguity — it does NOT guess which, because
    // the answer changes forecast numbers and is the owner's to give.
    const hasYield = streams.some((st) => (st?.mode || "") === "yield");
    if (hasValuation && hasYield && (mod.DisposeCount ?? 0) > 0) {
      out.push({
        id: `yield-and-dispose-${name}`,
        severity: "info",
        title: `"${name}" both pays a yield and returns capital on a schedule`,
        detail:
          "It distributes twice: a yield out of the holding, and scheduled disposals of it. That " +
          "is right only if the growth rate is already net of those distributions — otherwise one " +
          "of the two is being counted twice.",
        years: [],
        amount: null,
        dismissible: true,
      });
    }
  }

  // CR077 — classify HERE too, not only in `computeForecastWarnings`. Every exported producer
  // returns classified warnings, so no consumer can receive one without a `kind` and quietly
  // route it to the wrong tab.
  return out.map(classifyWarning);
}

/**
 * CR062 — loan configuration warnings, derived here rather than transported from
 * the engine. `deriveLoanSchedule` produces the same findings during a build (and
 * logs them), but there is no channel from the engine to this component; the
 * modules payload already carries `Loan*` and `Amortization`, so the rules that
 * depend only on configuration are re-derived from that.
 *
 * Deliberately NOT re-implemented here: the repayment-CAP warning, which needs the
 * realised balance path. It is over-scheduling that causes it, and over-scheduling
 * is visible from the percentages alone — so the owner still gets told, one step
 * earlier in the causal chain.
 */
export function computeLoanWarnings(modules = []) {
  const out = [];
  const yearOf = (d) => (d ? Number(String(d).slice(0, 4)) : null);

  for (const mod of modules) {
    if (mod?.LoanInterestRate == null) continue;

    const draw = yearOf(mod.LoanStartDate);
    const end = yearOf(mod.LoanEndDate);
    const principal = Number(mod.LoanPrincipal) || 0;
    const schedule = Array.isArray(mod.Amortization) ? mod.Amortization : [];
    const total = schedule.reduce((sum, r) => sum + (Number(r?.Pct) || 0), 0);

    if (!principal || !draw || !end) {
      out.push({
        id: `loan-incomplete-${mod.Name}`,
        severity: "error",
        title: `Loan "${mod.Name}" is not fully configured`,
        detail:
          "A loan needs an original amount, a year taken and an end year before it can be " +
          "projected. Until all three are set it contributes interest but no principal.",
        years: [],
        amount: null,
      });
      continue;
    }

    if (total > 100.0001) {
      out.push({
        id: `loan-over-scheduled-${mod.Name}`,
        severity: "warning",
        title: `Loan "${mod.Name}" repays more than it borrowed`,
        detail:
          `The amortization schedule totals ${total.toFixed(2)}% of the original amount. ` +
          "Repayments are capped at the balance owed, so the later years in the schedule do nothing.",
        years: [],
        amount: null,
      });
    }

    // A balloon is a property of the SCHEDULE. The end year always repays the
    // remainder, so "nothing scheduled" means the whole principal falls due at once.
    if (schedule.length === 0) {
      out.push({
        id: `loan-bullet-${mod.Name}`,
        severity: "warning",
        title: `Loan "${mod.Name}" repays everything in ${end}`,
        detail:
          "No principal is scheduled before the end year, so the whole balance falls due at once. " +
          'Use "Straight line" on the Amortization schedule to spread it.',
        years: [end],
        amount: -principal,
      });
    } else if (total < 100 && principal * (1 - total / 100) > 2 * (principal * (total / 100) / schedule.length)) {
      out.push({
        id: `loan-balloon-${mod.Name}`,
        severity: "warning",
        title: `Loan "${mod.Name}" ends with a balloon payment`,
        detail:
          `${end} repays the remaining ${formatMoney(-principal * (1 - total / 100))}, more than twice a ` +
          "typical scheduled year. Make sure the plan can fund it.",
        years: [end],
        amount: -principal * (1 - total / 100),
      });
    }
  }

  return out;
}

/** Compact money for warning copy: -3350000 → "($3.4M)". */
export function formatMoney(value) {
  if (value == null || value === "") return "—"; // Number(null) is 0, not NaN
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  let body;
  if (abs >= 1_000_000) body = `$${(abs / 1_000_000).toFixed(1)}M`;
  else if (abs >= 1_000) body = `$${(abs / 1_000).toFixed(0)}K`;
  else body = `$${abs.toFixed(0)}`;
  return n < 0 ? `(${body})` : body;
}

/** "2029, 2030, 2031" — or "2029–2031 (14 years)" once the list gets long. */
export function formatYearList(years = []) {
  if (!years.length) return "";
  const sorted = [...years].sort((a, b) => a - b);
  if (sorted.length <= 4) return sorted.join(", ");
  return `${sorted[0]}–${sorted[sorted.length - 1]} (${sorted.length} years)`;
}

/**
 * CR074 — the identity a DISMISSAL is recorded against.
 *
 * A warning's `id` alone is not enough. `sweep-source-exhausted` is the same id whether the
 * drain lands in 2061 or in 2041, so a dismissal keyed on the id would let one click in a
 * comfortable year permanently silence the rule — including the moment it becomes urgent.
 * That is precisely the failure CR045 built this panel to prevent (§1: a silent panel must
 * never be mistakable for a healthy forecast).
 *
 * So the fingerprint hashes what the warning ASSERTS — its severity, the years it names, the
 * amount it carries, and its detail sentence, which is where the rules put their figures
 * ("Cost basis and market value are both $3.9M"). A dismissal suppresses a warning only while
 * the fingerprint still matches; change the plan and the warning comes back on its own.
 *
 * Deliberately NOT a cryptographic hash — this is a change-detector, not a security boundary.
 * FNV-1a over the canonical string, hex, stable across browsers and runs. Collisions would
 * un-dismiss or mis-suppress a single warning, not corrupt anything.
 */
export function warningFingerprint(warning) {
  const canonical = JSON.stringify([
    warning?.id ?? "",
    warning?.severity ?? "",
    [...(warning?.years || [])].sort((a, b) => a - b),
    warning?.amount == null ? null : Number(warning.amount),
    warning?.detail ?? "",
  ]);
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Split the warnings into what to SHOW and what the owner has already accepted.
 *
 * `dismissals` is `{ [warningId]: fingerprint }` as stored. A row whose fingerprint has moved
 * on is returned as VISIBLE and flagged `staleDismissal`, so the panel can say the warning came
 * back rather than appearing to have never been dismissed.
 */
export function partitionDismissed(warnings = [], dismissals = {}) {
  const visible = [];
  const dismissed = [];
  for (const w of warnings) {
    const stored = dismissals[w.id];
    if (stored === undefined) { visible.push(w); continue; }
    if (stored === warningFingerprint(w)) dismissed.push(w);
    else visible.push({ ...w, staleDismissal: true });
  }
  return { visible, dismissed };
}
