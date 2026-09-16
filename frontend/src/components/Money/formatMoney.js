/**
 * formatMoney — CR087 P1. ONE money renderer, with the behavioural contract the
 * CR exists to settle. Not a component, so it works in toasts and titles too;
 * `Money.jsx` is the JSX half and imports this.
 *
 * Three rules, each of them a defect this repo has actually shipped:
 *
 * 1. 🔴 **null → `—`, zero → a number.** `utils/formatters.js` documents
 *    `formatCurrency(null) → "$0.00"` as intended, while `FCEquity.jsx` renders
 *    `—` for any |v| < 0.5 — so a genuinely zero equity, the interesting case,
 *    reads as missing data (CR087 §6). Absent and zero are different answers and
 *    must not look alike.
 *
 * 2. 🔴 **The locale is PINNED to en-US.** 22 call sites format money with
 *    `toLocaleString(undefined, …)`, so on a `pl-PL` browser the reconcile table
 *    renders `1.234,56` while the balance sheet renders `$1,234.56` — two
 *    conventions on one screen, neither labelled. `undefined` means "whatever
 *    machine this is", which is not a property of the money.
 *
 * 3. 🔴 **The currency is always rendered.** 47% of this book is foreign; a PLN
 *    mortgage of 1,650,000 shown as `($412,500.00)` cannot be tied to its
 *    statement, and a figure without its unit can be read wrong. USD keeps the
 *    `$` convention the reports already use; everything else carries its code.
 *
 * Negatives use accounting parentheses, matching every existing surface.
 *
 * ⚠️ Fence (CR087 §10 P4): this ships for CR087's own two surfaces — the balance
 * report and the reconcile page. The 22-call-site sweep stays CR086's job, so
 * nothing else is migrated here.
 */

const FORMATTERS = new Map();

function formatter(decimals) {
  if (!FORMATTERS.has(decimals)) {
    FORMATTERS.set(
      decimals,
      // en-US, explicitly. Never `undefined`.
      new Intl.NumberFormat("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }),
    );
  }
  return FORMATTERS.get(decimals);
}

/** `true` when this value is ABSENT, as opposed to zero. */
export function isBlank(value) {
  return (
    value === null ||
    value === undefined ||
    value === "" ||
    !Number.isFinite(typeof value === "string" ? parseFloat(value) : value)
  );
}

/**
 * @param {number|string|null} value
 * @param {object} [opts]
 * @param {string|null} [opts.currency] ISO code. `USD` renders `$`; another code
 *   is appended; `null` renders the bare number — for a column whose currency is
 *   stated once in its header, never as a way to omit it.
 * @param {number} [opts.decimals]
 * @returns {string} `—` when absent.
 */
export function formatMoney(value, { currency = "USD", decimals = 2 } = {}) {
  if (isBlank(value)) return "—";
  const n = typeof value === "string" ? parseFloat(value) : Number(value);
  const digits = formatter(decimals).format(Math.abs(n));
  const ccy = currency ? String(currency).toUpperCase() : null;
  const body = ccy === "USD" ? `$${digits}` : ccy ? `${digits} ${ccy}` : digits;
  // Accounting convention, and it is load-bearing on a balance sheet where
  // liabilities are negative: a minus sign is easy to miss at the start of a
  // long figure.
  return n < 0 ? `(${body})` : body;
}
