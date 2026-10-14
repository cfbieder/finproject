import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Plus } from "lucide-react";
import Rest from "../js/rest.js";
import DataTable from "../components/DataTable/DataTable.jsx";
import Modal from "../components/Modal/Modal.jsx";
import Money from "../components/Money/Money.jsx";
import ConfirmModal from "../components/ConfirmModal/ConfirmModal.jsx";
import LoadingSpinner from "../components/LoadingSpinner.jsx";
import "./ManualHoldings.css";

/**
 * ManualHoldings — CR097 P1a: the holdings register for a manually valued account.
 *
 * What the account holds (units or amount-only, each in its own currency, grouped
 * by platform) and dated valuations of it. A valuation is PREVIEWED first — the
 * server runs every write and rolls back — and the preview explains the
 * Unrealized G/L it will book as price + FX + unreconciled cost. Saving sends the
 * previewed figures back; if they moved, the server refuses (409) and this page
 * shows the current ones instead.
 *
 * P1a: only the latest valuation can be replaced or deleted; USD accounts only.
 */

const CURRENCIES = ["GBP", "EUR", "PLN", "USD"];
const ASSET_CLASSES = ["private", "equity", "etf", "mutual_fund", "bond", "cash", "unknown"];
const today = () => new Date().toLocaleDateString("en-CA");

/** A delta in the owner's colour rule: negative red, everything else ink. */
function Delta({ value, currency, bold }) {
  return (
    <span className={Number(value) < 0 ? "mh-neg" : undefined}>
      <Money value={value} currency={currency} bold={bold} />
    </span>
  );
}

const fmtQty = (q) =>
  q == null ? "—" : Number(q).toLocaleString("en-US", { maximumFractionDigits: 8 });

export default function ManualHoldings() {
  const { accountId } = useParams();
  const [reg, setReg] = useState(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null); // holding being edited, or {} for new
  const [confirmEnable, setConfirmEnable] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setReg(Rest.unwrap(await Rest.get(`/manual-holdings/${accountId}`)));
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }, [accountId]);

  useEffect(() => {
    load();
  }, [load]);

  const enable = async () => {
    setBusy(true);
    try {
      await Rest.post(`/manual-holdings/${accountId}/enable`, {});
      setConfirmEnable(false);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!reg) {
    return (
      <div className="page-shell">
        {error ? <p className="mh-error" role="alert">{error}</p> : <LoadingSpinner />}
      </div>
    );
  }

  const { account, holdings, valuations } = reg;
  const ccy = account.currency;

  return (
    <div className="page-shell mh-page">
      <Link className="inv-back" to="/manual-calibration">
        <ArrowLeft size={14} aria-hidden="true" /> Manual Calibration
      </Link>
      <header className="page-accent__header">
        <h1>{account.name}</h1>
        <p className="page-accent__sub">
          Holdings register · {ccy} account ·{" "}
          {!account.enabled
            ? "not enabled"
            : valuations[0]
              ? <>last valued {valuations[0].valued_on} · balance <Money value={valuations[0].total} currency={ccy} /></>
              : "never valued"}
        </p>
      </header>

      {error && <p className="mh-error" role="alert">{error}</p>}

      {!account.enabled ? (
        <section className="panel">
          <h2>Enable the holdings register</h2>
          {account.ineligible_reason ? (
            <p className="mh-note">This account cannot carry a register: {account.ineligible_reason}.</p>
          ) : (
            <>
              <p className="mh-note">
                List what this account holds and revalue it by date. Each valuation sets the
                account&apos;s balance and books the change to Unrealized G/L. Enabling switches the
                account to <strong>mtm</strong>
                {account.reconcile_mode !== "mtm" && " (it is on calibrate, which absorbs every gain into the opening balance)"}
                , and from then on its balance is set only here.
              </p>
              <button type="button" className="btn btn--primary" onClick={() => setConfirmEnable(true)}>
                Enable register
              </button>
            </>
          )}
        </section>
      ) : (
        <>
          <HoldingsPanel
            holdings={holdings}
            ccy={ccy}
            onAdd={() => setEditing({})}
            onEdit={(h) => setEditing(h)}
          />
          <ValuationPanel
            accountId={accountId}
            holdings={holdings}
            valuations={valuations}
            ccy={ccy}
            onSaved={load}
          />
        </>
      )}

      {editing && (
        <HoldingModal
          accountId={accountId}
          holding={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}

      <Modal
        open={confirmEnable}
        onClose={busy ? undefined : () => setConfirmEnable(false)}
        dismissable={!busy}
        title="Enable the holdings register?"
        description="The account switches to mtm, and its balance can then only be set by saving a valuation here. Disabling later keeps every booked row."
        footer={
          <>
            <button type="button" className="btn btn--outline" disabled={busy} onClick={() => setConfirmEnable(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn--primary" disabled={busy} onClick={enable}>
              {busy ? "Enabling…" : "Enable"}
            </button>
          </>
        }
      >
        <p className="mh-note">{account.name}</p>
      </Modal>
    </div>
  );
}

// ---- holdings --------------------------------------------------------------

function HoldingsPanel({ holdings, ccy, onAdd, onEdit }) {
  const groups = useMemo(() => {
    const m = new Map();
    for (const h of holdings) {
      const k = h.platform || "No platform";
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(h);
    }
    return [...m.entries()];
  }, [holdings]);

  const columns = [
    {
      key: "name",
      header: "Holding",
      render: (h) => (
        <button type="button" className="mh-link" onClick={() => onEdit(h)} title="Edit this holding">
          {h.name}
        </button>
      ),
    },
    { key: "status", header: "Status", render: (h) => (h.status === "active" ? "active" : <em>{h.status}</em>) },
    { key: "quantity", header: "Qty", numeric: true, render: (h) => fmtQty(h.quantity) },
    { key: "cost_local", header: "Invested", numeric: true, render: (h) => <Money value={h.cost_local} currency={h.currency} /> },
    {
      key: "cost_acct",
      header: `Cost ${ccy}`,
      numeric: true,
      render: (h) => (
        <span title={h.cost_acct_source === "entered" ? "Amount actually sent (entered)" : "Invested × rate on the purchase date"}>
          <Money value={h.cost_acct} currency={ccy} />
          {h.cost_acct_source === "entered" ? " ✎" : ""}
        </span>
      ),
    },
    {
      key: "value_local",
      header: "Value",
      numeric: true,
      render: (h) => (h.latest ? <Money value={h.latest.value_local} currency={h.currency} /> : "—"),
    },
    {
      key: "value_acct",
      header: `Value ${ccy}`,
      numeric: true,
      render: (h) => (h.latest ? <Money value={h.latest.value_acct} currency={ccy} /> : "—"),
    },
    {
      key: "unrealized",
      header: "Unrealized",
      numeric: true,
      render: (h) => (h.latest ? <Delta value={h.latest.value_acct - h.cost_acct} currency={ccy} /> : "—"),
    },
  ];

  return (
    <section className="panel">
      <div className="mh-panel-head">
        <h2>Holdings</h2>
        <button type="button" className="btn btn--sm btn--outline" onClick={onAdd}>
          <Plus size={14} /> Add holding
        </button>
      </div>
      {holdings.length === 0 && <p className="mh-note">No holdings yet — add each investment once, with what you put in.</p>}
      {groups.map(([platform, rows]) => {
        // Cost and value over the SAME rows — otherwise the two figures compare
        // different sets once some holdings are valued and some are not.
        const valued = rows.filter((h) => h.latest);
        const basis = valued.length ? valued : rows;
        const sub = valued.reduce((s, h) => s + h.latest.value_acct, 0);
        const cost = basis.reduce((s, h) => s + h.cost_acct, 0);
        return (
          <div key={platform} className="mh-group">
            <div className="mh-group__head">
              <span className="mh-group__name">{platform}</span>
              <span className="mh-group__sum">
                cost <Money value={cost} currency={ccy} />
                {valued.length > 0 && (
                  <>
                    {" · "}value <Money value={sub} currency={ccy} />
                  </>
                )}
              </span>
            </div>
            <DataTable columns={columns} rows={rows} rowKey={(h) => h.id} />
          </div>
        );
      })}
    </section>
  );
}

function HoldingModal({ accountId, holding, onClose, onSaved }) {
  const isNew = holding.id == null;
  const initial = {
    name: holding.name || "",
    currency: holding.currency || "GBP",
    asset_class: holding.asset_class || "private",
    platform: holding.platform || "",
    kind: holding.kind || "units",
    status: holding.status || "active",
    acquired_on: holding.acquired_on || today(),
    quantity: holding.quantity ?? "",
    cost_local: holding.cost_local ?? "",
    cost_acct: holding.cost_acct_source === "entered" ? holding.cost_acct : "",
    proceeds_acct: holding.proceeds_acct ?? "",
    note: holding.note || "",
  };
  const [f, setF] = useState(initial);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const numOrNull = (v) => (v === "" || v == null ? null : Number(v));
  const body = () => {
    const all = {
      name: f.name.trim(),
      currency: f.currency,
      asset_class: f.asset_class,
      platform: f.platform.trim() || null,
      kind: f.kind,
      status: f.status,
      acquired_on: f.acquired_on,
      quantity: f.kind === "units" ? numOrNull(f.quantity) : null,
      cost_local: numOrNull(f.cost_local),
      // Blank = the FX default (invested × rate on the purchase date).
      cost_acct: numOrNull(f.cost_acct),
      proceeds_acct: f.status === "exited" ? numOrNull(f.proceeds_acct) : null,
      note: f.note.trim() || null,
    };
    if (isNew) {
      const b = { ...all };
      for (const k of Object.keys(b)) if (b[k] == null) delete b[k];
      return b;
    }
    // A patch sends only what changed — re-sending an unchanged cost would turn
    // an FX-default cost into an "entered" one.
    const changed = {};
    for (const k of Object.keys(all)) {
      if (k === "currency") continue;
      const before = k === "cost_acct" ? numOrNull(initial.cost_acct) : initial[k] === "" ? null : initial[k];
      const norm = (v) => (v == null || v === "" ? null : typeof v === "number" ? v : String(v));
      if (norm(all[k]) !== norm(before)) changed[k] = all[k];
    }
    return changed;
  };

  const save = async () => {
    setBusy(true);
    setErr("");
    try {
      if (isNew) await Rest.post(`/manual-holdings/${accountId}/holdings`, body());
      else await Rest.patch(`/manual-holdings/${accountId}/holdings/${holding.id}`, body());
      await onSaved();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setErr("");
    try {
      await Rest.del(`/manual-holdings/${accountId}/holdings/${holding.id}`);
      await onSaved();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={busy ? undefined : onClose}
      dismissable={!busy}
      size="wide"
      title={isNew ? "Add holding" : `Edit ${holding.name}`}
      description="Enter what you put in, in the holding's own currency. Leave the account-currency cost blank to use the rate on the purchase date, or type the amount actually sent (fees included)."
      footer={
        <>
          {!isNew && (
            <button type="button" className={confirmDelete ? "btn btn--danger" : "btn btn--danger-soft"} disabled={busy}
              onClick={confirmDelete ? remove : () => setConfirmDelete(true)}
              title="Only a holding no valuation has used can be deleted — otherwise mark it exited or failed">
              {confirmDelete ? `Delete ${holding.name}?` : "Delete"}
            </button>
          )}
          <button type="button" className="btn btn--outline" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" disabled={busy} onClick={save}>
            {busy ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <div className="mh-form">
        <label>Name<input value={f.name} onChange={set("name")} /></label>
        <label>Platform<input value={f.platform} onChange={set("platform")} placeholder="e.g. Republic Europe" /></label>
        <label>
          Currency
          <select value={f.currency} onChange={set("currency")} disabled={!isNew}>
            {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label>
          Type
          <select value={f.asset_class} onChange={set("asset_class")}>
            {ASSET_CLASSES.map((c) => <option key={c} value={c}>{c.replace("_", " ")}</option>)}
          </select>
        </label>
        <label>
          Valued by
          <select value={f.kind} onChange={set("kind")}>
            <option value="units">shares × price</option>
            <option value="amount">amount only (no shares yet)</option>
          </select>
        </label>
        {f.kind === "units" && (
          <label>Shares<input type="number" step="any" value={f.quantity} onChange={set("quantity")} /></label>
        )}
        <label>Purchase date<input type="date" value={f.acquired_on} onChange={set("acquired_on")} /></label>
        <label>Invested ({f.currency})<input type="number" step="0.01" value={f.cost_local} onChange={set("cost_local")} /></label>
        <label>
          Cost in account currency
          <input type="number" step="0.01" value={f.cost_acct} onChange={set("cost_acct")} placeholder="blank = rate on purchase date" />
        </label>
        <label>
          Status
          <select value={f.status} onChange={set("status")}>
            <option value="active">active</option>
            <option value="exited">exited (sold)</option>
            <option value="failed">failed (worth 0)</option>
          </select>
        </label>
        {f.status === "exited" && (
          <label>Proceeds received<input type="number" step="0.01" value={f.proceeds_acct} onChange={set("proceeds_acct")} /></label>
        )}
        <label className="mh-form__wide">Note<input value={f.note} onChange={set("note")} /></label>
      </div>
      {err && <p className="mh-error" role="alert">{err}</p>}
    </Modal>
  );
}

// ---- valuations ------------------------------------------------------------

function ValuationPanel({ accountId, holdings, valuations, ccy, onSaved }) {
  const latest = valuations[0]?.valued_on || null;
  const [date, setDate] = useState(today());
  const [inputs, setInputs] = useState({});
  const [preview, setPreview] = useState(null);
  const [stale, setStale] = useState(false);
  const [ackFx, setAckFx] = useState(false);
  const [force, setForce] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const active = holdings.filter((h) => h.status === "active");

  const items = () =>
    active
      .map((h) => {
        const v = inputs[h.id];
        if (v == null || v === "") return null; // blank → carried from the last valuation
        return h.kind === "units" ? { holding_id: h.id, price: Number(v) } : { holding_id: h.id, value: Number(v) };
      })
      .filter(Boolean);

  const reset = () => {
    setPreview(null);
    setStale(false);
    setErr("");
  };
  // A changed input is a different valuation: acknowledgements given for the old
  // one must not carry over to it.
  const invalidate = () => {
    reset();
    setDone("");
    setAckFx(false);
    setForce(false);
  };

  const runPreview = async () => {
    setBusy(true);
    reset();
    try {
      const body = { valuedOn: date, items: items(), ackStaleFx: ackFx, force };
      setPreview(Rest.unwrap(await Rest.post(`/manual-holdings/${accountId}/valuations/preview`, body)));
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setErr("");
    try {
      await Rest.post(`/manual-holdings/${accountId}/valuations`, {
        valuedOn: date, items: items(), ackStaleFx: ackFx, force,
        expect: { mtm_amount: preview.mtm_amount, total: preview.total },
      });
      const booked = preview.mtm_amount;
      reset();
      setInputs({});
      setAckFx(false);
      setForce(false);
      setDone(`Saved ${date}: balance ${preview.total.toFixed(2)} ${ccy}, Unrealized G/L ${booked.toFixed(2)} booked.`);
      await onSaved();
    } catch (e) {
      if (e.code === "PREVIEW_STALE" && e.current) {
        setPreview(e.current);
        setStale(true);
      } else {
        setErr(e.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const removeLatest = async () => {
    setBusy(true);
    setErr("");
    try {
      await Rest.del(`/manual-holdings/${accountId}/valuations/${latest}`);
      setConfirmDelete(false);
      await onSaved();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const blockedCodes = (preview?.blocked || []).map((b) => b.code);
  // An acknowledgement changes what the server ACCEPTS, not what it computes, so
  // the previewed figures (sent back as `expect`) still hold. A cost gap has no
  // override: a holding, platform cash or a transfer has to be fixed first.
  const canSave = preview && blockedCodes.every((c) => (c === "FX_STALE" && ackFx) || (c === "IMPLAUSIBLE" && force));

  const lineColumns = [
    { key: "name", header: "Holding", render: (l) => <>{l.name}{l.carried ? <span className="mh-muted"> · carried</span> : null}</> },
    { key: "value_local", header: "Value", numeric: true, render: (l) => <Money value={l.value_local} currency={l.currency} /> },
    {
      key: "fx_rate",
      header: `${ccy} per unit`,
      numeric: true,
      render: (l) =>
        l.currency === ccy ? "—" : (
          <span>
            {Number(l.fx_rate).toFixed(4)}
            <span className="mh-muted"> · {l.fx_rate_date}</span>
          </span>
        ),
    },
    { key: "value_acct", header: `Value ${ccy}`, numeric: true, render: (l) => <Money value={l.value_acct} currency={ccy} /> },
    { key: "price_period", header: "Price Δ", numeric: true, render: (l) => <Delta value={l.price_period} currency={ccy} /> },
    {
      key: "fx_period",
      header: "FX Δ",
      numeric: true,
      render: (l) => (
        <span title={l.cost_acct_source === "entered" ? "FX & costs — the entered cost includes fees" : undefined}>
          <Delta value={l.fx_period} currency={ccy} />
        </span>
      ),
    },
    { key: "unrealized", header: "Since purchase", numeric: true, render: (l) => <Delta value={l.unrealized} currency={ccy} /> },
  ];

  return (
    <section className="panel">
      <h2>Valuations</h2>
      {valuations.length > 0 ? (
        <ul className="mh-vals">
          {valuations.slice(0, 6).map((v) => (
            <li key={v.valued_on}>
              <span>{v.valued_on}</span> <Money value={v.total} currency={ccy} />
              {v.mtm_amount != null && (
                <span className="mh-muted">
                  G/L <Delta value={v.mtm_amount} currency={ccy} />
                </span>
              )}
              {v.valued_on === latest && (
                <button type="button" className="btn btn--xs btn--ghost" disabled={busy} onClick={() => setConfirmDelete(true)}
                  title="Delete this valuation: its snapshot, balance and Unrealized G/L row go together">
                  delete
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mh-note">No valuation yet. The first one books all gain or loss since each purchase.</p>
      )}

      <h3>New valuation</h3>
      <div className="mh-val-head">
        <label>
          Valuation date{" "}
          <input type="date" value={date} min={latest || undefined} onChange={(e) => { setDate(e.target.value); invalidate(); }} />
        </label>
        {latest && <span className="mh-muted">on or after {latest} (the latest)</span>}
      </div>
      <div className="mh-inputs-wrap">
      <table className="mh-inputs">
        <thead>
          <tr><th>Holding</th><th>Enter</th><th className="num">Last</th></tr>
        </thead>
        <tbody>
          {active.map((h) => (
            <tr key={h.id}>
              <td>{h.name} <span className="mh-muted">{h.currency}</span></td>
              <td>
                <input
                  type="number"
                  step="any"
                  placeholder={h.kind === "units" ? "price per share" : "total value"}
                  value={inputs[h.id] ?? ""}
                  onChange={(e) => { setInputs((x) => ({ ...x, [h.id]: e.target.value })); invalidate(); }}
                  inputMode="decimal"
                  aria-label={`${h.name} ${h.kind === "units" ? "price per share" : "total value"} (${h.currency})`}
                />
              </td>
              <td className="num mh-muted">
                {h.latest
                  ? h.kind === "units"
                    ? `${Number(h.latest.price_local).toLocaleString("en-US", { maximumFractionDigits: 6 })} / share`
                    : <Money value={h.latest.value_local} currency={h.currency} />
                  : <>cost <Money value={h.cost_local} currency={h.currency} /></>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <p className="mh-muted">Leave a field blank to carry the last price (or cost, if never valued).</p>
      <button type="button" className="btn btn--outline" disabled={busy} onClick={runPreview}>
        {busy && !preview ? "Previewing…" : "Preview"}
      </button>
      {err && <p className="mh-error" role="alert">{err}</p>}
      {done && <p className="mh-done" role="status">{done}</p>}

      <ConfirmModal
        state={confirmDelete ? {
          title: `Delete the ${latest} valuation?`,
          message: `Its snapshot, the ${latest} balance and its Unrealized G/L row are removed together; the account returns to the previous valuation.`,
          confirmLabel: "Delete valuation",
          danger: true,
        } : null}
        busy={busy}
        onConfirm={removeLatest}
        onCancel={() => setConfirmDelete(false)}
      />

      {preview && (
        <div className="mh-preview">
          {stale && (
            <p className="mh-warn" role="status">
              <strong>The figures moved since you previewed them.</strong> Nothing was written. These are the current figures — saving applies these.
            </p>
          )}
          {preview.blocked.length > 0 && (
            <div className="mh-warn" role="status">
              {preview.blocked.map((b) => (
                <p key={b.code}>
                  <strong>{b.code === "COST_GAP" ? "Cost doesn't match contributions." : b.code === "FX_STALE" ? "Old exchange rate." : "Large change."}</strong>{" "}
                  {b.message}
                  {b.code === "FX_STALE" && (
                    <label className="mh-ack"><input type="checkbox" checked={ackFx} onChange={(e) => setAckFx(e.target.checked)} /> use it anyway</label>
                  )}
                  {b.code === "IMPLAUSIBLE" && (
                    <label className="mh-ack"><input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} /> the change is real — book it</label>
                  )}
                </p>
              ))}
            </div>
          )}

          {preview.implausible && force && (
            <p className="mh-muted">
              Above the 15% guard ({(preview.implausible_pct * 100).toFixed(1)}% of the balance) — booking it because you confirmed the change is real.
            </p>
          )}
          <DataTable columns={lineColumns} rows={preview.lines} rowKey={(l) => l.holding_id} />

          <div className="mh-explain">
            <span>Price <Delta value={preview.explain.price_period} currency={ccy} /></span>
            <span>+ FX <Delta value={preview.explain.fx_period} currency={ccy} /></span>
            <span title="Change in (holdings cost − money transferred in) since the previous valuation">
              + unreconciled cost <Delta value={preview.explain.cost_change} currency={ccy} />
            </span>
            {Math.abs(preview.explain.other) >= 0.01 && (
              <span title="Something moved the ledger that is neither a price, a rate nor the cost gap — e.g. an Unrealized G/L row edited by hand">
                + other <Delta value={preview.explain.other} currency={ccy} />
              </span>
            )}
            <span className="mh-explain__total">
              = Unrealized G/L {preview.blocked.length ? "that would be booked" : "to book"} on {preview.valued_on}:{" "}
              <Delta value={preview.mtm_amount} currency={ccy} bold={!preview.blocked.length} />
            </span>
          </div>
          <p className="mh-muted">
            New balance <Money value={preview.total} currency={ccy} /> · holdings cost{" "}
            <Money value={preview.cost.cost_total} currency={ccy} /> vs transferred in{" "}
            <Money value={preview.cost.contributions} currency={ccy} /> (gap{" "}
            <Money value={preview.cost.gap} currency={ccy} />, limit <Money value={preview.cost.threshold} currency={ccy} />)
          </p>

          <div className="mh-save">
            <button type="button" className="btn btn--primary" disabled={busy || !canSave} onClick={save}>
              {busy ? "Saving…" : "Save valuation"}
            </button>
            {!canSave && (
              <span className="mh-muted">
                {blockedCodes.includes("COST_GAP")
                  ? "Blocked: fix the cost gap first — add the missing holding or platform cash, or correct a cost."
                  : "Confirm the warning above to save."}
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
