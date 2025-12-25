/**
 * FCExpTableDetails - Detail panel for selected forecast entry
 *
 * Displays comprehensive information about the selected forecast entry including:
 * - Basic entry details (account, name, type, currency)
 * - Base values and dates
 * - Growth rate
 * - List of all periodic changes with formatting
 *
 * @component
 * @param {Object} props - Component props
 * @param {string} props.selectedScenario - Currently selected scenario
 * @param {Object} props.selectedEntry - The selected forecast entry
 * @param {Function} props.formatDate - Function to format date values
 * @param {Function} props.formatNumber - Function to format number values
 * @returns {JSX.Element} The entry details panel
 */
export default function FCExpTableDetails({
  selectedScenario,
  selectedEntry,
  formatDate,
  formatNumber,
}) {
  /**
   * Format change amount based on flag type
   * @param {number} amount - Amount value
   * @param {string} flag - Type flag ("Fixed $" or "Percent %")
   * @returns {string} Formatted amount string
   */
  const formatChangeAmount = (amount, flag) => {
    const num = Number(amount);
    if (!Number.isFinite(num)) return "—";
    if (flag === "Percent %") {
      return `${num.toFixed(2)}%`;
    }
    const abs = Math.abs(num).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return num < 0 ? `($${abs})` : `$${abs}`;
  };

  return (
    <section
      className="exp-setup-table section-table"
      aria-label="Income and expense details"
    >
      <div className="section-table__content">
        <h3>Income/Expense Details</h3>
        <div className="trans-budget-table-wrapper">
          {!selectedScenario ? (
            <p className="trans-budget-table__message">
              Select a scenario to view income/expense details.
            </p>
          ) : !selectedEntry ? (
            <p className="trans-budget-table__message">
              Choose an income/expense entry to see details.
            </p>
          ) : (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                  gap: "1rem 1.25rem",
                  padding: "0.5rem 0",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  <span style={{ fontSize: "0.75rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: "600" }}>Account</span>
                  <span style={{ fontSize: "1rem", fontWeight: "700", color: "var(--ink)" }}>{selectedEntry.Account || "—"}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  <span style={{ fontSize: "0.75rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: "600" }}>Name</span>
                  <span style={{ fontSize: "1rem", fontWeight: "700", color: "var(--ink)" }}>{selectedEntry.Name || "—"}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  <span style={{ fontSize: "0.75rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: "600" }}>Type</span>
                  <span style={{ fontSize: "1rem", fontWeight: "700", color: "var(--ink)" }}>{selectedEntry.Type || "—"}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  <span style={{ fontSize: "0.75rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: "600" }}>Currency</span>
                  <span style={{ fontSize: "1rem", fontWeight: "700", color: "var(--ink)" }}>{selectedEntry.Currency || "—"}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  <span style={{ fontSize: "0.75rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: "600" }}>Base Date</span>
                  <span style={{ fontSize: "1rem", fontWeight: "700", color: "var(--ink)" }}>{formatDate(selectedEntry.BaseDate)}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  <span style={{ fontSize: "0.75rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: "600" }}>Base Value</span>
                  <span style={{ fontSize: "1rem", fontWeight: "700", color: "var(--ink)" }}>{formatNumber(selectedEntry.BaseValue)}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  <span style={{ fontSize: "0.75rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: "600" }}>Base Value (USD)</span>
                  <span style={{ fontSize: "1rem", fontWeight: "700", color: "var(--primary)" }}>{formatNumber(selectedEntry.BaseValueUSD)}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  <span style={{ fontSize: "0.75rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: "600" }}>Growth Rate</span>
                  <span style={{ fontSize: "1rem", fontWeight: "700", color: "#059669" }}>
                    {typeof selectedEntry.Growth === "number"
                      ? `${selectedEntry.Growth.toFixed(2)}%`
                      : "—"}
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  <span style={{ fontSize: "0.75rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: "600" }}>Changes</span>
                  <span style={{ fontSize: "1rem", fontWeight: "700", color: "var(--ink)" }}>
                    {Array.isArray(selectedEntry.Changes)
                      ? selectedEntry.Changes.length
                      : 0}
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  <span style={{ fontSize: "0.75rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: "600" }}>Matched</span>
                  <span style={{
                    fontSize: "0.9rem",
                    fontWeight: "700",
                    padding: "0.25rem 0.65rem",
                    borderRadius: "0.4rem",
                    display: "inline-block",
                    width: "fit-content",
                    background: selectedEntry.Matched ? "rgba(16, 185, 129, 0.15)" : "rgba(100, 116, 139, 0.15)",
                    color: selectedEntry.Matched ? "#059669" : "var(--muted)"
                  }}>
                    {selectedEntry.Matched ? "Yes" : "No"}
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  <span style={{ fontSize: "0.75rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: "600" }}>Scenario</span>
                  <span style={{ fontSize: "1rem", fontWeight: "700", color: "var(--ink)" }}>{selectedEntry.Scenario || selectedScenario || "—"}</span>
                </div>
              </div>
              {!!(selectedEntry.Changes || []).length && (
                <div style={{
                  marginTop: "1.5rem",
                  padding: "1.25rem",
                  background: "linear-gradient(135deg, rgba(248, 250, 252, 0.8) 0%, rgba(241, 245, 249, 0.6) 100%)",
                  borderRadius: "0.85rem",
                  border: "1px solid rgba(37, 99, 235, 0.12)"
                }}>
                  <div style={{
                    fontSize: "0.8rem",
                    fontWeight: "800",
                    color: "var(--primary)",
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                    marginBottom: "1rem",
                    paddingBottom: "0.75rem",
                    borderBottom: "2px solid rgba(37, 99, 235, 0.15)"
                  }}>
                    Periodic Changes ({(selectedEntry.Changes || []).length})
                  </div>
                  <div style={{ display: "grid", gap: "0.75rem" }}>
                    {(selectedEntry.Changes || []).map((change, idx) => {
                      const formattedAmount = formatChangeAmount(
                        change?.Amount,
                        change?.Flag
                      );
                      const isNegative =
                        change?.Flag !== "Percent %" &&
                        Number(change?.Amount) < 0;
                      return (
                        <div
                          key={idx}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "auto 1fr auto",
                            gap: "1rem",
                            alignItems: "center",
                            padding: "0.85rem 1rem",
                            background: "white",
                            borderRadius: "0.65rem",
                            border: "1px solid rgba(37, 99, 235, 0.1)",
                            boxShadow: "0 2px 6px -2px rgba(37, 99, 235, 0.08)"
                          }}
                        >
                          <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
                            <span style={{ fontSize: "0.7rem", color: "var(--muted)", fontWeight: "600" }}>Year</span>
                            <span style={{ fontSize: "1rem", fontWeight: "700", color: "var(--ink)" }}>
                              {formatDate(change?.Date) || "—"}
                            </span>
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
                            <span style={{ fontSize: "0.7rem", color: "var(--muted)", fontWeight: "600" }}>Amount</span>
                            <span style={{
                              fontSize: "1.1rem",
                              fontWeight: "700",
                              color: isNegative ? "#dc2626" : "#059669"
                            }}>
                              {formattedAmount}
                            </span>
                          </div>
                          <div>
                            <span style={{
                              fontSize: "0.8rem",
                              fontWeight: "700",
                              padding: "0.35rem 0.75rem",
                              borderRadius: "0.4rem",
                              background: change?.Flag === "Percent %" ? "rgba(59, 130, 246, 0.15)" : "rgba(16, 185, 129, 0.15)",
                              color: change?.Flag === "Percent %" ? "#2563eb" : "#059669",
                              whiteSpace: "nowrap"
                            }}>
                              {change?.Flag || "—"}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
