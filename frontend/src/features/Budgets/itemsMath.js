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

/** A cell may carry commas only as exact thousands separators ("1,820.50"); a decimal comma rejects. */
const THOUSANDS = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/;
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const isBlank = (r) => !String(r.description || "").trim() && r.months.every((v) => !String(v ?? "").trim());

function parseCell(raw) {
  const v = String(raw ?? "").trim();
  return parseAmount(THOUSANDS.test(v) ? v.replace(/,/g, "") : v);
}

/**
 * CR103 P0 — a tab-separated paste into the itemised grid (e.g. CR103's "Copy Interest rows").
 *
 * Returns null when the text is a single value (no tab, no line break): the browser's own paste
 * applies. Otherwise `{ rows }`, the whole new row set, or `{ error }`, and nothing is applied —
 * a partial paste is never kept. Cells follow the grid's column order:
 *   14 cells  description, currency, Jan…Dec
 *   13 cells  description, Jan…Dec (the line's currency)
 *   12 cells  Jan…Dec — a single line only; fills row `at`, keeping its description and currency
 * Every amount goes through `parseAmount`, the modal's one number rule, so "1820,50" (a decimal
 * comma) rejects rather than becoming 182050.
 * Placement: the first item replaces row `at` if that row is blank (no description, no amounts),
 * otherwise it is appended; later items are appended.
 */
export function applyPaste(rows, at, text, lineCurrency) {
  const body = String(text ?? "").replace(/[\r\n]+$/, "");
  if (!/[\t\r\n]/.test(body)) return null;

  const lines = body.split(/\r?\n/).filter((l) => l.trim() !== "");
  const items = [];
  for (let n = 0; n < lines.length; n += 1) {
    const cells = lines[n].split("\t");
    while (cells.length > 14 && cells[cells.length - 1].trim() === "") cells.pop();
    // 12 amounts plus a trailing tab arrive as 13 cells; a description is never a number.
    if (cells.length === 13 && cells[12].trim() === "" && !Number.isNaN(parseCell(cells[0]))) cells.pop();
    const where = lines.length > 1 ? `Row ${n + 1}` : "The pasted row";

    let description = null;
    let currency = null;
    let amounts;
    if (cells.length === 14) [description, currency, ...amounts] = cells;
    else if (cells.length === 13) [description, ...amounts] = cells;
    else if (cells.length === 12 && lines.length === 1) amounts = cells;
    else if (cells.length === 12) return { error: `${where}: 12 amounts with no description; paste such a row on its own, or include the description` };
    else return { error: `${where} has ${cells.length} cells; expected 14 (item, currency, Jan–Dec), 13 (item, Jan–Dec) or 12 (Jan–Dec)` };

    if (currency != null) {
      currency = currency.trim().toUpperCase();
      if (!CURRENCIES.includes(currency)) return { error: `${where}: currency "${currency}" is not one of ${CURRENCIES.join(", ")}` };
    }
    const months = [];
    for (let m = 0; m < 12; m += 1) {
      const raw = amounts[m].trim();
      if (Number.isNaN(parseCell(raw))) return { error: `${where}, ${MONTH_NAMES[m]}: "${raw}" is not a number with at most two decimals` };
      months.push(raw.replace(/,/g, ""));
    }
    items.push({ description: description == null ? null : description.trim(), currency, months });
  }
  if (!items.length) return null;

  const next = rows.map((r) => ({ ...r }));
  const [first, ...rest] = items;
  if (first.description == null) {
    next[at] = { ...next[at], months: first.months };
    return { rows: next };
  }
  const asRow = (it) => ({ description: it.description, currency: it.currency || lineCurrency, months: it.months });
  if (next[at] && isBlank(next[at])) next[at] = asRow(first);
  else next.push(asRow(first));
  for (const it of rest) next.push(asRow(it));
  if (next.length > MAX_ITEMS) return { error: `That paste makes ${next.length} items; at most ${MAX_ITEMS} on one line` };
  return { rows: next };
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
