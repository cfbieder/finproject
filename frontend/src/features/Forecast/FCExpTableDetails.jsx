export default function FCExpTableDetails({
  selectedScenario,
  selectedEntry,
  formatDate,
  formatNumber,
}) {
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
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: "0.75rem 1rem",
                  padding: "0.25rem 0",
                }}
              >
                <div>
                  <strong>Account:</strong> {selectedEntry.Account || "—"}
                </div>
                <div>
                  <strong>Name:</strong> {selectedEntry.Name || "—"}
                </div>
                <div>
                  <strong>Type:</strong> {selectedEntry.Type || "—"}
                </div>
                <div>
                  <strong>Currency:</strong> {selectedEntry.Currency || "—"}
                </div>
                <div>
                  <strong>Base Date:</strong> {formatDate(selectedEntry.BaseDate)}
                </div>
                <div>
                  <strong>Base Value:</strong>{" "}
                  {formatNumber(selectedEntry.BaseValue)}
                </div>
                <div>
                  <strong>Base Value (USD):</strong>{" "}
                  {formatNumber(selectedEntry.BaseValueUSD)}
                </div>
                <div>
                  <strong>Growth:</strong>{" "}
                  {typeof selectedEntry.Growth === "number"
                    ? `${selectedEntry.Growth.toFixed(2)}%`
                    : "—"}
                </div>
                <div>
                  <strong>Changes:</strong>{" "}
                  {Array.isArray(selectedEntry.Changes)
                    ? selectedEntry.Changes.length
                    : 0}
                </div>
                <div>
                  <strong>Matched:</strong>{" "}
                  {selectedEntry.Matched ? "Yes" : "No"}
                </div>
                <div>
                  <strong>Scenario:</strong>{" "}
                  {selectedEntry.Scenario || selectedScenario || "—"}
                </div>
              </div>
              {!!(selectedEntry.Changes || []).length && (
                <div style={{ marginTop: "0.75rem" }}>
                  <strong>Changes:</strong>
                  <div style={{ marginTop: "0.35rem", display: "grid", gap: "0.5rem" }}>
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
                            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                            gap: "0.5rem",
                            alignItems: "center",
                          }}
                        >
                          <span>
                            <strong>Year:</strong>{" "}
                            {formatDate(change?.Date) || "—"}
                          </span>
                          <span>
                            <strong>Amount:</strong>{" "}
                            <span style={{ color: isNegative ? "red" : undefined }}>
                              {formattedAmount}
                            </span>
                          </span>
                          <span>
                            <strong>Flag:</strong> {change?.Flag || "—"}
                          </span>
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
