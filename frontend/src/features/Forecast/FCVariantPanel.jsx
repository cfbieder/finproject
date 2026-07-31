import { useCallback, useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { ChevronDown, ChevronRight, GitBranch, Scissors, X } from "lucide-react";
import Rest from "../../js/rest.js";
import { fieldLabel, isScheduleField, formatFieldValue, formatSchedule, formatAssumptionValue } from "./fcFieldLabels.js";
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
export default function FCVariantPanel({ selectedScenario, onChanged, onSelectScenario }) {
  const [rows, setRows] = useState([]);
  const [overrides, setOverrides] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  // The children's override sets, keyed by scenario id. Fetched lazily on expand — one request per
  // variant, which is not worth paying on every page load for a table that starts collapsed.
  const [childOverrides, setChildOverrides] = useState({});
  const [childrenOpen, setChildrenOpen] = useState(false);
  const [childrenLoading, setChildrenLoading] = useState(false);

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

      const ov = await Rest.get(`/forecast/scenarios/${me.id}/overrides`);
      setOverrides(ov?.data || []);
      setError("");
    } catch (e) {
      setError(e.message || "Failed to load variant information");
    }
  }, [selectedScenario]);

  useEffect(() => {
    load();
  }, [load]);

  // A summary carried over from the previously selected base would be read as this one's.
  useEffect(() => {
    setChildrenOpen(false);
    setChildOverrides({});
  }, [selectedScenario]);

  const loadChildOverrides = useCallback(async (list) => {
    if (list.length === 0) return;
    setChildrenLoading(true);
    try {
      const pairs = await Promise.all(
        list.map(async (child) => {
          const res = await Rest.get(`/forecast/scenarios/${child.id}/overrides`);
          return [child.id, res?.data || []];
        })
      );
      setChildOverrides(Object.fromEntries(pairs));
      setError("");
    } catch (e) {
      setError(e.message || "Failed to load what the variants change");
    } finally {
      setChildrenLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!childrenOpen) return;
    loadChildOverrides(children);
  }, [childrenOpen, children, loadChildOverrides]);

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
      ? fieldLabel("assumption", o.entity_key)
      : o.base?.name || `#${o.base_entity_id}`;

  /**
   * What the field was in the base, so each row reads "was → now". Taken from `o.base`, which the
   * server sends WITH the override — the modules list carries no schedules, so reading the base
   * off it showed "—" for a yield-spread change and hid the number that was actually edited.
   */
  const baseValueOf = (o, field) => {
    if (o.entity_type === "assumption" || !o.base) return undefined;
    return isScheduleField(field) ? o.base.schedules?.[field] : o.base.values?.[field];
  };

  /**
   * A variant's overrides compressed to the phrases that answer "what makes it different" —
   * "Sarasota House — Cost Basis, Growth (x Inflation)". A bare count says something changed but not
   * what, and what is the only reason to open the table.
   */
  const changeSummary = (list) =>
    (list || []).map((o) => {
      if (o.entity_type === "assumption") return fieldLabel("assumption", o.entity_key);
      const name = o.base?.name || `#${o.base_entity_id}`;
      if (o.is_deleted) return `${name} (hidden)`;
      const fields = Object.keys(o.patch || {}).map((f) => fieldLabel(o.entity_type, f));
      return fields.length ? `${name} — ${fields.join(", ")}` : name;
    });

  /** Fields changed, counted the same way the variant's own list counts them. */
  const changeCount = (list) =>
    (list || []).reduce(
      (n, o) =>
        n + (o.entity_type === "assumption" || o.is_deleted ? 1 : Object.keys(o.patch || {}).length),
      0
    );

  // A scenario standing on its own stays visually plain; one that sits in a lineage is tinted, so
  // "this is not a free-standing set of assumptions" is legible before a word is read.
  const hasLineage = !!base || children.length > 0;

  return (
    <section
      className={`fc-variant-panel${hasLineage ? " fc-variant-panel--lineage" : ""}`}
      aria-label="Scenario lineage and overrides"
    >
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
        <div className="fc-variant-panel__children">
          <p className="fc-variant-panel__note">
            This scenario is the base for {children.length}{" "}
            {children.length > 1 ? "variants" : "variant"}. Anything you change here flows into{" "}
            {children.length > 1 ? "them" : "it"}, except where overridden.
          </p>

          {/* Collapsed by default: on the base scenario this is reference, not the reason you came. */}
          <button
            type="button"
            className="fc-variant-panel__disclosure"
            onClick={() => setChildrenOpen((open) => !open)}
            aria-expanded={childrenOpen}
          >
            {childrenOpen ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
            {childrenOpen ? "Hide" : "Show"} what each variant changes
          </button>

          {childrenOpen && (
            <table className="fc-variant-panel__changes fc-variant-panel__children-table">
              <thead>
                <tr>
                  <th scope="col">Variant</th>
                  <th scope="col">Changes</th>
                  <th scope="col">What differs from {scenario.name}</th>
                </tr>
              </thead>
              <tbody>
                {children.map((child) => {
                  const list = childOverrides[child.id];
                  const parts = changeSummary(list);
                  return (
                    <tr key={child.id}>
                      <th scope="row">
                        {onSelectScenario ? (
                          <button
                            type="button"
                            className="fc-variant-panel__child-link"
                            onClick={() => onSelectScenario(child.name)}
                            title={`Switch to "${child.name}"`}
                          >
                            {child.name}
                          </button>
                        ) : (
                          child.name
                        )}
                      </th>
                      <td className="fc-variant-panel__was">
                        {list ? changeCount(list) : "—"}
                      </td>
                      <td>
                        {!list ? (
                          <span className="fc-variant-panel__was">
                            {childrenLoading ? "Loading…" : "—"}
                          </span>
                        ) : parts.length === 0 ? (
                          <span className="fc-variant-panel__was">
                            Nothing overridden — an exact twin of {scenario.name}
                          </span>
                        ) : (
                          <>
                            {parts.slice(0, 3).join("  ·  ")}
                            {/* "more ITEMS", because the Changes column counts FIELDS — a
                                bare "+1 more" beside a 7 reads as though four were hidden. */}
                            {parts.length > 3 &&
                              ` · +${parts.length - 3} more ${parts.length - 3 === 1 ? "item" : "items"}`}
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
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
                const isAssumption = o.entity_type === "assumption";
                // Normalize both shapes to the same rows: an assumption override is one row (the
                // whole FX / inflation / tax value); a module/item override is one row per field.
                const rows = isAssumption
                  ? [{
                      key: o.entity_key,
                      fieldName: fieldLabel("assumption", o.entity_key),
                      was: formatAssumptionValue(o.entity_key, o.base?.value),
                      now: formatAssumptionValue(o.entity_key, o.patch?.value),
                    }]
                  : Object.keys(o.patch || {}).map((field) => ({
                      key: field,
                      fieldName: fieldLabel(o.entity_type, field),
                      was: baseValueOf(o, field) === undefined
                        ? "—"
                        : isScheduleField(field)
                          ? formatSchedule(field, baseValueOf(o, field))
                          : formatFieldValue(baseValueOf(o, field)),
                      now: isScheduleField(field)
                        ? formatSchedule(field, o.patch[field])
                        : formatFieldValue(o.patch[field]),
                      revertable: true,
                    }));
                return (
                  <li key={o.id} className="fc-variant-panel__item">
                    <div className="fc-variant-panel__item-head">
                      <span className="fc-variant-panel__entity">
                        {isAssumption ? "Scenario assumption" : label(o)}
                      </span>
                      <span className="fc-variant-panel__count">
                        {o.is_deleted
                          ? "hidden in this variant"
                          : `${rows.length} ${rows.length === 1 ? "change" : "changes"}`}
                      </span>
                      {!isAssumption && (
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

                    {!o.is_deleted && rows.length > 0 && (
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
                          {rows.map((row) => (
                              <tr key={row.key}>
                                <th scope="row">{row.fieldName}</th>
                                <td className="fc-variant-panel__was">{row.was}</td>
                                <td className="fc-variant-panel__now">{row.now}</td>
                                <td className="fc-variant-panel__revert-cell">
                                  {row.revertable && (
                                    <button
                                      type="button"
                                      className="fc-variant-panel__revert-field"
                                      onClick={() => revert(o, row.key)}
                                      disabled={busy}
                                      aria-label={`Revert ${row.fieldName} on ${label(o)} to the ${base.name} value`}
                                      title={`Revert ${row.fieldName} to ${base.name}`}
                                    >
                                      <X size={13} aria-hidden="true" />
                                    </button>
                                  )}
                                </td>
                              </tr>
                          ))}
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
  onSelectScenario: PropTypes.func,
};
