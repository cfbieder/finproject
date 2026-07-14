import PropTypes from "prop-types";
import "./FCInheritanceBadge.css";

/**
 * CR050 — where a row in a VARIANT came from.
 *
 * A variant inherits every item from its base unless the item is overridden, so on a variant's
 * Modules / Expenses list the question "is this mine or Base's?" has to be answerable at a glance:
 *
 *   Inherited   — comes from the base; a change in the base flows straight through
 *   Overridden  — pinned in this variant (the tooltip names the fields; the rest still inherit)
 *   Local       — added in this variant; the base has never heard of it
 *
 * Renders nothing on a plain scenario (`inheritance` is null there), so the base's own pages look
 * exactly as they did before.
 */
export default function FCInheritanceBadge({ inheritance }) {
  if (!inheritance) return null;

  const { status, fields = [] } = inheritance;
  const label = {
    inherited: "INHERITED",
    overridden: `OVERRIDDEN${fields.length ? ` ${fields.length}` : ""}`,
    local: "LOCAL",
    hidden: "HIDDEN",
  }[status];
  if (!label) return null;

  const title = {
    inherited: "Inherited from the base scenario — a change there flows through to here.",
    overridden: fields.length
      ? `Overridden in this variant: ${fields.join(", ")}. Every other field still inherits from the base.`
      : "Overridden in this variant.",
    local: "Added in this variant only — the base scenario does not have it.",
    hidden: "Hidden in this variant — it exists in the base, but not here.",
  }[status];

  return (
    <span
      className={`fc-inheritance-badge fc-inheritance-badge--${status}`}
      title={title}
    >
      {label}
    </span>
  );
}

FCInheritanceBadge.propTypes = {
  inheritance: PropTypes.shape({
    status: PropTypes.oneOf(["inherited", "overridden", "local", "hidden"]),
    fields: PropTypes.arrayOf(PropTypes.string),
  }),
};
