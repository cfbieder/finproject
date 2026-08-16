/**
 * FCSavePreviewModal (CR084) — what this edit does to the plan, before it is saved.
 *
 * From [CR081 §13]. Both reviewers of that CR preferred this to the AI assistant it was carved out
 * of: a consequence preview serves EVERY edit the owner makes, not only AI-proposed ones.
 *
 * The server returns two RAW entry sets — the scenario built as it stands, and built with the
 * pending edit — from one throwaway copy. This component turns them into numbers with the SAME
 * `buildScenarioMatrix` / `compareMatrices` the Compare page uses and the same `buildDeflators`
 * CR079 uses, so a preview and a comparison cannot show different arithmetic. That is why the
 * endpoint returns entries instead of a summary: a server-side roll-up would be a second
 * implementation of figures the app already renders, and CR076 §2 published five wrong net-worth
 * figures the one time that was tried.
 */
import { useEffect, useMemo, useState } from "react";
import Modal from "../../components/Modal/Modal.jsx";
import { useFCLineStructure } from "./hooks/useFCLineStructure.js";
import { useBalanceSheetAccounts } from "./hooks/useBalanceSheetAccounts.js";
import { useBaseYearBalanceSheet } from "./hooks/useBaseYearBalanceSheet.js";
import { buildScenarioMatrix, compareMatrices } from "./utils/fcCompareUtils.js";
import { buildDeflators, toRealTerms } from "./utils/fcRealTerms.js";
import Rest from "../../js/rest.js";
import "./FCSavePreviewModal.css";

const money = (v) =>
  v == null || !Number.isFinite(Number(v))
    ? "—"
    : Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 });

const signed = (v) =>
  v == null || !Number.isFinite(Number(v))
    ? "—"
    : (Number(v) >= 0 ? "+" : "") +
      Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 });

export default function FCSavePreviewModal({
  preview,          // null while the server is still building both sides
  moduleName,       // known before the preview returns, so the title is right immediately
  periodStart,
  inflationRows,
  saving,
  onConfirm,
  onCancel,
}) {
  const { cashAccounts, cashAccountMap } = useFCLineStructure();
  const { balanceAccounts, balanceAccountMap } = useBalanceSheetAccounts();
  const baseBal = useBaseYearBalanceSheet(periodStart, balanceAccountMap);
  const [baseYearValues, setBaseYearValues] = useState({});

  useEffect(() => {
    if (!preview?.scenario) return undefined;
    let cancelled = false;
    Rest.get(`/forecast/base-year-values?scenario=${encodeURIComponent(preview.scenario)}`)
      .then((r) => { if (!cancelled) setBaseYearValues(r.data || {}); })
      .catch(() => { if (!cancelled) setBaseYearValues({}); });
    return () => { cancelled = true; };
  }, [preview?.scenario]);

  const compare = useMemo(() => {
    if (!preview || !cashAccounts.length || !balanceAccounts.length || !periodStart) return null;

    const yearsOf = (rows) =>
      [...new Set(rows.map((e) => Number(e.Year)))].filter(Number.isFinite).sort((a, b) => a - b);

    const build = (entries) =>
      buildScenarioMatrix({
        entries,
        years: yearsOf(entries),
        periodStart,
        baseYearValues,
        lastActualBalance: baseBal.baseBalanceTotalsByYear?.get(Number(periodStart) - 2) ?? null,
        cashAccountMap,
        balanceAccountMap,
        balanceRows: balanceAccounts,
      });

    // A = the plan as it stands, B = the plan with this edit. Deltas read B − A, exactly as on the
    // Compare page, so "what this change does" and "how two scenarios differ" are one operation.
    return compareMatrices(build(preview.before), build(preview.after), {
      cashRows: cashAccounts,
      balanceRows: balanceAccounts,
    });
  }, [preview, cashAccounts, cashAccountMap, balanceAccounts, balanceAccountMap,
      baseYearValues, baseBal, periodStart]);

  const headline = useMemo(() => {
    if (!compare) return null;
    const row = compare.totals.netAssets;
    let i = row.delta.length - 1;
    while (i >= 0 && row.delta[i] == null) i -= 1;
    if (i < 0) return null;

    const year = compare.years[i];
    const anchor = Number(periodStart) - 1;
    const deflators = buildDeflators({
      inflationRows, scenarioName: preview.scenario, baseYear: anchor, years: compare.years,
    });
    const real = (v) => (deflators ? toRealTerms(v, year, deflators) : null);

    return {
      year, anchor,
      before: row.a[i], after: row.b[i], delta: row.delta[i],
      realBefore: real(row.a[i]), realAfter: real(row.b[i]), realDelta: real(row.delta[i]),
      hasReal: Boolean(deflators),
    };
  }, [compare, inflationRows, periodStart, preview]);

  const loading = !preview || !compare || !headline;
  const unchanged = headline && Math.abs(Number(headline.delta) || 0) < 1;

  return (
    <Modal open onClose={onCancel} title={`Save "${preview?.module ?? moduleName}" — what it does`} size="wide">
      <div className="fc-save-preview">
        {loading ? (
          /* The modal opens on the CLICK, not on the response: two real engine builds take a
             second or more, and before this the screen did nothing at all in that window — the
             owner had no way to tell a slow preview from a dead button. */
          <p className="fc-save-preview__loading" role="status" aria-live="polite">
            <span className="fc-save-preview__spinner" aria-hidden="true" />
            Working out what this change does — running the forecast twice…
          </p>
        ) : (
          <>
            <table className="fc-save-preview__table">
              <thead>
                <tr>
                  <th>Net assets, {headline.year}</th>
                  <th>now</th>
                  <th>after saving</th>
                  <th>change</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>nominal</td>
                  <td>{money(headline.before)}</td>
                  <td>{money(headline.after)}</td>
                  <td className={headline.delta >= 0 ? "up" : "down"}>{signed(headline.delta)}</td>
                </tr>
                {/* CR079's deflator, so an edit whose effect lands decades out is legible. Omitted
                    rather than faked when the scenario declares no inflation. */}
                {headline.hasReal && (
                  <tr>
                    <td>in {headline.anchor} dollars</td>
                    <td>{money(headline.realBefore)}</td>
                    <td>{money(headline.realAfter)}</td>
                    <td className={headline.realDelta >= 0 ? "up" : "down"}>
                      {signed(headline.realDelta)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            {unchanged && (
              <p className="fc-save-preview__unchanged">
                This edit does not change the forecast.
              </p>
            )}

            {/* ⚠️ Computed per edit, never asserted. A variant with its own override for this
                module keeps its value, so a base edit reaches it not at all — and the owner
                believing otherwise is the half worth naming. */}
            <div className="fc-save-preview__radius">
              {preview.alsoMoves?.length > 0 && (
                <p><b>Also moves:</b> {preview.alsoMoves.join(" · ")}</p>
              )}
              {preview.doesNotMove?.length > 0 && (
                <p className="fc-save-preview__blocked">
                  <b>Does NOT move:</b>{" "}
                  {preview.doesNotMove.map((v) => `${v.name} (${v.reason})`).join(" · ")}
                </p>
              )}
              {!preview.alsoMoves?.length && !preview.doesNotMove?.length && (
                <p>No other scenario is affected.</p>
              )}
            </div>

            <p className="fc-save-preview__note">
              Nothing is saved yet. These figures come from a throwaway copy of
              &ldquo;{preview.scenario}&rdquo;, built twice by the real engine.
            </p>
          </>
        )}

        <div className="fc-save-preview__actions">
          <button type="button" className="btn btn--secondary" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={onConfirm}
            disabled={saving || loading}
          >
            {/* Three states, not two. While the preview is still building, `saving` is also true —
                labelling that "Saving…" would contradict the note directly below it, which says
                nothing has been saved yet, on the one screen whose purpose is that distinction. */}
            {loading ? "Working it out…" : saving ? "Saving…" : "Save this change"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
