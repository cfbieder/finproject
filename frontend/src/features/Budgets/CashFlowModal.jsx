import { useEffect, useState } from "react";
import Rest from "../../js/rest.js";
import Modal from "../../components/Modal/Modal.jsx";
import { MONTHS, monthRanges, parseAmount } from "./cashFlow.js";
import "./CashFlowModal.css";

const BLOCK_LABEL = { cash: "Cash", investments: "Investments" };
const CURRENCIES = ["USD", "PLN", "EUR"];

const fmt = (v, digits = 0) =>
  v == null || !Number.isFinite(Number(v))
    ? "—"
    : Number(v).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
const neg = (v) => (v != null && Number(v) < 0 ? "bb-neg" : ""); // the same test as the short-cash flag
const isZero = (arr) => !arr || arr.every((v) => !v);

function BlockRows({ label, block, short }) {
  const opens = [block.opening.value, ...block.ending.slice(0, 11)];
  const row = (name, values, year, cls = "") => (
    <tr className={cls}>
      <th scope="row">{name}</th>
      {values.map((v, m) => <td key={m} className={`num ${neg(v)}`}>{fmt(v)}</td>)}
      <td className={`num cfm-year ${neg(year)}`}>{fmt(year)}</td>
    </tr>
  );
  return (
    <>
      <tr className="cfm-block"><th colSpan={14} scope="colgroup">{label}</th></tr>
      {row("Opening", opens, block.opening.value)}
      {row("+ Inflows", block.inflows, block.year.inflows)}
      {row("− Outflows", block.outflows, block.year.outflows)}
      {block.unassigned && !isZero(block.unassigned) && row("No account", block.unassigned, block.year.unassigned)}
      {!isZero(block.transfers) && row("± Transfers", block.transfers, block.year.transfers)}
      <tr className="cfm-ending">
        <th scope="row">= Ending</th>
        {block.ending.map((v, m) => (
          <td key={m} className={`num ${neg(v)}`} title={short && v < 0 ? "Cash below zero" : undefined}>
            {short && v < 0 ? <span aria-label="below zero">⚠ </span> : null}{fmt(v)}
          </td>
        ))}
        <td className={`num cfm-year ${neg(block.year.closing)}`}>{fmt(block.year.closing)}</td>
      </tr>
    </>
  );
}

function openingNote(o, asOf) {
  if (o.source === "override") return `your figure · estimate ${fmt(o.estimate)}`;
  const parts = [`balance ${asOf} ${fmt(o.balance)}`, `rest of year ${fmt(o.remainder)}`];
  if (o.remainderUnassigned) parts.push(`no account ${fmt(o.remainderUnassigned)}`);
  return `estimate: ${parts.join(" + ")}`;
}

const blankTransfer = () => ({ month: 1, fromCurrency: "PLN", fromBlock: "cash", toCurrency: "USD", toBlock: "cash", amount: "", rate: "", note: "" });

/**
 * CR104 — Cash Flow by currency. For the open build, a monthly roll-forward per currency (never added
 * together), in a Cash block (bank + cards) and an Investments block (brokerage). Opening overrides and
 * what-if transfers are saved with a draft and never published.
 */
export default function CashFlowModal({ buildId, buildLabel, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [openings, setOpenings] = useState({});      // "USD|cash" → typed text
  const [transfers, setTransfers] = useState([]);    // editable rows
  const [dirty, setDirty] = useState(false);

  // `keepTransfers`: an openings save must not wipe transfer rows typed but not yet saved.
  const adopt = (d, { keepTransfers = false } = {}) => {
    setData(d);
    const o = {};
    for (const p of d.plan.openings) o[`${p.currency}|${p.block}`] = String(p.amount);
    setOpenings(o);
    if (keepTransfers) return;
    setTransfers(d.plan.transfers.map((t) => ({ ...t, amount: String(t.amount), rate: String(t.rate), note: t.note || "" })));
    setDirty(false);
  };

  useEffect(() => {
    let cancelled = false;
    Rest.get(`/budget-builder/${buildId}/cash-flow`)
      .then((r) => { if (!cancelled) adopt(Rest.unwrap(r)); })
      .catch((e) => { if (!cancelled) setError(e?.message || "Could not load the cash flow"); });
    return () => { cancelled = true; };
  }, [buildId]);

  const save = async (body) => {
    setSaving(true);
    setError("");
    try {
      adopt(Rest.unwrap(await Rest.put(`/budget-builder/${buildId}/cash-plan`, body)),
        { keepTransfers: !("transfers" in body) && dirty });
    } catch (e) {
      setError(e?.message || "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const saveOpenings = (next) => {
    const list = [];
    for (const [key, text] of Object.entries(next)) {
      if (text === "" || text == null) continue;
      const amount = parseAmount(text);
      const [currency, block] = key.split("|");
      if (amount == null) { setError(`${currency} ${BLOCK_LABEL[block]} opening: use digits and a dot, e.g. 150000 or -2500.50`); return; }
      list.push({ currency, block, amount });
    }
    save({ openings: list });
  };

  const saveTransfers = () => {
    const list = [];
    for (const [i, t] of transfers.entries()) {
      const amount = parseAmount(t.amount);
      if (amount == null || amount <= 0) { setError(`Transfer ${i + 1}: amount must be a positive number (digits and a dot)`); return; }
      const rate = t.rate === "" ? null : (/^\d+(\.\d+)?$/.test(String(t.rate).trim()) ? Number(t.rate) : NaN);
      if (t.rate !== "" && !(rate > 0)) { setError(`Transfer ${i + 1}: rate must be a number above zero, or blank for the build's rate`); return; }
      list.push({ month: Number(t.month), fromCurrency: t.fromCurrency, fromBlock: t.fromBlock, toCurrency: t.toCurrency,
        toBlock: t.toBlock, amount, rate, note: t.note || null });
    }
    save({ transfers: list });
  };

  const setT = (i, patch) => { setTransfers((rows) => rows.map((r, k) => (k === i ? { ...r, ...patch } : r))); setDirty(true); };
  const editable = data?.build.editable;
  const shortOnes = data ? data.currencies.filter((c) => c.short) : [];

  return (
    <Modal open onClose={onClose} size="chart" title={`Cash flow — ${buildLabel}`}
      description="Each currency's cash and investments, month by month, from this build."
      footer={<button type="button" className="btn btn--secondary" onClick={onClose}>Close</button>}>
      <div className="cfm">
        {error && <p className="bb-flag" role="alert">⚠ {error}</p>}
        {!data && !error && <p className="bb-muted">Loading…</p>}
        {data && (
          <>
            <p className="cfm-scope">
              Budgeted income and expenses only. Excludes loan principal, card-payment timing, price moves and
              reinvestment. Investments are at ledger value — a transfer out of them is a sale.
            </p>
            <p className="bb-muted">
              Opening (Jan 1) = ledger balances at {data.snapshot.asOf} + {data.snapshot.le.name}&apos;s months after it.
              Rates: PLN {fmt(data.rates.PLN, 2)} · EUR {fmt(data.rates.EUR, 2)} per USD. Each table is in its own currency.
            </p>
            <p className="cfm-summary" data-testid="cfm-summary">
              {shortOnes.length
                ? shortOnes.map((c) => `⚠ ${c.currency} cash short ${monthRanges(c.short.months)} (lowest ${fmt(c.short.lowest)})`).join(" · ")
                : "No currency's cash goes below zero."}
            </p>
            {data.currencies.some((c) => !c.reconciled) && (
              <p className="bb-flag">
                ⚠ {data.currencies.filter((c) => !c.reconciled).map((c) => c.currency).join(", ")}: the months do not add up to the
                build&apos;s total ({data.currencies.filter((c) => !c.reconciled).map((c) => (c.buildTotal == null ? `${c.currency} has a line with no figure yet` : `${fmt(c.flowTotal)} vs ${fmt(c.buildTotal)}`)).join("; ")}) —
                a line has no figure yet, or a cell was lost.
              </p>
            )}
            {data.notModelled.length > 0 && (
              <p className="bb-muted">
                Not modelled: {data.notModelled.map((n) => `${n.currency} (cash ${fmt(n.cash, 2)}${n.investments ? `, investments ${fmt(n.investments, 2)}` : ""})`).join(", ")}.
              </p>
            )}
            {data.currencyMismatches.length > 0 && (
              <p className="bb-muted">
                Budget lines in another currency than their account, counted in the line&apos;s currency:{" "}
                {data.currencyMismatches.map((m) => `${m.currency} on ${m.accountCurrency} accounts (${m.cells} cells, ${fmt(m.amount)})`).join("; ")}.
              </p>
            )}

            {data.currencies.map((c) => (
              <section key={c.currency} className="cfm-currency" aria-label={`${c.currency} cash flow`}>
                <h3 className="cfm-title">{c.currency} <span className="bb-muted">— in {c.currency}, not converted</span></h3>
                <div className="cfm-scroll">
                  <table className="bb-table cfm-table">
                    <thead>
                      <tr>
                        <th scope="col" />
                        {MONTHS.map((m) => <th key={m} scope="col" className="num">{m}</th>)}
                        <th scope="col" className="num cfm-year">Year</th>
                      </tr>
                    </thead>
                    <tbody>
                      <BlockRows label="Cash — bank accounts and cards" block={c.cash} short />
                      <BlockRows label="Investments — brokerage" block={c.investments} />
                      {(!isZero(c.other.months)) && (
                        <tr className="cfm-other">
                          <th scope="row">Other accounts (memo)</th>
                          {c.other.months.map((v, m) => <td key={m} className={`num ${neg(v)}`}>{fmt(v)}</td>)}
                          <td className={`num cfm-year ${neg(c.other.year)}`}>{fmt(c.other.year)}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="cfm-openings">
                  {["cash", "investments"].map((block) => {
                    const key = `${c.currency}|${block}`;
                    const o = c[block].opening;
                    return (
                      <div key={block} className="cfm-opening">
                        <label>
                          {BLOCK_LABEL[block]} opening{" "}
                          <input className="bb-num-input cfm-amount" inputMode="decimal" aria-label={`${c.currency} ${BLOCK_LABEL[block]} opening`}
                            disabled={!editable || saving} placeholder={String(o.estimate)}
                            value={openings[key] ?? ""}
                            onChange={(e) => setOpenings((prev) => ({ ...prev, [key]: e.target.value }))}
                            onBlur={() => {
                              const typed = openings[key] ?? "";
                              const stored = data.plan.openings.find((p) => `${p.currency}|${p.block}` === key);
                              if (typed === (stored ? String(stored.amount) : "")) return;
                              saveOpenings(openings);
                            }} />
                        </label>
                        <span className="bb-muted">{openingNote(o, data.snapshot.asOf)}</span>
                        {o.source === "override" && editable && (
                          <button type="button" className="bb-linkish" disabled={saving}
                            onClick={() => { const next = { ...openings, [key]: "" }; setOpenings(next); saveOpenings(next); }}>
                            use estimate
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}

            <section className="cfm-transfers" aria-label="What-if transfers">
              <h3 className="cfm-title">What-if transfers <span className="bb-muted">— saved with this draft, never published</span></h3>
              {transfers.length === 0 && <p className="bb-muted">None. Add one to see its effect on both tables.</p>}
              {transfers.length > 0 && (
                <div className="cfm-scroll">
                  <table className="bb-table cfm-ttable">
                    <thead>
                      <tr>
                        <th scope="col">Month</th><th scope="col">From</th><th scope="col">To</th>
                        <th scope="col" className="num">Amount (from)</th><th scope="col" className="num">Rate (to per from)</th>
                        <th scope="col" className="num">Arrives</th><th scope="col">Note</th><th scope="col" />
                      </tr>
                    </thead>
                    <tbody>
                      {transfers.map((t, i) => (
                        <tr key={i}>
                          <td>
                            <select aria-label={`Transfer ${i + 1} month`} value={t.month} disabled={!editable}
                              onChange={(e) => setT(i, { month: Number(e.target.value) })}>
                              {MONTHS.map((m, k) => <option key={m} value={k + 1}>{m}</option>)}
                            </select>
                          </td>
                          {["from", "to"].map((side) => (
                            <td key={side} className="cfm-side">
                              <select aria-label={`Transfer ${i + 1} ${side} currency`} value={t[`${side}Currency`]} disabled={!editable}
                                onChange={(e) => setT(i, { [`${side}Currency`]: e.target.value, rate: "", toAmount: undefined })}>
                                {CURRENCIES.map((x) => <option key={x}>{x}</option>)}
                              </select>
                              <select aria-label={`Transfer ${i + 1} ${side} block`} value={t[`${side}Block`]} disabled={!editable}
                                onChange={(e) => setT(i, { [`${side}Block`]: e.target.value })}>
                                <option value="cash">Cash</option>
                                <option value="investments">Investments</option>
                              </select>
                            </td>
                          ))}
                          <td className="num">
                            <input className="bb-num-input cfm-amount" inputMode="decimal" aria-label={`Transfer ${i + 1} amount`}
                              value={t.amount} disabled={!editable} onChange={(e) => setT(i, { amount: e.target.value, toAmount: undefined })} />
                          </td>
                          <td className="num">
                            <input className="bb-num-input cfm-rate" inputMode="decimal" aria-label={`Transfer ${i + 1} rate`}
                              value={t.rate} placeholder="build's rate" disabled={!editable}
                              onChange={(e) => setT(i, { rate: e.target.value, toAmount: undefined })} />
                          </td>
                          <td className="num">{t.toAmount != null ? `${fmt(t.toAmount, 2)} ${t.toCurrency}` : <span className="bb-muted">on save</span>}</td>
                          <td>
                            <input type="text" aria-label={`Transfer ${i + 1} note`} value={t.note} maxLength={200}
                              disabled={!editable} onChange={(e) => setT(i, { note: e.target.value })} />
                          </td>
                          <td>
                            {editable && (
                              <button type="button" className="bb-linkish" aria-label={`Remove transfer ${i + 1}`}
                                onClick={() => { setTransfers((rows) => rows.filter((_, k) => k !== i)); setDirty(true); }}>
                                remove
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {editable ? (
                <div className="cfm-actions">
                  <button type="button" className="btn btn--outline" disabled={saving}
                    onClick={() => { setTransfers((rows) => [...rows, blankTransfer()]); setDirty(true); }}>
                    Add transfer
                  </button>
                  <button type="button" className="btn btn--primary" disabled={saving || !dirty} onClick={saveTransfers}>
                    {saving ? "Saving…" : "Save transfers"}
                  </button>
                  {dirty && <span className="bb-muted">Unsaved — the tables update on save.</span>}
                </div>
              ) : (
                <p className="bb-muted">This build is not a draft, so its plan is read-only.</p>
              )}
            </section>
          </>
        )}
      </div>
    </Modal>
  );
}
