/**
 * CR099 — a module's per-year return path: the nominal price return for chosen calendar years,
 * replacing Growth × inflation for those years only (−50 halves the value). Years without a row
 * grow as Growth says. Unrealized: no tax and no cash. Kept sorted by year, because a variant
 * compares its path to the base row by row.
 */
export default function FCReturnPath({ rows = [], onChange, firstYear, lastYear, disabled = false }) {
  const list = [...rows].sort((a, b) => Number(a.Year) - Number(b.Year));
  const years = [];
  for (let y = Number(firstYear); y <= Number(lastYear); y += 1) years.push(y);
  const used = new Set(list.map((r) => Number(r.Year)));
  // The year after the last row, so a recovery is typed year by year; else the first free year.
  const last = list.length ? Number(list[list.length - 1].Year) : null;
  const nextFree = years.find((y) => !used.has(y) && (last == null || y > last)) ?? years.find((y) => !used.has(y));
  const emit = (next) => onChange([...next].sort((a, b) => Number(a.Year) - Number(b.Year)));
  const set = (i, patch) => emit(list.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div className="fc-return-path">
      <p className="fc-return-path__hint">
        Override Growth for chosen years with that year&apos;s price return, e.g. −50 for a crash.
        Years without a row grow as Growth says; 0 means a flat year. No tax and no cash: it is a
        change in value only.
      </p>
      {list.length > 0 && (
        <table className="fc-return-path__table">
          <thead>
            <tr><th>Year</th><th className="num">Return %</th><th aria-label="Remove" /></tr>
          </thead>
          <tbody>
            {list.map((r, i) => (
              <tr key={i}>
                <td>
                  <select className="form-input" value={r.Year} disabled={disabled}
                    aria-label={`Year of return row ${i + 1}`}
                    onChange={(e) => set(i, { Year: Number(e.target.value) })}>
                    {/* A row's own year is always offered: one the annual close or a shorter plan
                        has left outside the range would otherwise show as the first option, so
                        the owner would read one year while the row holds another. */}
                    {(years.includes(Number(r.Year)) ? years : [Number(r.Year), ...years])
                      .filter((y) => y === Number(r.Year) || !used.has(y)).map((y) => (
                        <option key={y} value={y}>{y}</option>
                      ))}
                  </select>
                  {!years.includes(Number(r.Year)) && (
                    <span className="fc-return-path__stale">outside {firstYear}–{lastYear}: ignored</span>
                  )}
                </td>
                <td className="num">
                  <input type="number" step="0.1" className="form-input fc-return-path__pct"
                    value={r.Pct ?? ""} disabled={disabled} aria-label={`Return % for ${r.Year}`}
                    onChange={(e) => set(i, { Pct: e.target.value === "" ? "" : Number(e.target.value) })} />
                </td>
                <td>
                  <button type="button" className="btn btn--outline btn--sm" disabled={disabled}
                    onClick={() => emit(list.filter((_, j) => j !== i))}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button type="button" className="btn btn--outline btn--sm" disabled={disabled || nextFree == null}
        onClick={() => emit([...list, { Year: nextFree, Pct: "" }])}>
        Add a year
      </button>
    </div>
  );
}
