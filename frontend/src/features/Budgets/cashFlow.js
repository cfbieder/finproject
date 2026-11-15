/** CR104 — Cash Flow modal helpers, kept out of the component file so fast refresh works. */

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Feb–Dec" / "Mar, May" — consecutive months collapse into a range. */
export function monthRanges(months) {
  const out = [];
  let start = null;
  let prev = null;
  for (const m of [...months, null]) {
    if (m != null && prev != null && m === prev + 1) { prev = m; continue; }
    if (start != null) out.push(start === prev ? MONTHS[start - 1] : `${MONTHS[start - 1]}–${MONTHS[prev - 1]}`);
    start = m;
    prev = m;
  }
  return out.join(", ");
}

/** A typed amount: digits, an optional minus and dot, at most two decimals. Commas are refused, not guessed. */
export function parseAmount(raw) {
  const s = String(raw ?? "").trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  return Number(s);
}
