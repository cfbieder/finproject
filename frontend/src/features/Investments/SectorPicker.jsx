/**
 * SectorPicker.jsx — CR093 P1. Hand-classify a holding no provider can.
 *
 * ⚠️ WEIGHTS, NOT A SECTOR. One pick is right for a company or a sector fund and
 * WRONG for a diversified one: BDJ and EOS hold broad equity portfolios, and
 * calling either "financial services" by hand repeats the error the vendors made
 * with a different wrong answer. So a single 100% pick is the default path
 * because it is usually correct, and adding sectors is one click away because
 * sometimes it is not.
 *
 * ⚠️ The 100% rule is shown live and blocks Save. A set summing to 90% would
 * store a fund at 90% of its own value and under-report it forever, while
 * looking perfectly well-formed — the same shape migration 077 refuses in the
 * loader.
 */

import { useState } from "react";
import Modal from "../../components/Modal/Modal.jsx";
import { money } from "./investmentFormat.js";
import { SECTOR_LABEL, SECTORS, sumPct } from "./sectorWeights.js";

export default function SectorPicker({ holding, onClose, onSaved }) {
  const [rows, setRows] = useState([{ sector: "", pct: 100 }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const total = sumPct(rows);
  const chosen = rows.filter((r) => r.sector);
  const ok = chosen.length > 0 && Math.abs(total - 100) < 0.05
    && new Set(chosen.map((r) => r.sector)).size === chosen.length;

  const setRow = (i, patch) =>
    setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/v2/investments/securities/${holding.security_id}/sectors`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weights: chosen.map((r) => ({ sector: r.sector, weight: Number(r.pct) / 100 })),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      onSaved();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Sector for ${holding.ticker || holding.name}`}
      description={`${holding.name} · ${money(holding.market_value, "USD")}`}
      footer={(
        <div className="sector-picker__footer">
          <span className={`sector-picker__total${ok ? " sector-picker__total--ok" : ""}`}>
            {total.toFixed(1)}% of 100%
          </span>
          <button type="button" className="btn btn--secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn--primary" disabled={!ok || saving} onClick={save}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      )}
    >
      <p className="sector-picker__note">
        Both data providers report this as <em>financial services</em> — the sector its
        manager is registered in, not what it holds. Enter what it actually holds.
        A diversified fund needs more than one row; a concentrated one needs a single
        row at 100%.
      </p>

      {rows.map((r, i) => (
        // eslint-disable-next-line react/no-array-index-key -- rows are positional and reorderable only by add/remove
        <div className="sector-picker__row" key={i}>
          <select
            className="sector-picker__select"
            value={r.sector}
            aria-label={`Sector ${i + 1}`}
            onChange={(e) => setRow(i, { sector: e.target.value })}
          >
            <option value="">Choose a sector…</option>
            {SECTORS.map((s) => (
              <option
                key={s}
                value={s}
                disabled={rows.some((x, k) => k !== i && x.sector === s)}
              >
                {SECTOR_LABEL[s]}
              </option>
            ))}
          </select>
          <input
            className="sector-picker__pct"
            type="number" min="0.1" max="100" step="0.1"
            value={r.pct}
            aria-label={`Percent for sector ${i + 1}`}
            onChange={(e) => setRow(i, { pct: e.target.value })}
          />
          <span className="sector-picker__unit">%</span>
          {rows.length > 1 && (
            <button
              type="button" className="btn btn--ghost btn--sm sector-picker__remove"
              onClick={() => setRows((rs) => rs.filter((_, k) => k !== i))}
              aria-label={`Remove sector ${i + 1}`}
            >
              Remove
            </button>
          )}
        </div>
      ))}

      {rows.length < SECTORS.length && (
        <button
          type="button" className="btn btn--ghost btn--sm"
          onClick={() => setRows((rs) => [...rs, { sector: "", pct: 0 }])}
        >
          Add another sector
        </button>
      )}

      {error && <p className="sector-picker__error">{error}</p>}
    </Modal>
  );
}
