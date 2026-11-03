import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import Rest from "../../js/rest.js";
import { compareBuilds, displaySign } from "./buildCompare.js";

/**
 * CR098 rev 3, V5 — the builds of one year side by side, on the budget builder page.
 *
 * Top: every build of the year with its USD total and the rates behind it, because two variants can
 * differ on rates as well as on lines. Below: any two builds, annual per (category, currency), with
 * B − A in USD. Annual only — the month split stays on each line. A published build is shown as
 * published. A build that cannot be read, or a draft whose scenario has no rates, shows no figure
 * rather than failing the page.
 */

const STATUS = { draft: "draft", published: "live", superseded: "superseded", unpublished: "un-published" };
const fmt = (v, digits = 0) =>
  v == null || !Number.isFinite(Number(v))
    ? "—"
    : Number(v).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
const signClass = (v, digits = 0) => (displaySign(v, digits) < 0 ? "bb-neg" : undefined);
const label = (b) => `${b.targetYear} v${b.buildNo}`;
const rate = (r, digits = 2) => (r ? fmt(r.rate, digits) : "—");

function Money({ v }) {
  return <td className={`num ${signClass(v) ?? ""}`}>{fmt(v)}</td>;
}

export default function BuildCompare({ year, current, refreshKey }) {
  const currentId = current.build.id;
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [pick, setPick] = useState({ a: null, b: null });
  const [views, setViews] = useState({});
  const [onlyDiffs, setOnlyDiffs] = useState(true);
  const [followed, setFollowed] = useState(currentId);

  // Opening another build on the page makes it B; the A the user chose stays.
  if (followed !== currentId) {
    setFollowed(currentId);
    setPick((p) => ({ a: p.a === currentId ? p.b : p.a, b: currentId }));
  }

  // Each side loads on its own, so one unreadable build leaves the other standing. A response that
  // arrives after the list was reloaded belongs to an old generation and is dropped.
  const requested = useRef({ ids: new Set() });

  useEffect(() => {
    let cancelled = false;
    Rest.get(`/budget-builder/compare?year=${year}`)
      .then((r) => {
        if (cancelled) return;
        const data = Rest.unwrap(r);
        requested.current = { ids: new Set() };
        setError("");
        setList(data.builds);
        setViews({});
        // Picks that still exist are kept. Otherwise B is the build open on the page and A the live
        // build, else the newest other one.
        const ok = data.builds.filter((b) => !b.error);
        setPick((p) => {
          const has = (id) => ok.some((x) => x.id === id);
          const b = has(p.b) ? p.b : (ok.find((x) => x.id === currentId) || ok[0])?.id ?? null;
          const a = has(p.a) && p.a !== b ? p.a
            : (ok.find((x) => x.status === "published" && x.id !== b) || ok.find((x) => x.id !== b))?.id ?? null;
          return { a, b };
        });
      })
      .catch((e) => !cancelled && setError(e.message || "Could not load the builds of this year"));
    return () => { cancelled = true; };
    // currentId seeds the first pick only; a change of build is followed above, not by reloading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, refreshKey]);

  // The build open on the page is never fetched: the page's own view is used, so a line edited a
  // moment ago is compared as it now stands.
  useEffect(() => {
    const req = requested.current;
    for (const id of [pick.a, pick.b]) {
      if (id == null || id === currentId || req.ids.has(id)) continue;
      req.ids.add(id);
      const keep = () => requested.current === req;
      Rest.get(`/budget-builder/${id}`)
        .then((r) => keep() && setViews((v) => ({ ...v, [id]: { view: Rest.unwrap(r) } })))
        .catch((e) => keep() && setViews((v) => ({ ...v, [id]: { error: e.message || "Could not load" } })));
    }
  }, [pick, list, currentId]);

  const viewOf = (id) => (id === currentId ? { view: current } : views[id]);
  const va = viewOf(pick.a);
  const vb = viewOf(pick.b);
  const result = useMemo(
    () => (va?.view && vb?.view ? compareBuilds(va.view, vb.view) : null),
    [va?.view, vb?.view]
  );
  // The list row of the open build reads the page's view too, so its total moves with an edit.
  const shownList = useMemo(() => (list || []).map((b) => (b.id === currentId && !b.error
    ? { ...b, note: current.build.note, status: current.build.status, rates: current.rates, usdTotal: current.usdTotal }
    : b)), [list, current, currentId]);
  const byId = useMemo(() => new Map(shownList.map((b) => [b.id, b])), [shownList]);

  if (error) return <p className="bb-error" role="alert">{error}</p>;
  if (!list) return <p className="bb-muted">Loading the builds of {year}…</p>;

  const A = byId.get(pick.a);
  const B = byId.get(pick.b);
  const rows = result ? result.rows.filter((r) => !onlyDiffs || r.differs) : [];
  const hidden = result && onlyDiffs ? result.rows.filter((r) => !r.differs) : [];
  const hiddenUsd = hidden.some((r) => r.diffUsd == null)
    ? null : Math.round(hidden.reduce((s, r) => s + r.diffUsd, 0) * 100) / 100;
  const readable = shownList.filter((b) => !b.error).length;
  const ratesOf = (b) => (b ? `inflation ${b.rates?.inflation ? `${fmt(b.rates.inflation.rate, 1)}%` : "—"} · PLN ${rate(b.rates?.fx?.PLN)} · EUR ${rate(b.rates?.fx?.EUR)}` : "");

  return (
    <section aria-label={`Compare the builds of ${year}`} className="bb-compare">
      <div className="bb-table-wrap">
        <table className="bb-table bb-table--compact">
          <thead>
            <tr>
              <th>A</th><th>B</th><th>Build</th><th>Name</th><th>Status</th><th>Estimate</th><th>Rates from</th>
              <th className="num">Inflation</th><th className="num">PLN per USD</th><th className="num">EUR per USD</th>
              <th className="num">Total USD</th>
            </tr>
          </thead>
          <tbody>
            {shownList.map((b) => (
              b.error ? (
                <tr key={b.id}>
                  <td /><td /><td colSpan={9} className="bb-muted">Build {b.id} could not be read: {b.error}</td>
                </tr>
              ) : (
                <tr key={b.id}>
                  <td>
                    <input type="radio" name="bb-cmp-a" aria-label={`Compare ${label(b)} as A`}
                      checked={pick.a === b.id} onChange={() => setPick((p) => ({ ...p, a: b.id }))} />
                  </td>
                  <td>
                    <input type="radio" name="bb-cmp-b" aria-label={`Compare ${label(b)} as B`}
                      checked={pick.b === b.id} onChange={() => setPick((p) => ({ ...p, b: b.id }))} />
                  </td>
                  <td>{label(b)}</td>
                  <td>{b.note || <span className="bb-muted">none</span>}</td>
                  <td>{STATUS[b.status] || b.status}</td>
                  <td>{b.le?.name}</td>
                  <td>{b.scenario}</td>
                  <td className="num">{b.rates?.inflation ? `${fmt(b.rates.inflation.rate, 1)}%` : "—"}</td>
                  <td className="num">{rate(b.rates?.fx?.PLN)}</td>
                  <td className="num">{rate(b.rates?.fx?.EUR)}</td>
                  <Money v={b.usdTotal} />
                </tr>
              )
            ))}
          </tbody>
        </table>
      </div>

      {readable === 0 && <p className="bb-muted">No build of {year} could be read.</p>}
      {readable === 1 && <p className="bb-muted">{year} has one build; start another to compare.</p>}

      {A && B && A.id === B.id && <p className="bb-muted">Choose two different builds as A and B.</p>}

      {A && B && A.id !== B.id && (
        <>
          <div className="bb-rates">
            <span><strong>A</strong> {label(A)} · {STATUS[A.status]} <span className="bb-muted">· {ratesOf(A)}</span></span>
            <span><strong>B</strong> {label(B)} · {STATUS[B.status]} <span className="bb-muted">· {ratesOf(B)}</span></span>
            <label className="bb-push-right">
              <input type="checkbox" checked={onlyDiffs} onChange={(e) => setOnlyDiffs(e.target.checked)} /> Only lines that differ
            </label>
          </div>
          {(va?.error || vb?.error) && (
            <p className="bb-error" role="alert">
              {va?.error && `${label(A)} could not be loaded: ${va.error}. `}
              {vb?.error && `${label(B)} could not be loaded: ${vb.error}.`}
            </p>
          )}
          {!result && !va?.error && !vb?.error && <p className="bb-muted">Loading the two builds…</p>}
          {result && (
            <div className="bb-table-wrap">
              <table className="bb-table">
                <thead>
                  <tr>
                    <th>Category</th><th>Cur</th>
                    <th className="num">A annual</th><th className="num">A in USD</th>
                    <th className="num">B annual</th><th className="num">B in USD</th>
                    <th className="num">B − A in USD</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.key} className={i % 2 ? "bb-row--alt" : undefined}>
                      <td>{r.parent && <span className="bb-muted">{r.parent} › </span>}{r.category}</td>
                      <td>{r.currency}</td>
                      {[r.a, r.b].map((s, j) => (
                        <Fragment key={j}>
                          {s ? <><Money v={s.annual} /><Money v={s.usd} /></>
                            : <td colSpan={2} className="num bb-muted">not in this build</td>}
                        </Fragment>
                      ))}
                      <Money v={r.diffUsd} />
                    </tr>
                  ))}
                  {!rows.length && (
                    <tr><td colSpan={7} className="bb-muted">No line differs.</td></tr>
                  )}
                  {hidden.length > 0 && (
                    <tr>
                      <td colSpan={6} className="bb-muted">
                        {hidden.length} unchanged line{hidden.length === 1 ? "" : "s"} hidden
                      </td>
                      <Money v={hiddenUsd} />
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3}>Total</td>
                    <Money v={result.totals.a} />
                    <td />
                    <Money v={result.totals.b} />
                    <Money v={result.totals.diff} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
