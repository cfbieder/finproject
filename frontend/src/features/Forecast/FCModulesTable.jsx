export default function FCModulesTable({
  modules,
  modulesError,
  modulesLoading,
  selectedModule,
  selectedModuleId,
  onSelectModule,
  getModuleId,
}) {
  const formatCurrency = (value) => {
    if (value === undefined || value === null || Number.isNaN(Number(value))) {
      return "-";
    }
    return Number(value).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const formatDate = (value) => {
    if (!value) {
      return "-";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "-";
    }
    return date.toLocaleDateString();
  };

  const renderTransfers = (transfers) => {
    if (!Array.isArray(transfers) || !transfers.length) {
      return "-";
    }
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr auto",
            gap: "0.25rem",
            fontSize: "0.8rem",
            color: "var(--muted)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            fontWeight: 600,
          }}
        >
          <span>Date</span>
          <span>Amount</span>
          <span>Flag</span>
        </div>
        {transfers.map((transfer, index) => {
          if (!transfer || typeof transfer !== "object") {
            return null;
          }
          const date = transfer.Date ? formatDate(transfer.Date) : "-";
          const amount = formatCurrency(transfer.Amount);
          const flag = transfer.Flag;
          return (
            <div
              key={index}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr auto",
                gap: "0.25rem",
                alignItems: "center",
              }}
            >
              <span>{date}</span>
              <span>{amount}</span>
              <span style={{ color: "var(--muted)" }}>
                {flag && flag !== "" ? flag : "-"}
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <section className="section-table">
      <div className="section-table__content">
        <div className="fc-modules-panels">
          <div className="fc-modules-panel">
            <h3 className="fc-modules-panel__title">Modules</h3>
            <div className="trans-budget-table-wrapper">
              {modulesLoading && (
                <p className="trans-budget-table__message">Loading modules…</p>
              )}
              {!modulesLoading && modulesError && (
                <p className="trans-budget-table__message trans-budget-table__message--error">
                  {modulesError}
                </p>
              )}
              {!modulesLoading && !modulesError && !modules.length && (
                <p className="trans-budget-table__message">
                  No modules found for this scenario.
                </p>
              )}
              {!modulesLoading && !modulesError && modules.length > 0 && (
                <table className="trans-budget-table">
                  <thead>
                    <tr>
                      <th style={{ width: "32%" }}>Name</th>
                      <th>Account</th>
                      <th>Type</th>
                      <th>Matched</th>
                      <th style={{ width: "110px" }}>Base Value (USD)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modules.map((module) => {
                      const moduleId = getModuleId(module);
                      const isSelected = moduleId === selectedModuleId;
                      const baseValue =
                        module?.BaseValueUSD ?? module?.BaseValue;
                      return (
                        <tr
                          key={moduleId}
                          className={`trans-budget-table__row${
                            isSelected ? " trans-budget-table__row--selected" : ""
                          }`}
                          onClick={() => onSelectModule(moduleId)}
                        >
                          <td className="trans-budget-table__value">
                            {module?.Name || "-"}
                          </td>
                          <td className="trans-budget-table__value">
                            {module?.Account || "-"}
                          </td>
                          <td className="trans-budget-table__value">
                            {module?.Type || "-"}
                          </td>
                          <td className="trans-budget-table__value">
                            {module?.Matched ? "Yes" : "No"}
                          </td>
                          <td className="trans-budget-table__value trans-budget-table__value--numeric">
                            {formatCurrency(baseValue)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
          <div className="fc-modules-panel">
            <h3 className="fc-modules-panel__title">Details</h3>
            {selectedModule ? (
              <div className="fc-modules-details">
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                    gap: "0.65rem",
                  }}
                >
                  {[
                    ["Scenario", selectedModule.Scenario],
                    ["Account", selectedModule.Account],
                    ["Type", selectedModule.Type],
                    ["Matched", selectedModule.Matched ? "Yes" : "No"],
                    ["Name", selectedModule.Name],
                    ["Currency", selectedModule.Currency],
                    ["Exp Category", selectedModule.ExpCategory],
                    [
                      "Expense",
                      selectedModule.Expense === null ||
                      selectedModule.Expense === undefined
                        ? null
                        : formatCurrency(selectedModule.Expense),
                    ],
                    [
                      "Expense %",
                      selectedModule.ExpensePct === null ||
                      selectedModule.ExpensePct === undefined
                        ? null
                        : `${selectedModule.ExpensePct}%`,
                    ],
                    ["Income Category", selectedModule.IncomeCategory],
                    [
                      "Income",
                      selectedModule.Income === null ||
                      selectedModule.Income === undefined
                        ? null
                        : formatCurrency(selectedModule.Income),
                    ],
                    [
                      "Income %",
                      selectedModule.IncomePct === null ||
                      selectedModule.IncomePct === undefined
                        ? null
                        : `${selectedModule.IncomePct}%`,
                    ],
                    ["Base Date", formatDate(selectedModule.BaseDate)],
                    [
                      "Base Value",
                      selectedModule.BaseValue === null ||
                      selectedModule.BaseValue === undefined
                        ? null
                        : formatCurrency(selectedModule.BaseValue),
                    ],
                    [
                      "Market Value",
                      selectedModule.MarketValue === null ||
                      selectedModule.MarketValue === undefined
                        ? null
                        : formatCurrency(selectedModule.MarketValue),
                    ],
                    [
                      "Base Value (USD)",
                      formatCurrency(
                        selectedModule.BaseValueUSD ?? selectedModule.BaseValue
                      ),
                    ],
                    [
                      "Market Value (USD)",
                      formatCurrency(selectedModule.MarketValueUSD),
                    ],
                    [
                      "Growth",
                      selectedModule.Growth === null ||
                      selectedModule.Growth === undefined
                        ? null
                        : `${selectedModule.Growth}%`,
                    ],
                    ["Invest", renderTransfers(selectedModule.Invest)],
                    ["Dispose", renderTransfers(selectedModule.Dispose)],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "0.15rem",
                        gridColumn:
                          label === "Invest" || label === "Dispose"
                            ? "1 / -1"
                            : undefined,
                      }}
                    >
                      <span
                        style={{
                          fontSize: "0.85rem",
                          color: "var(--muted)",
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                          fontWeight: 600,
                        }}
                      >
                        {label}
                      </span>
                      <span style={{ fontWeight: 700, color: "var(--ink)" }}>
                        {value === null || value === undefined || value === ""
                          ? "-"
                          : value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="fc-modules-panel__placeholder">
                Select a module to view details.
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
