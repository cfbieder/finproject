import NavigationMenu from "../components/NavigationMenu.jsx";
import "./PageLayout.css";
import fcSetupData from "../../../components/data/fc_setup.json";

export default function FCExpSetup() {
  const periodLabels = Array.isArray(fcSetupData?.periods_used)
    ? fcSetupData.periods_used
        .map((period) => {
          if (!period || typeof period !== "object") {
            return null;
          }
          const [year, type] = Object.entries(period)[0] ?? [];
          if (!year) {
            return null;
          }
          return type ? `${year} (${type})` : year;
        })
        .filter(Boolean)
    : [];

  const profitLossRows = [];
  const traverseProfitLoss = (node, depth = 0) => {
    if (Array.isArray(node)) {
      node.forEach((child) => traverseProfitLoss(child, depth));
      return;
    }

    if (node && typeof node === "object") {
      for (const [label, children] of Object.entries(node)) {
        profitLossRows.push({ label, depth, isGroup: true });
        traverseProfitLoss(children, depth + 1);
      }
      return;
    }

    if (typeof node === "string" && node.trim()) {
      profitLossRows.push({ label: node.trim(), depth, isGroup: false });
    }
  };

  traverseProfitLoss(fcSetupData?.["Profit & Loss Accounts"] ?? [], 0);

  return (
    <div className="page-shell">
      <NavigationMenu />
      <main className="page-content">
        <section className="section-table">
          <div className="section-table__content">
            <div>
              <h2>Forecast Expense Setup</h2>
              <p>
                Periods and Profit &amp; Loss accounts loaded from
                fc_setup.json.
              </p>
            </div>
            <div className="trans-budget-table-wrapper">
              <table className="trans-budget-table">
                <thead>
                  <tr>
                    <th>Profit &amp; Loss Account</th>
                    {periodLabels.map((label) => (
                      <th key={label}>{label}</th>
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
                      {periodLabels.map((label) => (
                        <td key={`${row.label}-${label}-${index}`}>-</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
