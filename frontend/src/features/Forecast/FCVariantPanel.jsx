import { useCallback, useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { GitBranch, RotateCcw, Scissors } from "lucide-react";
import Rest from "../../js/rest.js";
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

      const [ov, mods, items] = await Promise.all([
        Rest.get(`/forecast/scenarios/${me.id}/overrides`),
        Rest.get(`/forecast/modules?scenario=${encodeURIComponent(all.find((r) => r.id === me.parent_scenario_id)?.name || "")}`),
        Rest.get(`/forecast/incomeexpense?scenario=${encodeURIComponent(all.find((r) => r.id === me.parent_scenario_id)?.name || "")}`),
      ]);

      // The overrides key on the BASE row's id, so resolve those ids to names for display.
      const moduleNames = {};
      for (const m of mods?.data || []) moduleNames[m.id] = m.Name;
      const itemNames = {};
      for (const i of items?.entries || []) itemNames[i.id] = i.Name;

      setNames({ modules: moduleNames, incexp: itemNames });
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

  const label = (o) =>
    o.entity_type === "assumption"
      ? o.entity_key
      : (o.entity_type === "module" ? names.modules : names.incexp)[o.base_entity_id] ||
        `#${o.base_entity_id}`;

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
              {overrides.map((o) => (
                <li key={o.id} className="fc-variant-panel__item">
                  <div className="fc-variant-panel__item-head">
                    <span className="fc-variant-panel__entity">{label(o)}</span>
                    {o.is_deleted ? (
                      <span className="fc-variant-panel__tag fc-variant-panel__tag--hidden">
                        hidden in this variant
                      </span>
                    ) : null}
                    {o.entity_type !== "assumption" && (
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => revert(o)}
                        disabled={busy}
                        title={`Revert everything on "${label(o)}" back to ${base.name}`}
                      >
                        <RotateCcw size={13} aria-hidden="true" /> Revert all
                      </button>
                    )}
                  </div>

                  {!o.is_deleted && (
                    <div className="fc-variant-panel__fields">
                      {Object.entries(o.patch || {}).map(([field, value]) => (
                        <span key={field} className="fc-variant-panel__field">
                          <code>{field}</code>
                          <span className="fc-variant-panel__value">
                            {Array.isArray(value) ? `${value.length} row(s)` : String(value)}
                          </span>
                          {o.entity_type !== "assumption" && (
                            <button
                              type="button"
                              className="fc-variant-panel__revert-field"
                              onClick={() => revert(o, field)}
                              disabled={busy}
                              aria-label={`Revert ${field} on ${label(o)} to the base value`}
                              title={`Revert only ${field} to ${base.name}`}
                            >
                              <RotateCcw size={12} aria-hidden="true" />
                            </button>
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              ))}
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
