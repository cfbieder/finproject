/**
 * CR100 — the arithmetic behind an itemised builder line, pure so it can be tested.
 *
 * Mirrors the server (services/budgetBuilder.js `setLineItems` / `itemMonths`) so the modal's footer
 * shows what a save will store: positives take the line's sign, negatives stay negative, and the
 * RESULT must have one sign (so a re-opened expense line, shown negative, takes a new positive row); items convert into the line currency at the build's rates
 * (local per USD), rounded per month. The server decides; this only previews.
 */

export const CURRENCIES = ["USD", "PLN", "EUR"];
export const MAX_ITEMS = 100;

const round2 = (n) => Math.round(Number(n) * 100) / 100;
const sign = (n) => (n > 0 ? 1 : n < 0 ? -1 : 0);

/** A typed amount: blank is 0; anything else must be a plain number with at most two decimals. */
export function parseAmount(raw) {
  const v = String(raw ?? "").trim();
  if (v === "") return 0;
  if (!/^-?\d+(\.\d+)?$/.test(v)) return NaN;
  const n = Number(v);
  return Math.abs(n - round2(n)) > 1e-9 || Math.abs(n) >= 1e13 ? NaN : n;
}

/** The line's own sign: its estimate's, else expense − / income +. */
export function lineSign(line) {
  return sign(Number(line.leFy) || 0) || (line.accountType === "income" ? 1 : -1);
}

/** Multiply an amount in `from` by this to get `to`. Null when a rate is missing. */
export function factor(from, to, fx) {
  if (from === to) return 1;
  const t = fx?.[to]?.rate;
  const f = fx?.[from]?.rate;
  return t && f ? t / f : null;
}

/**
 * Everything the modal shows for `rows` ({ description, currency, months: string[12] }):
 * the first problem that stops a save (or null), the sign a save applies, each row's signed totals
 * in its own and the line currency, and the line's signed months and annual (null if unconvertible).
 */
export function summarise(rows, line, fx) {
  const s = lineSign(line);
  const signed = (v) => (v > 0 ? v * s : v);
  const parsed = rows.map((r) => r.months.map(parseAmount));
  const all = parsed.flat().map((v) => (Number.isNaN(v) ? v : signed(v)));

  let problem = null;
  if (!rows.length) problem = "Add at least one item";
  else if (rows.length > MAX_ITEMS) problem = `At most ${MAX_ITEMS} items on one line`;
  else if (all.some((v) => Number.isNaN(v))) problem = "An amount is not a number with at most two decimals";
  else if (rows.some((r) => !String(r.description || "").trim())) problem = "Every item needs a description";
  else if (rows.some((r) => String(r.description).trim().length > 200)) problem = "A description can be at most 200 characters";
  else if (all.some((v) => v > 0) && all.some((v) => v < 0)) problem = "Items of both signs — on this line a negative cannot sit beside a positive";
  else if (!all.some((v) => v)) problem = "Give at least one item an amount";

  const cur = line.currency;
  let months = Array(12).fill(0);
  const rowTotals = parsed.map((m, i) => {
    const own = round2(m.reduce((a, v) => a + (Number.isNaN(v) ? 0 : signed(v)), 0));
    const k = factor(rows[i].currency, cur, fx);
    if (k == null) months = null;
    else if (months) m.forEach((v, j) => { months[j] += Number.isNaN(v) ? 0 : signed(v) * k; });
    return { own, line: k == null ? null : round2(own * k) };
  });
  if (months) months = months.map(round2);
  const annual = months ? round2(months.reduce((a, b) => a + b, 0)) : null;
  return { problem, sign: s, rowTotals, months, annual };
}

/**
 * The reference rows (actual and budget of the LE year, by month) for every currency line of the
 * category, converted into the line's currency at the build's rates. A month is null only when it
 * is null (not yet actual) on every line; a line whose currency cannot convert is skipped and named.
 */
export function categoryReference(lines, currency, fx, reference) {
  const actual = Array(12).fill(null);
  const budget = Array(12).fill(0);
  const skipped = [];
  for (const l of lines) {
    const ref = reference?.[l.id];
    if (!ref) continue;
    const k = factor(l.currency, currency, fx);
    if (k == null) { skipped.push(l.currency); continue; }
    ref.priorActual.forEach((v, m) => { if (v != null) actual[m] = round2((actual[m] ?? 0) + v * k); });
    ref.thisYearMonths.forEach((v, m) => { budget[m] = round2(budget[m] + v * k); });
  }
  return { actual, budget, skipped };
}
