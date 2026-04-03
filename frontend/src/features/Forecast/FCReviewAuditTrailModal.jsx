import { useEffect, useMemo, useRef } from "react";
import PropTypes from "prop-types";

/**
 * Formats a numeric value for display.
 * - No decimal places
 * - Negative numbers shown in red with brackets
 * - Non-numeric values returned as-is
 */
const formatNumber = (value) => {
  const num = Number(value);
  if (isNaN(num)) {
    return value;
  }

  const absValue = Math.abs(num);
  const formatted = absValue.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

  return num < 0 ? `(${formatted})` : formatted;
};

/**
 * Determines if a column header represents a numeric field
 */
const isNumericColumn = (header) => {
  // Check if header is a year (4-digit number)
  if (/^\d{4}$/.test(header)) {
    return true;
  }

  // Check for common numeric keywords
  const numericHeaders = [
    "amount",
    "value",
    "total",
    "balance",
    "quantity",
    "price",
    "cost",
    "revenue",
    "expense",
    "income",
    "tax",
    "rate",
    "percent",
    "count",
  ];
  return numericHeaders.some((keyword) =>
    header.toLowerCase().includes(keyword)
  );
};

export default function FCReviewAuditTrailModal({ auditModal, onClose }) {
  if (!auditModal?.isOpen) {
    return null;
  }

  const { title, headers = [], rows = [], loading, error } = auditModal;
  const topScrollRef = useRef(null);
  const topScrollInnerRef = useRef(null);
  const tableScrollRef = useRef(null);

  const yearHeaders = useMemo(
    () => headers.filter((header) => /^\d{4}$/.test(header)),
    [headers]
  );

  const filteredRows = useMemo(() => {
    if (!yearHeaders.length) {
      return rows;
    }

    return rows.filter((row) =>
      yearHeaders.some((year) => {
        const value = Number(row[year] ?? 0);
        return !Number.isNaN(value) && value !== 0;
      })
    );
  }, [rows, yearHeaders]);

  const hasData = headers.length > 0 && filteredRows.length > 0;

  useEffect(() => {
    const topScroll = topScrollRef.current;
    const topInner = topScrollInnerRef.current;
    const tableScroll = tableScrollRef.current;
    if (!topScroll || !topInner || !tableScroll) {
      return;
    }

    const syncScroll = (source, target) => {
      if (target.scrollLeft !== source.scrollLeft) {
        target.scrollLeft = source.scrollLeft;
      }
    };

    const handleTopScroll = () => syncScroll(topScroll, tableScroll);
    const handleTableScroll = () => syncScroll(tableScroll, topScroll);

    topScroll.addEventListener("scroll", handleTopScroll);
    tableScroll.addEventListener("scroll", handleTableScroll);

    topInner.style.width = `${tableScroll.scrollWidth}px`;

    return () => {
      topScroll.removeEventListener("scroll", handleTopScroll);
      tableScroll.removeEventListener("scroll", handleTableScroll);
    };
  }, [headers, filteredRows]);

  return (
    <div
      className="trans-budget-edit-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Audit trail details"
      style={{
        backdropFilter: "blur(3px)",
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem 0",
      }}
    >
      <div
        className="trans-budget-edit-modal"
        style={{
          width: "min(1100px, 96vw)",
          maxHeight: "75vh",
          overflowY: "auto",
          boxShadow:
            "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
          borderRadius: "8px",
          marginTop: "auto",
          marginBottom: "auto",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: "1rem",
            paddingBottom: "1rem",
            borderBottom: "2px solid var(--border, #e5e7eb)",
            marginBottom: "1.25rem",
          }}
        >
          <div>
            <p
              style={{
                margin: 0,
                fontSize: "0.75rem",
                color: "var(--muted)",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                fontWeight: 700,
              }}
            >
              Audit Trail
            </p>
            <h3
              style={{
                margin: "0.35rem 0 0",
                color: "var(--ink)",
                fontSize: "1.25rem",
                fontWeight: 600,
              }}
            >
              {title || "Module entries"}
            </h3>
          </div>
          <button
            type="button"
            className="generate-report-button"
            onClick={onClose}
            style={{
              padding: "0.5rem 1rem",
              fontSize: "0.875rem",
              fontWeight: 600,
            }}
          >
            Close
          </button>
        </div>

        {/* Content */}
        {loading ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "3rem 1rem",
              color: "var(--muted)",
            }}
          >
            <div style={{ textAlign: "center" }}>
              <div
                style={{
                  width: "40px",
                  height: "40px",
                  border: "3px solid var(--border, #e5e7eb)",
                  borderTopColor: "var(--primary, #7FA37F)",
                  borderRadius: "50%",
                  animation: "spin 1s linear infinite",
                  margin: "0 auto 1rem",
                }}
              />
              <p style={{ margin: 0, fontWeight: 600 }}>
                Loading audit trail...
              </p>
            </div>
          </div>
        ) : error ? (
          <div
            style={{
              padding: "2rem 1rem",
              textAlign: "center",
              backgroundColor: "rgba(239, 68, 68, 0.05)",
              borderRadius: "6px",
              border: "1px solid rgba(239, 68, 68, 0.2)",
            }}
          >
            <p
              style={{
                margin: 0,
                color: "var(--danger)",
                fontWeight: 600,
                fontSize: "0.95rem",
              }}
            >
              {error}
            </p>
          </div>
        ) : hasData ? (
          <div>
            <div
              style={{
                marginBottom: "0.75rem",
                fontSize: "0.875rem",
                color: "var(--muted)",
                fontWeight: 600,
              }}
            >
              {filteredRows.length}{" "}
              {filteredRows.length === 1 ? "entry" : "entries"}
            </div>
            <div
              ref={topScrollRef}
              style={{
                overflowX: "auto",
                overflowY: "hidden",
                marginBottom: "0.5rem",
              }}
            >
              <div
                ref={topScrollInnerRef}
                style={{ height: "1px", width: "100%" }}
              />
            </div>
            <div
              ref={tableScrollRef}
              style={{
                overflowX: "auto",
                border: "1px solid var(--border, #e5e7eb)",
                borderRadius: "6px",
              }}
            >
              <table
                className="trans-budget-table"
                style={{
                  marginBottom: 0,
                  borderRadius: "6px",
                  overflow: "hidden",
                }}
              >
                <thead>
                  <tr
                    style={{
                      backgroundColor: "var(--background-secondary, #f9fafb)",
                    }}
                  >
                    {headers.map((header) => {
                      const isNumeric = isNumericColumn(header);
                      return (
                        <th
                          key={header}
                          style={{
                            textAlign: isNumeric ? "right" : "left",
                            whiteSpace: "nowrap",
                            padding: "0.75rem 1rem",
                            fontSize: "0.8rem",
                            fontWeight: 700,
                            letterSpacing: "0.05em",
                            textTransform: "uppercase",
                            color: "var(--muted)",
                            borderBottom: "2px solid var(--border, #e5e7eb)",
                          }}
                        >
                          {header}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row, rowIndex) => (
                    <tr
                      key={`${rowIndex}-${title || "audit"}`}
                      style={{
                        backgroundColor:
                          rowIndex % 2 === 0
                            ? "white"
                            : "var(--background-alt, #f9fafb)",
                        transition: "background-color 0.15s ease",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor =
                          "var(--background-hover, #f3f4f6)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor =
                          rowIndex % 2 === 0
                            ? "white"
                            : "var(--background-alt, #f9fafb)";
                      }}
                    >
                      {headers.map((header) => {
                        const cellValue = row[header] ?? "-";
                        const isNumericHeader = isNumericColumn(header);
                        const numValue = Number(cellValue);
                        const isActuallyNumeric =
                          !isNaN(numValue) &&
                          cellValue !== "" &&
                          cellValue !== "-";
                        const isNegative = isActuallyNumeric && numValue < 0;
                        const shouldFormat =
                          isNumericHeader && isActuallyNumeric;

                        return (
                          <td
                            key={`${rowIndex}-${header}`}
                            style={{
                              textAlign: shouldFormat ? "right" : "left",
                              padding: "0.75rem 1rem",
                              fontSize: "0.9rem",
                              color: isNegative
                                ? "var(--danger, #C0504D)"
                                : "var(--ink)",
                              fontWeight: shouldFormat ? 600 : 400,
                              fontVariantNumeric: "tabular-nums",
                            }}
                          >
                            {shouldFormat ? formatNumber(cellValue) : cellValue}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div
            style={{
              padding: "2rem 1rem",
              textAlign: "center",
              backgroundColor: "var(--background-alt, #f9fafb)",
              borderRadius: "6px",
            }}
          >
            <p
              style={{
                margin: 0,
                color: "var(--muted)",
                fontWeight: 600,
                fontSize: "0.95rem",
              }}
            >
              No audit trail data found for this module.
            </p>
          </div>
        )}
      </div>

      {/* Add CSS animation for loading spinner */}
      <style>{`
        @keyframes spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
}

FCReviewAuditTrailModal.propTypes = {
  auditModal: PropTypes.shape({
    isOpen: PropTypes.bool,
    title: PropTypes.string,
    headers: PropTypes.arrayOf(PropTypes.string),
    rows: PropTypes.arrayOf(PropTypes.object),
    loading: PropTypes.bool,
    error: PropTypes.string,
  }),
  onClose: PropTypes.func,
};
