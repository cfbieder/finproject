import { useCallback, useEffect, useState } from "react";
import "./BudgetOptionExchangeRates.css";
export default function BudgetOptionExchangeRates() {
  const [exchangeData, setExchangeData] = useState([]);
  const [status, setStatus] = useState({
    loading: true,
    error: "",
  });
  const [editingCurrency, setEditingCurrency] = useState(null);
  const [editingValue, setEditingValue] = useState("");

  const persistBudgetRates = useCallback(async (updates) => {
    if (!updates.length) {
      return;
    }

    try {
      const response = await fetch("/api/util/appdata", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ updates }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        console.error(
          "[BUDGET-RATES] Failed to persist budget rates:",
          payload?.error || response.statusText
        );
      }
    } catch (error) {
      console.error("[BUDGET-RATES] Failed to persist budget rates:", error);
    }
  }, []);

  const stopEditing = () => {
    setEditingCurrency(null);
    setEditingValue("");
  };

  const handleBudgetRateDoubleClick = (entry) => {
    setEditingCurrency(entry.currency);
    setEditingValue(
      entry.budgetRate !== null && entry.budgetRate !== undefined
        ? entry.budgetRate.toFixed(4)
        : ""
    );
  };

  const commitBudgetRate = (currency) => {
    if (editingCurrency !== currency) {
      return;
    }

    const trimmedValue = editingValue.trim();
    if (!trimmedValue) {
      stopEditing();
      return;
    }

    const parsedValue = Number(trimmedValue);
    if (!Number.isFinite(parsedValue)) {
      stopEditing();
      return;
    }

    setExchangeData((prev) =>
      prev.map((entry) =>
        entry.currency === currency
          ? { ...entry, budgetRate: parsedValue }
          : entry
      )
    );

    stopEditing();
    persistBudgetRates([{ key: `${currency}/USD`, value: parsedValue }]);
  };

  const handleBudgetRateInputChange = (event) => {
    setEditingValue(event.target.value);
  };

  const handleBudgetRateKeyDown = (event, currency) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitBudgetRate(currency);
    } else if (event.key === "Escape") {
      stopEditing();
    }
  };

  const handleBudgetRateBlur = () => {
    if (editingCurrency) {
      commitBudgetRate(editingCurrency);
    }
  };

  useEffect(() => {
    let isMounted = true;

    const fetchRateForCurrency = async (currency) => {
      const encodedCurrency = encodeURIComponent(currency);
      try {
        const response = await fetch(
          `/api/util/exchange-rate?currency=${encodedCurrency}`
        );

        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          return {
            currency,
            error: payload?.error || "Rate unavailable",
          };
        }

        const ratePayload = await response.json();
        const parsedRate = Number(ratePayload?.rate);

        return {
          currency,
          rate: Number.isFinite(parsedRate) ? parsedRate : null,
        };
      } catch (error) {
        return {
          currency,
          error: "Unable to fetch rate",
        };
      }
    };

    const fetchAppDataDoc = async () => {
      try {
        const response = await fetch("/api/util/getappdata");
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          console.warn(
            "[BUDGET-RATES] Unable to read appdata:",
            payload?.error || response.statusText
          );
          return {};
        }

        if (!Array.isArray(payload) || payload.length === 0) {
          return {};
        }

        const doc = payload[0];
        return doc && typeof doc === "object" ? doc : {};
      } catch (error) {
        console.error("[BUDGET-RATES] Failed to fetch appdata:", error);
        return {};
      }
    };

    const fetchExchangeData = async () => {
      try {
        const [currenciesResponse, appDataDoc] = await Promise.all([
          fetch("/api/util/currencies"),
          fetchAppDataDoc(),
        ]);

        if (!currenciesResponse.ok) {
          throw new Error("Failed to load currencies");
        }

        const payload = await currenciesResponse.json();
        const rawCurrencies = Array.isArray(payload?.currencies)
          ? payload.currencies
          : [];

        const requests = rawCurrencies.map((currency) =>
          fetchRateForCurrency(currency)
        );

        const tableEntries = await Promise.all(requests);

        if (!isMounted) {
          return;
        }

        const decoratedEntries = [];
        const budgetRateUpdates = [];

        for (const entry of tableEntries) {
          const budgetKey = `${entry.currency}/USD`;
          const hasStoredBudget = Object.prototype.hasOwnProperty.call(
            appDataDoc,
            budgetKey
          );
          const storedValue = hasStoredBudget
            ? appDataDoc[budgetKey]
            : undefined;
          const storedRate =
            storedValue !== undefined && storedValue !== null
              ? Number(storedValue)
              : null;

          const budgetRate =
            hasStoredBudget && Number.isFinite(storedRate)
              ? storedRate
              : hasStoredBudget
              ? null
              : entry.rate;

          const shouldPersist =
            !hasStoredBudget &&
            entry.rate !== null &&
            entry.rate !== undefined &&
            Number.isFinite(entry.rate);

          if (shouldPersist && budgetRate !== null) {
            budgetRateUpdates.push({ key: budgetKey, value: entry.rate });
          }

          decoratedEntries.push({
            ...entry,
            budgetRate,
          });
        }

        const sortedEntries = decoratedEntries.sort((a, b) =>
          a.currency.localeCompare(b.currency, undefined, { numeric: true })
        );

        setExchangeData(sortedEntries);
        setStatus({ loading: false, error: "" });

        persistBudgetRates(budgetRateUpdates);
      } catch (error) {
        if (!isMounted) {
          return;
        }
        setStatus({
          loading: false,
          error: error?.message || "Failed to load exchange data",
        });
      }
    };

    fetchExchangeData();

    return () => {
      isMounted = false;
    };
  }, [persistBudgetRates]);

  const renderBody = () => {
    if (status.loading) {
      return (
        <p className="budget-options-region__note">Loading exchange rates…</p>
      );
    }

    if (status.error) {
      return (
        <p className="budget-options-region__note budget-options-region__note--error">
          {status.error}
        </p>
      );
    }

    return (
      <div className="budget-options-table-wrapper">
        <table className="budget-options-table">
          <thead>
            <tr>
              <th>Currency</th>
              <th>USD Rate</th>
              <th>Budget Rate</th>
            </tr>
          </thead>
          <tbody>
            {exchangeData.map((entry) => {
              const displayRate =
                entry.rate !== null && entry.rate !== undefined
                  ? entry.rate.toFixed(4)
                  : entry.error
                  ? entry.error
                  : "—";
              const displayBudgetRate =
                entry.budgetRate !== null && entry.budgetRate !== undefined
                  ? entry.budgetRate.toFixed(4)
                  : "—";

              return (
                <tr key={entry.currency}>
                  <td>{entry.currency}</td>
                  <td>{displayRate}</td>
                  <td
                    className="budget-options-table__cell--editable"
                    onDoubleClick={() => handleBudgetRateDoubleClick(entry)}
                  >
                    {editingCurrency === entry.currency ? (
                      <input
                        className="budget-options-table__input"
                        type="number"
                        step="0.0001"
                        value={editingValue}
                        onChange={handleBudgetRateInputChange}
                        onBlur={handleBudgetRateBlur}
                        onKeyDown={(event) =>
                          handleBudgetRateKeyDown(event, entry.currency)
                        }
                        autoFocus
                      />
                    ) : (
                      displayBudgetRate
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <section className="budget-options-region">
      <p className="budget-options-region__title">Budget Exchange Rates</p>
      {renderBody()}
      <p className="budget-options-region__note">
        Placeholder for interactive controls, filters, or context.
      </p>
    </section>
  );
}
