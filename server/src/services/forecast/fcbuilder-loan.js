/**
 * fcbuilder-loan.js — CR062 P1: turn a loan's five assumptions into the primitive
 * the engine already computes correctly.
 *
 * PURE. No db, no fs, no clock — everything it needs arrives as arguments, so it
 * is unit-testable in isolation (the CR043 Phase 2.3 load → compute → persist
 * split). `loadModulesForScenario` calls it and assigns the result to
 * `module.Invest`; `computeModule` then runs unchanged.
 *
 * ── Why Invest, and only Invest ──────────────────────────────────────────────
 *
 * A liability is stored as a NEGATIVE market value, and on a negative balance
 * the builder's disposal path is dead: the "market value cannot go negative" cap
 * zeroes any `Dispose` when `availableMarket <= 0`, silently and without a
 * warning. Probed on the real builder: `Dispose 50,000` against MV −500,000
 * produced no balance change, no transfer and no cash movement at all. `Invest`
 * is the one primitive that works — a positive Invest lifts the balance toward
 * zero and takes the cash (a repayment), a negative one pushes it down and
 * releases the cash (a draw). So the whole schedule is expressed in Invest rows
 * and nothing here needs the engine to change.
 *
 * ── Why derive instead of materializing ─────────────────────────────────────
 *
 * The five assumptions determine the schedule completely, so it is rebuilt on
 * every generate and never written to `forecast_module_investments`. A wizard
 * that stamps thirty rows is the CR049/CR050 rot pattern: change the rate and
 * the stored rows keep the old answer while looking authoritative.
 *
 * ── The emission window is an invariant, not a caller's responsibility ──────
 *
 * The categories frame starts at `PeriodStart − 1` and `writeValuesToCategoryRow`
 * DISCARDS anything written before its first column. A draw placed at index 0
 * therefore propagates into every later market value and is then dropped on the
 * way out — leaving a −400,000 liability with no cash ever arriving, and no
 * error. Nothing downstream can detect that, so this module refuses to emit
 * outside `[baseYear+1, horizonEnd]` and asserts it before returning.
 *
 * Interest is deliberately NOT computed here. It depends on the realised balance
 * path, which `computeModule` owns; deriving it twice is exactly the drift CR049
 * removed from the base-year query.
 */

/** Below half a cent is not money. */
const EPSILON = 0.005;

/** A schedule row's date is stored YYYY-07-01; only the year is ever read. */
const yearOf = (value) => {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const parsed = new Date(value);
  const year = parsed.getFullYear();
  return Number.isFinite(year) ? year : null;
};

const median = (values) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * @param {Object}   params
 * @param {number}   params.principal        Original loan amount (LC, positive). The base every % is a % OF.
 * @param {number}   params.drawYear         Year taken. > baseYear ⇒ the draw is injected; ≤ baseYear ⇒ already drawn.
 * @param {number}   params.endYear          Final year. ALWAYS repays the remaining balance; carries no schedule row.
 * @param {Array}    params.amortPct         [{ year, pct }] — % of `principal` repaid that year.
 * @param {number}   params.baseOutstanding  Module market_value at the base date (negative, or 0 for a future loan).
 * @param {number}   params.baseYear         PeriodStart − 1. NOT the module's base_date year — see the header.
 * @param {number}   params.horizonEnd       Scenario PeriodEnd.
 * @returns {{ invest: Array<{Date:string,Amount:number,Flag:string}>, warnings: Array<{code:string,message:string}> }}
 */
function deriveLoanSchedule({
  principal,
  drawYear,
  endYear,
  amortPct = [],
  baseOutstanding = 0,
  baseYear,
  horizonEnd,
}) {
  const warnings = [];
  const invest = [];
  const warn = (code, message) => warnings.push({ code, message });

  const P = Number(principal) || 0;
  const draw = yearOf(drawYear);
  const end = yearOf(endYear);
  const base = yearOf(baseYear);
  const horizon = yearOf(horizonEnd);
  const openingDebt = Math.abs(Number(baseOutstanding) || 0);

  if (base == null || horizon == null) {
    warn('loan_no_period', 'Scenario period is unknown — no loan schedule was derived.');
    return { invest, warnings };
  }
  if (!(P > 0)) {
    warn('loan_no_principal', 'Loan has no original amount, so no principal schedule was derived.');
    return { invest, warnings };
  }
  if (draw == null || end == null) {
    warn('loan_no_dates', 'Loan needs both a year taken and an end year before it can be projected.');
    return { invest, warnings };
  }
  if (end <= draw) {
    warn('loan_ends_before_drawn', `Loan ends in ${end} but is drawn in ${draw} — it repays in the year it is taken.`);
  }

  // Coherence between the two roles of the data model (§4). Both are real if
  // unusual states rather than impossibilities, so both warn rather than throw.
  const isFutureDraw = draw > base;
  if (isFutureDraw && openingDebt > EPSILON) {
    warn(
      'loan_double_counted',
      `Loan is drawn in ${draw} but already carries an outstanding balance today — the balance and the draw are counted twice.`
    );
  }
  if (!isFutureDraw && openingDebt <= EPSILON) {
    warn(
      'loan_past_no_balance',
      `Loan was taken in ${draw} but nothing is outstanding today, so it contributes nothing to the plan.`
    );
  }

  const pctByYear = new Map();
  let pctTotal = 0;
  for (const row of amortPct) {
    const year = yearOf(row?.year ?? row?.Date ?? row?.effective_date);
    const pct = Number(row?.pct ?? row?.Value ?? row?.value) || 0;
    if (year == null) continue;
    pctByYear.set(year, (pctByYear.get(year) || 0) + pct);
    pctTotal += pct;
  }
  if (pctTotal > 100 + 1e-6) {
    warn(
      'loan_over_scheduled',
      `Amortization schedule totals ${pctTotal.toFixed(2)}% of the original amount — repayments will be capped at the balance owed.`
    );
  }

  const emit = (year, amount) => {
    // The invariant this module exists to hold. Emitting at or before the base
    // year is silently discarded downstream, so refuse rather than trust.
    if (year <= base || year > horizon) {
      throw new Error(
        `fcbuilder-loan: refusing to emit ${year} outside [${base + 1}, ${horizon}] — it would be discarded on write`
      );
    }
    invest.push({ Date: `${year}-07-01`, Amount: amount, Flag: '' });
  };

  // Debt carried as a positive magnitude; the sign lives in the Invest amounts.
  let outstanding = isFutureDraw ? 0 : openingDebt;
  const scheduledRepayments = [];
  let remainderPaid = 0;

  for (let year = base + 1; year <= horizon; year++) {
    if (isFutureDraw && year === draw) {
      emit(year, -P);
      outstanding += P;
      // A July-1 draw repays nothing in the year it arrives; the half-year of
      // interest that year falls out of the average-balance formula downstream.
      continue;
    }

    if (year > end || outstanding <= EPSILON) continue;
    if (year <= draw) continue;

    let repayment;
    if (year === end) {
      // Decision 4: the end year repays whatever is left, so the loan closes at
      // exactly zero by construction rather than by rounding luck.
      repayment = outstanding;
      remainderPaid = repayment;
    } else {
      const pct = pctByYear.get(year) || 0;
      if (pct <= 0) continue;
      repayment = (P * pct) / 100;
      if (repayment > outstanding) {
        warn(
          'loan_repayment_capped',
          `${year}'s scheduled repayment exceeds the balance owed — capped so the loan cannot repay past zero.`
        );
        repayment = outstanding;
      }
      scheduledRepayments.push(repayment);
    }

    if (repayment > EPSILON) {
      emit(year, repayment);
      outstanding -= repayment;
    }
  }

  // A balloon is a property of the SCHEDULE, never of arithmetic — which is the
  // whole point of decision 4. Fire only when the final year is genuinely out of
  // line with the years before it, or when nothing was scheduled at all.
  if (remainderPaid > EPSILON) {
    const typical = median(scheduledRepayments);
    if (!scheduledRepayments.length) {
      warn(
        'loan_bullet',
        `The whole balance (${remainderPaid.toFixed(2)}) falls due in ${end} — no principal is scheduled before then.`
      );
    } else if (remainderPaid > 2 * typical) {
      warn(
        'loan_balloon',
        `${end} repays ${remainderPaid.toFixed(2)}, more than twice a typical year's ${typical.toFixed(2)} — a balloon payment.`
      );
    }
  }

  if (end <= horizon && outstanding > EPSILON) {
    // Only reachable when the end year sits at or before the base year, i.e. the
    // loan matured before the plan starts but a balance is still on the books.
    warn(
      'loan_unrepaid',
      `Loan ended in ${end} but ${outstanding.toFixed(2)} is still outstanding — it will sit on the balance sheet unchanged.`
    );
  }

  return { invest, warnings };
}

/**
 * Straight-line fill: the default the "Straight line" button writes. Covers
 * drawYear+1 … endYear−1 only, because the end year is the remainder (decision 4)
 * and must not also carry a percentage.
 */
function straightLineSchedule(drawYear, endYear) {
  const draw = yearOf(drawYear);
  const end = yearOf(endYear);
  if (draw == null || end == null || end <= draw) return [];
  const term = end - draw;              // number of repayment years, remainder included
  const pct = Number((100 / term).toFixed(4));
  const rows = [];
  for (let year = draw + 1; year < end; year++) rows.push({ year, pct });
  return rows;
}

module.exports = { deriveLoanSchedule, straightLineSchedule, EPSILON };
