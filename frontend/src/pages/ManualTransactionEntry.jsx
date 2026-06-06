import { useCallback, useEffect, useRef, useState } from "react";
import AccountPicker, { buildHierarchyOptions } from "../components/AccountPicker/AccountPicker.jsx";
import CategorySelector from "../components/CategorySelector/CategorySelector.jsx";
import {
  computeTransactionBaseAmount,
  useTransactionExchangeRates,
  useTransactionCurrencyOptions,
} from "../features/Transaction/TransactionTable.jsx";
import { useCoa } from "../hooks/useCoa.js";
import Rest from "../js/rest.js";
import { useToast } from "../contexts";
import "./PageLayout.css";
import "./ManualTransactionEntry.css";

const today = () => new Date().toISOString().slice(0, 10);

/**
 * CR025 — Manual Transaction Entry. Enters a single actual transaction
 * (source='manual', accepted=true) and stays open for rapid sequential entry
 * (account/date/currency persist; amount/description/category clear after save).
 */
export default function ManualTransactionEntry() {
  const { showSuccess, showError } = useToast();
  const { plTree } = useCoa();
  const rates = useTransactionExchangeRates();
  const currencyOptions = useTransactionCurrencyOptions();

  const [accounts, setAccounts] = useState([]);
  const [accountOptions, setAccountOptions] = useState([]);
  const [categories, setCategories] = useState([]);

  // sticky after save
  const [accountId, setAccountId] = useState("");
  const [date, setDate] = useState(today());
  const [currency, setCurrency] = useState("USD");
  // cleared after save
  const [amount, setAmount] = useState("");
  const [baseAmount, setBaseAmount] = useState("");
  const [baseEdited, setBaseEdited] = useState(false);
  const [category, setCategory] = useState("");
  const [description1, setDescription1] = useState("");
  const [showMore, setShowMore] = useState(false);
  const [description2, setDescription2] = useState("");
  const [memo, setMemo] = useState("");
  const [note, setNote] = useState("");
  const [labels, setLabels] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const amountRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const rows = await Rest.fetchAccountsV2({ activeOnly: true, leafOnly: true });
        setAccounts(rows);
        setAccountOptions(buildHierarchyOptions(rows));
      } catch (e) {
        setError(e.message);
      }
      try {
        setCategories(await Rest.fetchCategoriesV2({ activeOnly: true }));
      } catch {
        /* category is optional */
      }
    })();
  }, []);

  const onAccountChange = (id) => {
    const newId = id ? Number(id) : "";
    setAccountId(newId);
    const a = accounts.find((x) => x.id === newId);
    if (a?.currency) setCurrency(a.currency);
  };

  const amt = parseFloat(amount);
  const amtValid = Number.isFinite(amt) && amt !== 0;

  // FX: recompute USD base on amount/currency/date change unless manually edited.
  useEffect(() => {
    if (baseEdited) return;
    if (!amtValid) { setBaseAmount(""); return; }
    if (currency === "USD") { setBaseAmount(amt.toFixed(2)); return; }
    const base = computeTransactionBaseAmount(amt, currency, rates);
    setBaseAmount(Number.isFinite(base) ? base.toFixed(2) : ""); // blank → no rate
  }, [amount, currency, rates, baseEdited, amt, amtValid]);

  const fxMissing = currency !== "USD" && amtValid && baseAmount === "";
  const canSave = !!accountId && !!date && amtValid && !fxMissing && !saving;

  const handleSave = useCallback(
    async (e) => {
      e?.preventDefault();
      if (!accountId || !date || !amtValid) return;
      if (fxMissing) {
        setError("No USD rate found for this currency/date — enter the Base amount (USD) manually.");
        return;
      }
      setSaving(true);
      setError("");
      try {
        const category_id = category ? categories.find((c) => c.name === category)?.id ?? null : null;
        const base = currency === "USD" ? amt : parseFloat(baseAmount);
        const payload = {
          transaction_date: date,
          account_id: Number(accountId),
          amount: amt,
          currency,
          base_amount: Number.isFinite(base) ? base : amt,
          base_currency: "USD",
          category_id,
          description1: description1 || null,
          description2: description2 || null,
          memo: memo || null,
          note: note || null,
          labels: labels || null,
          source: "manual",
          accepted: true,
        };
        const res = await fetch(Rest.buildUrl("/api/v2/transactions"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const b = await res.json().catch(() => null);
          throw new Error(b?.error || "Failed to add transaction");
        }
        showSuccess("Transaction added");
        // reset (keep account/date/currency; clear the rest; refocus amount)
        setAmount("");
        setBaseAmount("");
        setBaseEdited(false);
        setCategory("");
        setDescription1("");
        setDescription2("");
        setMemo("");
        setNote("");
        setLabels("");
        amountRef.current?.focus();
      } catch (err) {
        setError(err.message);
        showError?.(err.message);
      } finally {
        setSaving(false);
      }
    },
    [accountId, date, amtValid, fxMissing, category, categories, currency, amt, baseAmount,
     description1, description2, memo, note, labels, showSuccess, showError]
  );

  return (
    <main className="page-main">
      <div className="mte-container">
        <header className="mte-header">
          <h1 className="mte-header__title">Manual Entry</h1>
          <p className="mte-header__subtitle">
            Add a single actual transaction (saved as <code>source=manual</code>, accepted —
            it won't be swept by a feed refresh). The form stays open for rapid entry.
          </p>
        </header>

        <form className="mte-form" onSubmit={handleSave}>
          <div className="mte-field">
            <label className="mte-label">Account *</label>
            <AccountPicker
              value={accountId}
              options={accountOptions}
              placeholder="Search accounts…"
              onChange={onAccountChange}
            />
          </div>

          <div className="mte-row">
            <div className="mte-field">
              <label className="mte-label">Date *</label>
              <input type="date" className="mte-input" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="mte-field">
              <label className="mte-label">Currency</label>
              <select className="mte-input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {(currencyOptions || []).map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="mte-row">
            <div className="mte-field">
              <label className="mte-label">Amount * <span className="mte-hint">(negative = outflow)</span></label>
              <input
                ref={amountRef}
                type="number"
                step="0.01"
                className="mte-input"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="mte-field">
              <label className="mte-label">
                Base amount (USD){currency === "USD" ? " " : ""}
                {currency !== "USD" && <span className="mte-hint"> (auto from FX, editable)</span>}
              </label>
              <input
                type="number"
                step="0.01"
                className={`mte-input ${fxMissing ? "mte-input--warn" : ""}`}
                value={baseAmount}
                disabled={currency === "USD"}
                onChange={(e) => { setBaseAmount(e.target.value); setBaseEdited(true); }}
                placeholder={fxMissing ? "no FX rate — enter manually" : "0.00"}
              />
            </div>
          </div>
          {fxMissing && (
            <div className="mte-warn">No nearby USD rate for {currency} on {date} — enter the Base amount (USD) manually.</div>
          )}

          <div className="mte-field">
            <label className="mte-label">Category</label>
            {plTree?.length > 0 ? (
              <CategorySelector
                plTree={plTree}
                selectedCategories={category ? [category] : []}
                onCategoriesChange={(sel) => setCategory(sel.length ? sel[sel.length - 1] : "")}
                categoryGroupOptions={[]}
              />
            ) : (
              <input className="mte-input" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Category" />
            )}
          </div>

          <div className="mte-field">
            <label className="mte-label">Description</label>
            <input className="mte-input" value={description1} onChange={(e) => setDescription1(e.target.value)} placeholder="Description" />
          </div>

          <button type="button" className="mte-more-toggle" onClick={() => setShowMore((s) => !s)}>
            {showMore ? "− Less" : "+ More (description 2 / memo / note / labels)"}
          </button>
          {showMore && (
            <div className="mte-more">
              <div className="mte-field">
                <label className="mte-label">Description 2</label>
                <input className="mte-input" value={description2} onChange={(e) => setDescription2(e.target.value)} />
              </div>
              <div className="mte-field">
                <label className="mte-label">Memo</label>
                <input className="mte-input" value={memo} onChange={(e) => setMemo(e.target.value)} />
              </div>
              <div className="mte-field">
                <label className="mte-label">Note</label>
                <input className="mte-input" value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
              <div className="mte-field">
                <label className="mte-label">Labels</label>
                <input className="mte-input" value={labels} onChange={(e) => setLabels(e.target.value)} />
              </div>
            </div>
          )}

          {error && <div className="mte-error">{error}</div>}

          <div className="mte-actions">
            <button type="submit" className="btn btn--primary" disabled={!canSave}>
              {saving ? "Adding…" : "Add transaction"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
