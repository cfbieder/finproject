// CR102 — the arithmetic of the Compare Forecast modal, pure so it can be tested.
//
// Δ = budget − forecast. Δ% = Δ / |forecast|, so an expense over plan (budget −150 against forecast −100)
// reads −50 and −50%: both negative, as colour-means-sign needs. Either side unknown (null) gives no
// difference; a forecast of 0 gives no percentage.

const round2 = (n) => Math.round(Number(n) * 100) / 100;

export function delta(budget, forecast) {
  if (budget == null || forecast == null) return null;
  return round2(budget - forecast);
}

export function deltaPct(budget, forecast) {
  const d = delta(budget, forecast);
  if (d == null || !forecast) return null;
  return round2((d / Math.abs(forecast)) * 100);
}
