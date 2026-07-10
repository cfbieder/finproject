/**
 * FCCompareTable (CR040) — delta grid for two forecast scenarios.
 *
 * Renders the Review page's row structure (P&L by FC Line + balance sheet)
 * over the union of both scenarios' forecast years. Cells show Δ (B − A),
 * A, or B depending on the display mode; clicking a row expands it into
 * A / B / Δ sub-rows for that line.
 */
import { useState } from "react";
import { formatAmount } from "./utils/fcReviewUtils.js";

const SECTION_TITLES = {
  cash: "Cash Flow Summary",
  balance: "Balance Sheet",
};

function sectionOf(row) {
  return row.section === "cash" ? "cash" : "balance";
}

function DeltaCell({ value, mode }) {
  const num = Number(value);
  const cls =
    mode === "delta" && Number.isFinite(num) && num !== 0
      ? num > 0
        ? "fc-compare-cell--pos"
        : "fc-compare-cell--neg"
      : Number.isFinite(num) && num < 0
      ? "fc-compare-cell--neg"
      : "";
  return (
    <td className={`trans-budget-table__value--numeric ${cls}`}>
      {formatAmount(value)}
    </td>
  );
}

export default function FCCompareTable({
  compare,
  nameA,
  nameB,
  mode, // "delta" | "a" | "b"
  hideUnchanged,
}) {
  const [expanded, setExpanded] = useState(() => new Set());

  if (!compare || !compare.years.length) return null;
  const { years, rows } = compare;

  const toggleRow = (key) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const isUnchanged = (row) =>
    row.delta.every((d) => d == null || Math.abs(d) < 0.005);

  let currentSection = null;

  return (
    <section className="section-table">
      <div className="section-table__content">
        <div className="trans-budget-table-wrapper fc-compare-table-wrapper">
          <table className="trans-budget-table fc-compare-table">
            <thead>
              <tr>
                <th className="fc-compare-table__label-col">Account</th>
                {years.map((year) => (
                  <th key={year} className="trans-budget-table__value">
                    {year}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const section = sectionOf(row);
                const sectionHeader =
                  section !== currentSection ? (
                    <tr
                      key={`section-${section}`}
                      className="fc-compare-section-row"
                    >
                      <td colSpan={years.length + 1}>
                        {SECTION_TITLES[section]}
                      </td>
                    </tr>
                  ) : null;
                currentSection = section;

                if (
                  hideUnchanged &&
                  row.level === 2 &&
                  !row.derived &&
                  isUnchanged(row)
                ) {
                  return sectionHeader;
                }

                const key = `${row.section}:${row.label}`;
                const isOpen = expanded.has(key);
                const values =
                  mode === "a" ? row.a : mode === "b" ? row.b : row.delta;

                return (
                  <FragmentRow
                    key={key}
                    sectionHeader={sectionHeader}
                    row={row}
                    values={values}
                    mode={mode}
                    isOpen={isOpen}
                    onToggle={() => toggleRow(key)}
                    nameA={nameA}
                    nameB={nameB}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="fc-compare-table-note">
          {mode === "delta"
            ? `Cells show the difference “${nameB}” − “${nameA}”. Click a row to see both scenarios' values.`
            : `Cells show “${mode === "a" ? nameA : nameB}”. Click a row to see both scenarios and the difference.`}
        </div>
      </div>
    </section>
  );
}

function FragmentRow({
  sectionHeader,
  row,
  values,
  mode,
  isOpen,
  onToggle,
  nameA,
  nameB,
}) {
  const levelClass =
    row.level === 1
      ? "fc-compare-row--level1"
      : "fc-compare-row--level2";

  return (
    <>
      {sectionHeader}
      <tr
        className={`fc-compare-row ${levelClass} ${isOpen ? "fc-compare-row--open" : ""}`}
        onClick={onToggle}
        title="Click to expand A / B / Δ"
      >
        <td className="fc-compare-table__label-col">{row.label}</td>
        {values.map((v, i) => (
          <DeltaCell key={i} value={v} mode={mode} />
        ))}
      </tr>
      {isOpen && (
        <>
          <tr className="fc-compare-subrow">
            <td className="fc-compare-table__label-col">A · {nameA}</td>
            {row.a.map((v, i) => (
              <DeltaCell key={i} value={v} mode="a" />
            ))}
          </tr>
          <tr className="fc-compare-subrow">
            <td className="fc-compare-table__label-col">B · {nameB}</td>
            {row.b.map((v, i) => (
              <DeltaCell key={i} value={v} mode="b" />
            ))}
          </tr>
          <tr className="fc-compare-subrow fc-compare-subrow--delta">
            <td className="fc-compare-table__label-col">Δ (B − A)</td>
            {row.delta.map((v, i) => (
              <DeltaCell key={i} value={v} mode="delta" />
            ))}
          </tr>
        </>
      )}
    </>
  );
}
