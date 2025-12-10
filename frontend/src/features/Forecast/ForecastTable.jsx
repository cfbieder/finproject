import { useEffect, useMemo, useState } from "react";
import Rest from "../../js/rest.js";

const normalizeName = (value) =>
  typeof value === "string" ? value.trim() : "";

const addNetCashFlowCategory = (nodes) => {
  if (!Array.isArray(nodes)) {
    return [];
  }

  let incomeTotal = 0;
  let expenseTotal = 0;
  let hasNetCashFlow = false;

  const result = nodes.map((node) => {
    if (!node || typeof node !== "object") {
      return node;
    }

    const name = typeof node.name === "string" ? node.name : "";
    const normalized = name.toLowerCase();

    if (normalized === "income") {
      incomeTotal = typeof node.total === "number" ? node.total : 0;
    } else if (normalized === "expense" || normalized === "expenses") {
      expenseTotal = typeof node.total === "number" ? node.total : 0;
    } else if (normalized === "net cash flow") {
      hasNetCashFlow = true;
    }

    return node;
  });

  if (hasNetCashFlow) {
    return result;
  }

  return [
    ...result,
    { name: "Net cash flow", total: incomeTotal + expenseTotal },
  ];
};

const buildValueMapFromReport = (nodes) => {
  const map = new Map();
  const traverse = (list) => {
    if (!Array.isArray(list)) return;
    for (const node of list) {
      if (!node || typeof node !== "object") continue;
      const name = normalizeName(node.name);
      if (name) {
        const total = Number.isFinite(node.total) ? node.total : 0;
        map.set(name, (map.get(name) || 0) + total);
      }
      if (Array.isArray(node.children) && node.children.length) {
        traverse(node.children);
      }
    }
  };
  traverse(nodes);
  return map;
};

const parsePeriodLabel = (label) => {
  const normalized = normalizeName(label);
  const match = normalized.match(/^([0-9]{4})(?:\s*\((.)\))?/);
  const year = match ? Number.parseInt(match[1], 10) : null;
  const type = match && match[2] ? match[2] : "";
  return { label: normalized, year: Number.isFinite(year) ? year : null, type };
};

const buildRowYearKey = (label, year) => `${normalizeName(label)}::${year}`;

const numberFormatter = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const formatNumberDisplay = (value) => {
  if (!Number.isFinite(value)) {
    return { text: "-", isNegative: false };
  }
  const isNegative = value < 0;
  const formatted = numberFormatter.format(Math.abs(value));
  return { text: isNegative ? `(${formatted})` : formatted, isNegative };
};

export default function ForecastTable({
  periodLabels = [],
  profitLossRows = [],
  netCashFlowValues = [],
  onPeriodDoubleClick,
  includeUnrealizedGL = false,
}) {
  const periods = useMemo(
    () => periodLabels.map((label) => parsePeriodLabel(label)),
    [periodLabels]
  );

  const [actualValuesByRowYear, setActualValuesByRowYear] = useState(
    () => new Map()
  );

  useEffect(() => {
    let isMounted = true;

    const loadActuals = async () => {
      const uniqueYears = Array.from(
        new Set(
          periods
            .filter(
              (period) => period.type === "A" && Number.isFinite(period.year)
            )
            .map((period) => period.year)
        )
      );

      if (!uniqueYears.length) {
        if (isMounted) {
          setActualValuesByRowYear(new Map());
        }
        return;
      }

      const results = await Promise.all(
        uniqueYears.map(async (year) => {
          try {
            const fromDate = `${year}-01-01`;
            const toDate = `${year}-12-31`;
            const report = await Rest.fetchCashFlowReport({
              fromDate,
              toDate,
              transfers: "exclude",
              includeUnrealizedGL,
            });
            const normalizedReport = addNetCashFlowCategory(
              Array.isArray(report) ? report : []
            );
            const valueMap = buildValueMapFromReport(normalizedReport);
            return { year, valueMap };
          } catch (error) {
            console.error(
              "[ForecastTable] Failed to fetch cash flow report for year",
              year,
              error
            );
            return { year, valueMap: new Map() };
          }
        })
      );

      if (!isMounted) return;

      const combined = new Map();
      results.forEach(({ year, valueMap }) => {
        valueMap.forEach((total, label) => {
          combined.set(buildRowYearKey(label, year), total);
        });
      });
      setActualValuesByRowYear(combined);
    };

    loadActuals();

    return () => {
      isMounted = false;
    };
  }, [periods, includeUnrealizedGL]);

  const getActualValue = (label, year) =>
    actualValuesByRowYear.get(buildRowYearKey(label, year));

  return (
    <div className="trans-budget-table-wrapper">
      <table className="trans-budget-table">
        <thead>
          <tr>
            <th>Profit &amp; Loss Account</th>
            {periods.map((period, index) => (
              <th
                key={period.label || index}
                onDoubleClick={() => onPeriodDoubleClick?.(index)}
                style={{
                  cursor: "pointer",
                  borderLeft: "1px solid #e5e7eb",
                }}
              >
                {period.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {profitLossRows.map((row, index) => (
            <tr key={`${row.label}-${index}`}>
              <td
                style={{
                  paddingLeft: `${row.depth * 18 + 10}px`,
                  fontWeight: row.isGroup ? 700 : 500,
                }}
              >
                {row.label}
              </td>
              {periods.map((period) => {
                const actualValue =
                  period.type === "A" && Number.isFinite(period.year)
                    ? getActualValue(row.label, period.year)
                    : null;
                const { text, isNegative } = formatNumberDisplay(actualValue);
                return (
                  <td
                    key={`${row.label}-${period.label || period.year}-${index}`}
                    style={{
                      textAlign: "right",
                      borderLeft: "1px solid #e5e7eb",
                      color: isNegative ? "#b91c1c" : undefined,
                    }}
                  >
                    {text}
                  </td>
                );
              })}
            </tr>
          ))}
          {periods.length > 0 && (
            <tr>
              <td style={{ paddingLeft: "10px", fontWeight: 700 }}>
                Net Cash Flow
              </td>
              {periods.map((period, index) => {
                const income =
                  period.type === "A" && Number.isFinite(period.year)
                    ? getActualValue("Income", period.year)
                    : null;
                const expense =
                  period.type === "A" && Number.isFinite(period.year)
                    ? getActualValue("Expense", period.year)
                    : null;
                const value =
                  period.type === "A" &&
                  (typeof income === "number" || typeof expense === "number")
                    ? (income || 0) + (expense || 0)
                    : netCashFlowValues[index];
                const { text, isNegative } = formatNumberDisplay(value);
                return (
                  <td
                    key={`net-cash-flow-${period.label || index}`}
                    style={{
                      textAlign: "right",
                      borderLeft: "1px solid #e5e7eb",
                      color: isNegative ? "#b91c1c" : undefined,
                    }}
                  >
                    {text}
                  </td>
                );
              })}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
