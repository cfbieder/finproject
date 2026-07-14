import { useCallback, useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { GitBranch, Scissors, X } from "lucide-react";
import Rest from "../../js/rest.js";
import { fieldLabel, isScheduleField, formatFieldValue } from "./fcFieldLabels.js";
import "./FCVariantPanel.css";

/**
 * CR050 — scenario lineage, and the override set that defines a variant.
 *
 * A variant inherits every item from its base unless overridden, so the list of overrides IS the
 * scenario's definition: "2026 Downside = 2026 Base, except these three things". That used to be
 * unanswerable — a copy diverges from its source in ways nobody can enumerate — so the panel
 * exists to make it a fact rather than a memory, and to let each override be reverted on its own.
 *
 * Self-contained on purpose: it fetches its own lineage and overrides rather than threading state
 * through FCScenarios (998 lines, and its scenario state is already split across three shapes).
 */
export default function FCVariantPanel({ selectedScenario, onChanged }) {
  const [rows, setRows] = useState([]);
  const [overrides, setOverrides] = useState([]);
  const [names, setNames] = useState({ modules: {}, incexp: {} });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const scenario = useMemo(
    () => rows.find((r) => r.name === selectedScenario) || null,
    [rows, selectedScenario]
  );
  const base = useMemo(
    () => (scenario?.parent_scenario_id ? rows.find((r) => r.id === scenario.parent_scenario_id) : null),
    [rows, scenario]
  );
  const children = useMemo(
    () => (scenario ? rows.filter((r) => r.parent_scenario_id === scenario.id) : []),
    [rows, scenario]
  );

  const load = useCallback(async () => {
    if (!selectedScenario || selectedScenario === "__new_scenario__") return;
    try {
      const list = await Rest.get("/forecast/scenarios?activeOnly=false");
      const all = list?.data || [];
      setRows(all);

      const me = all.find((r) => r.name === selectedScenario);
      if (!me?.parent_scenario_id) {
        setOverrides([]);
        return;
      }

      const baseName = all.find((r) => r.id === me.parent_scenario_id)?.name || "";
      const [ov, mods, items] = await Promise.all([
        Rest.get(`/forecast/scenarios/${me.id}/overrides`),
        Rest.get(`/forecast/modules?scenario=${encodeURIComponent(baseName)}`),
        Rest.get(`/forecast/incomeexpense?scenario=${encodeURIComponent(baseName)}`),
      ]);

      // The overrides key on the BASE row's id, so keep the whole base row: the panel shows what a
      // field WAS as well as what it is now — "Growth 1 → 2" is the sentence the owner wants; a
      // bare "2" makes them go and look the base up.
      // These payloads spread the raw row alongside the PascalCase form fields, so the snake_case
      // columns the patch is keyed by are readable straight off them.
      const moduleRows = {};
      for (const m of mods?.data || []) moduleRows[m.id] = m;
      const itemRows = {};
      for (const i of items?.entries || []) itemRows[i.id] = i;

      setNames({ modules: moduleRows, incexp: itemRows });
      setOverrides(ov?.data || []);
      setError("");
    } catch (e) {
      setError(e.message || "Failed to load variant information");
    }
  }, [selectedScenario]);

  useEffect(() => {
    load();
  }, [load]);

  const createVariant = async () => {
    const name = newName.trim();
    if (!scenario || !name) return;
    setBusy(true);
    try {
      await Rest.post(`/forecast/scenarios/${scenario.id}/variant`, { name });
      setNewName("");
      setCreating(false);
      setError("");
      await load();
      if (onChanged) onChanged();
    } catch (e) {
      setError(e.message || "Failed to create the variant");
    } finally {
      setBusy(false);
    }
  };

  const revert = async (override, field = null) => {
    setBusy(true);
    try {
      const query = field ? `?field=${encodeURIComponent(field)}` : "";
      await Rest.del(
        `/forecast/scenarios/${scenario.id}/overrides/${override.entity_type}/${override.base_entity_id}${query}`
      );
      await load();
      if (onChanged) onChanged();
    } catch (e) {
      setError(e.message || "Failed to revert");
    } finally {
      setBusy(false);
    }
  };

  const detach = async () => {
    setBusy(true);
    try {
      await Rest.post(`/forecast/scenarios/${scenario.id}/detach`);
      await load();
      if (onChanged) onChanged();
    } catch (e) {
      setError(e.message || "Failed to detach");
    } finally {
      setBusy(false);
    }
  };

  if (!scenario) return null;

  const baseRowOf = (o) =>
    (o.entity_type === "module" ? names.modules : names.incexp)[o.base_entity_id] || null;

  const label = (o) =>
    o.entity_type === "assumption"
      ? fieldLabel("assumption", o.entity_key)
      : baseRowOf(o)?.Name || `#${o.base_entity_id}`;

  /** What the field was in the base, so each row reads "was → now". */
  const baseValueOf = (o, field) => {
    if (o.entity_type === "assumption") return undefined;
    const row = baseRowOf(o);
    if (!row) return undefined;
    if (isScheduleField(field)) {
      const list =
        field === "income_pct" ? row.IncomePct
        : field === "investments" ? row.Invest
        : field === "disposals" ? row.Dispose
        : field === "changes" ? row.Changes
        : null;
      return Array.isArray(list) ? list : undefined;
    }
    return row[field];
  };

  return (
    <section className="fc-variant-panel" aria-label="Scenario lineage and overrides">
      <header className="fc-variant-panel__header">
        <h3 className="fc-variant-panel__title">
          <GitBranch size={16} aria-hidden="true" />
          {base ? `Variant of "${base.name}"` : "Scenario lineage"}
        </h3>

        {base ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={detach}
            disabled={busy}
            title="Promote this variant to a standalone scenario: keep every resolved value, drop the link to the base. Changes in the base will no longer reach it."
          >
            <Scissors size={14} aria-hidden="true" /> Detach from base
          </button>
        ) : creating ? (
          <span className="fc-variant-panel__create">
            <input
              className="form-input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. 2026 Downside"
              aria-label="Name for the new variant"
            />
            <button type="button" className="btn btn--primary btn--sm" onClick={createVariant} disabled={busy || !newName.trim()}>
              Create
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setCreating(false)} disabled={busy}>
              Cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={() => setCreating(true)}
            disabled={busy}
            title="A variant inherits everything from this scenario. Change one module or expense in it and everything else keeps following the base — including future changes."
          >
            <GitBranch size={14} aria-hidden="true" /> Create variant of this scenario
          </button>
        )}
      </header>

      {error && <p className="fc-variant-panel__error">{error}</p>}

      {!base && children.length > 0 && (
        <p className="fc-variant-panel__note">
          This scenario is the base for {children.map((c) => `"${c.name}"`).join(", ")}. Anything
          you change here flows into {children.length > 1 ? "them" : "it"}, except where overridden.
        </p>
      )}

      {base && (
        <>
          <p className="fc-variant-panel__note">
            Everything below is what makes this scenario different from{" "}
            <strong>{base.name}</strong>. Everything <em>not</em> listed is inherited — including
            changes you make to the base later.
          </p>

          {overrides.length === 0 ? (
            <p className="fc-variant-panel__empty">
              No overrides yet — this is an exact twin of {base.name}. Edit a module or an expense
              and the change is recorded here instead of being copied.
            </p>
          ) : (
            <ul className="fc-variant-panel__list">
              {overrides.map((o) => {
                const fields = Object.keys(o.patch || {});
                return (
                  <li key={o.id} className="fc-variant-panel__item">
                    <div className="fc-variant-panel__item-head">
                      <span className="fc-variant-panel__entity">{label(o)}</span>
                      <span className="fc-variant-panel__count">
                        {o.is_deleted
                          ? "hidden in this variant"
                          : `${fields.length} ${fields.length === 1 ? "change" : "changes"}`}
                      </span>
                      {o.entity_type !== "assumption" && (
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => revert(o)}
                          disabled={busy}
                          title={`Revert everything on "${label(o)}" back to ${base.name}`}
                        >
                          <X size={13} aria-hidden="true" /> Revert all
                        </button>
                      )}
                    </div>

                    {!o.is_deleted && fields.length > 0 && (
                      // Read as a sentence: the field, what the base says, what this variant says.
                      // A bare new value would send the reader off to look the base up.
                      <table className="fc-variant-panel__changes">
                        <thead>
                          <tr>
                            <th scope="col">Field</th>
                            <th scope="col">{base.name}</th>
                            <th scope="col">This variant</th>
                            <th scope="col" aria-label="Revert" />
                          </tr>
                        </thead>
                        <tbody>
                          {fields.map((field) => {
                            const was = baseValueOf(o, field);
                            const now = o.patch[field];
                            return (
                              <tr key={field}>
                                <th scope="row">{fieldLabel(o.entity_type, field)}</th>
                                <td className="fc-variant-panel__was">
                                  {was === undefined ? "—" : formatFieldValue(was)}
                                </td>
                                <td className="fc-variant-panel__now">{formatFieldValue(now)}</td>
                                <td className="fc-variant-panel__revert-cell">
                                  {o.entity_type !== "assumption" && (
                                    <button
                                      type="button"
                                      className="fc-variant-panel__revert-field"
                                      onClick={() => revert(o, field)}
                                      disabled={busy}
                                      aria-label={`Revert ${fieldLabel(o.entity_type, field)} on ${label(o)} to the ${base.name} value`}
                                      title={`Revert ${fieldLabel(o.entity_type, field)} to ${base.name}`}
                                    >
                                      <X size={13} aria-hidden="true" />
                                    </button>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

FCVariantPanel.propTypes = {
  selectedScenario: PropTypes.string,
  onChanged: PropTypes.func,
};
