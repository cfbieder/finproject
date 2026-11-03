// CR098 rev 3, V5 — two budget builds line by line.
//
// Merges two `GET /budget-builder/:id` results on (category, currency). Done here, not in SQL:
// a draft's `annual_amount` is 0 until it is published, so only `getBuild`'s computed figures are
// comparable. A line in one build only counts as 0 on the other side, so the difference column adds
// up to the difference of the totals. A line whose USD is unknown (its scenario has no rates) has no
// difference, and neither does the total.

const round2 = (n) => Math.round(Number(n) * 100) / 100;
const keyOf = (l) => `${l.categoryId}|${l.currency}`;

/** The sign a figure SHOWS at `digits`, so a −0.4 printed as "0" is not coloured red. */
export function displaySign(v, digits = 0) {
  if (v == null || !Number.isFinite(Number(v))) return 0;
  const shown = Number(Number(v).toFixed(digits));
  return shown > 0 ? 1 : shown < 0 ? -1 : 0;
}

const side = (l) => (l ? { annual: l.annual, usd: l.annualUsd } : null);

/**
 * @param {object} a  a `getBuild` view (the left side)
 * @param {object} b  a `getBuild` view (the right side)
 * @returns {{ rows: object[], totals: { a: number|null, b: number|null, diff: number|null } }}
 *   each row: { key, category, parent, currency, a, b, diffUsd, differs }, where `a` / `b` is
 *   { annual, usd } or null when the line is not in that build, and `diffUsd` is B − A.
 */
export function compareBuilds(a, b) {
  const left = new Map((a?.lines || []).map((l) => [keyOf(l), l]));
  const right = new Map((b?.lines || []).map((l) => [keyOf(l), l]));
  const keys = new Set([...left.keys(), ...right.keys()]);

  const rows = [...keys].map((key) => {
    const la = left.get(key);
    const lb = right.get(key);
    const any = la || lb;
    const ua = la ? la.annualUsd : 0;
    const ub = lb ? lb.annualUsd : 0;
    const diffUsd = ua == null || ub == null ? null : round2(ub - ua);
    const differs = !la || !lb
      || la.annual == null || lb.annual == null
      || round2(la.annual) !== round2(lb.annual)
      || displaySign(diffUsd) !== 0;
    return {
      key, category: any.category, parent: any.parent ?? null, currency: any.currency,
      a: side(la), b: side(lb), diffUsd, differs,
    };
  });

  rows.sort((x, y) => (x.parent ?? "").localeCompare(y.parent ?? "")
    || x.category.localeCompare(y.category)
    || x.currency.localeCompare(y.currency));

  const ta = a?.usdTotal ?? null;
  const tb = b?.usdTotal ?? null;
  return { rows, totals: { a: ta, b: tb, diff: ta == null || tb == null ? null : round2(tb - ta) } };
}
