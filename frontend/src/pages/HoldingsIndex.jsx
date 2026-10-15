import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Rest from "../js/rest.js";
import DataTable from "../components/DataTable/DataTable.jsx";
import Money from "../components/Money/Money.jsx";
import LoadingSpinner from "../components/LoadingSpinner.jsx";
import "./ManualHoldings.css";

/**
 * HoldingsIndex — CR097: the nav entry for holdings registers. Lists the accounts
 * that carry one (with their last valuation), then the accounts that could — a
 * non-fed USD balance-sheet account in P1a. Each opens /holdings/:accountId.
 */
export default function HoldingsIndex() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    Rest.get("/manual-holdings")
      .then((r) => setRows(Rest.unwrap(r)))
      .catch((e) => setError(e.message));
  }, []);

  if (!rows) {
    return (
      <div className="page-shell">
        {error ? <p className="mh-error" role="alert">{error}</p> : <LoadingSpinner />}
      </div>
    );
  }

  const enabled = rows.filter((r) => r.enabled);
  const available = rows.filter((r) => !r.enabled);

  const open = (r) => <Link to={`/holdings/${r.id}`}>{r.name}</Link>;
  const enabledColumns = [
    { key: "name", header: "Account", render: open },
    { key: "holdings", header: "Holdings", numeric: true },
    { key: "last_valued_on", header: "Last valued", render: (r) => r.last_valued_on || "never" },
    {
      key: "last_total",
      header: "Balance",
      numeric: true,
      render: (r) => (r.last_total == null ? "—" : <Money value={r.last_total} currency={r.currency} />),
    },
  ];
  const availableColumns = [
    { key: "name", header: "Account", render: open },
    { key: "currency", header: "Currency" },
  ];

  return (
    <div className="page-shell mh-page">
      <header className="page-accent__header">
        <h1>Holdings</h1>
        <p className="page-accent__sub">
          Accounts valued by a list of what they hold — each valuation sets the balance and books Unrealized G/L.
        </p>
      </header>

      <section className="panel">
        <h2>Registers</h2>
        {enabled.length ? (
          <DataTable columns={enabledColumns} rows={enabled} rowKey={(r) => r.id} />
        ) : (
          <p className="mh-note">No account has a holdings register yet — open one below to enable it.</p>
        )}
      </section>

      {available.length > 0 && (
        <section className="panel">
          <h2>Can carry a register</h2>
          <p className="mh-note">
            Non-fed USD asset accounts. Opening one shows what enabling it does; nothing changes until you confirm.
          </p>
          <DataTable columns={availableColumns} rows={available} rowKey={(r) => r.id} />
        </section>
      )}
    </div>
  );
}
