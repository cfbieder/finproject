import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import Rest from "../js/rest";
import DataTable from "../components/DataTable/DataTable";
import Modal from "../components/Modal/Modal";
import "./TaxForeignAccounts.css";

/**
 * TaxForeignAccounts — CR082 P1. Which accounts are foreign, and everything
 * FinCEN 114 asks about them that fin cannot derive.
 *
 * This is a REVIEW surface, not a data-entry one. Rows arrive seeded from last
 * year's papers and every one lands `unreviewed`, because the seed is known to
 * need checking — the accountant's sheet disagrees with the filed form's last-4
 * on three PKO lines, one row was an aggregate, and two Part IV names are simply
 * absent from the client copy. The counter at the top only reaches zero when a
 * human has looked at each row, which is the whole reason `review_state` is
 * tri-state rather than a boolean.
 *
 * The account link is the part worth being careful about. A designation with no
 * fin account behind it gets no computed maximum; one linked to the WRONG fin
 * account gets a real, correctly-computed maximum belonging to something else —
 * which no total would reveal, because every individual figure is right. So the
 * picker shows each candidate's computed maximum beside its name: the three PKO
 * PLN accounts are indistinguishable by name and differ by over a million
 * dollars, and the figures are what tell them apart.
 */

const PARTS = [
  ["II", "II — I own it"],
  ["III", "III — jointly owned"],
  ["IV", "IV — signature authority only"],
];
const KINDS = [["bank", "Bank"], ["securities", "Securities"], ["other", "Other"]];
const STATES = [
  ["unreviewed", "Not yet reviewed"],
  ["reportable", "Reportable"],
  ["excluded", "Excluded"],
];

const fmt = (n, ccy) =>
  n === null || n === undefined
    ? "—"
    : `${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${ccy ? ` ${ccy}` : ""}`;

export default function TaxForeignAccounts() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const [taxYear, setTaxYear] = useState(new Date().getFullYear() - 1);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await Rest.fetchJson("/api/v2/tax/designations");
      setRows(r?.data || []);
    } catch (e) {
      setError(e?.message || "Failed to load designations.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(() => {
    const c = { unreviewed: 0, reportable: 0, excluded: 0, unlinked: 0 };
    for (const r of rows) {
      c[r.review_state] = (c[r.review_state] || 0) + 1;
      if (!r.account_id && r.review_state !== "excluded") c.unlinked += 1;
    }
    return c;
  }, [rows]);

  const patch = async (id, body) => {
    await Rest.fetchJson(`/api/v2/tax/designations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    await load();
  };

  const columns = [
    {
      key: "review_state",
      header: "Reviewed",
      render: (r) => (
        <select
          className={`tfa-state tfa-state--${r.review_state}`}
          value={r.review_state}
          onChange={(e) => patch(r.id, { review_state: e.target.value })}
        >
          {STATES.map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
      ),
    },
    { key: "fbar_part", header: "Part", render: (r) => r.fbar_part || "—" },
    {
      key: "label",
      header: "Account",
      render: (r) => (
        <div className="tfa-label">
          <span className="tfa-label__main">{r.label}</span>
          {r.notes ? <span className="tfa-label__note">{r.notes}</span> : null}
        </div>
      ),
    },
    { key: "institution_name", header: "Institution", render: (r) => r.institution_name || "—" },
    { key: "institution_country", header: "Country", render: (r) => r.institution_country || "—" },
    {
      key: "account_number_masked",
      header: "Number",
      render: (r) => (
        <span className="tfa-num">{r.account_number_masked || <em>none</em>}</span>
      ),
    },
    {
      key: "account_id",
      header: "Linked to fin",
      render: (r) => {
        if (r.account_id) return <span className="tfa-linked">{r.account_name}</span>;
        // Unlinked means no ledger behind the line, so its maximum can only be
        // typed. That is a problem worth seeing only if the line is actually
        // going on the form — an EXCLUDED row is unlinked on purpose and an
        // amber flag on it is noise that trains you to ignore the amber.
        if (r.review_state === "excluded") {
          return <span className="tfa-unlinked">not linked</span>;
        }
        return (
          <span className="tfa-unlinked tfa-unlinked--warn">
            <AlertTriangle size={14} aria-hidden="true" />
            not linked — figure must be typed
          </span>
        );
      },
    },
    {
      key: "actions",
      header: "",
      render: (r) => (
        <button type="button" className="btn btn--secondary btn--xs" onClick={() => setEditing(r)}>
          Edit
        </button>
      ),
    },
  ];

  return (
    <div className="tfa-page">
      <header className="tfa-header">
        <div>
          <h1>Foreign accounts</h1>
          <p className="tfa-sub">
            Which accounts FinCEN Form 114 reports, and the details it asks for that fin
            cannot derive. Entered once; reviewed each year.
          </p>
        </div>
        <div className="tfa-header__tools">
          <label className="tfa-year">
            Figures for
            <input
              type="number"
              value={taxYear}
              onChange={(e) => setTaxYear(Number(e.target.value))}
            />
          </label>
          <button type="button" className="btn btn--primary btn--sm" onClick={() => setAdding(true)}>
            Add account
          </button>
        </div>
      </header>

      <div className="tfa-counts">
        <span className={counts.unreviewed ? "tfa-chip tfa-chip--warn" : "tfa-chip tfa-chip--ok"}>
          {counts.unreviewed} not yet reviewed
        </span>
        <span className="tfa-chip">{counts.reportable} reportable</span>
        <span className="tfa-chip">{counts.excluded} excluded</span>
        {counts.unlinked ? (
          <span className="tfa-chip tfa-chip--warn">
            {counts.unlinked} without a fin account
          </span>
        ) : null}
      </div>

      {counts.unreviewed > 0 && (
        <p className="tfa-banner">
          Seeded from last year&apos;s papers — nothing here is confirmed yet. The seed is
          known to need checking, so work down to zero rather than trusting the rows.
        </p>
      )}

      {error && <p className="tfa-error">{error}</p>}
      {loading ? (
        <p>Loading…</p>
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
          emptyMessage="No designations yet."
        />
      )}

      {adding && (
        <AddDialog
          onClose={() => setAdding(false)}
          onCreated={async (newRow) => {
            setAdding(false);
            await load();
            setEditing(newRow);   // straight into the full form for the rest
          }}
        />
      )}

      {editing && (
        <EditDialog
          row={editing}
          taxYear={taxYear}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

/**
 * The edit form. Fetches the FULL account number on open rather than taking it
 * from the list payload, which carries only a mask — see the route's note: this
 * is blast radius, not a boundary.
 */
/**
 * Create a new designation — a Part IV company, a bank fin does not track, an
 * account opened this year.
 *
 * It asks only for what the schema's two CHECKs require, then hands straight
 * over to the full editor for the address and the rest. The row is created
 * report-only (no `account_id`): every new line starts with its own currency
 * and number, and linking it to a fin account is a separate, deliberate act in
 * the editor, where the candidate list shows each account's computed maximum.
 * The two constraints are the reason currency and number are mandatory here:
 *
 *   (account_id IS NULL) = (own_currency IS NOT NULL)
 *   account_id IS NOT NULL OR own_account_number IS NOT NULL
 */
function AddDialog({ onClose, onCreated }) {
  const [form, setForm] = useState({
    label: "", fbar_part: "IV", account_kind: "bank",
    own_currency: "PLN", own_account_number: "",
    institution_name: "", institution_country: "PL",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const missing = !form.label.trim() || !form.own_currency.trim()
    || !form.own_account_number.trim();

  const create = async () => {
    setSaving(true);
    setErr("");
    try {
      const r = await Rest.fetchJson("/api/v2/tax/designations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          own_currency: form.own_currency.trim().toUpperCase(),
          review_state: "reportable",   // you added it on purpose; it is not unreviewed
        }),
      });
      await onCreated({ ...form, id: r?.data?.id, account_id: null, review_state: "reportable" });
    } catch (e) {
      setErr(e?.message || "Could not create the account.");
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Add a foreign account"
      description="The minimum Form 114 needs to identify it. The address and the rest come next."
      dismissable={!saving}
      footer={
        <>
          <button type="button" className="btn btn--secondary btn--sm" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={create}
            disabled={saving || missing}
            title={missing ? "Label, currency and account number are all required." : ""}
          >
            {saving ? "Creating…" : "Create and continue"}
          </button>
        </>
      }
    >
      <div className="tfa-modal">
        <div className="tfa-grid">
          <Field label="Label" wide>
            <input
              value={form.label}
              onChange={set("label")}
              placeholder="how you will recognise it, e.g. Erste 1791 (PLN)"
            />
          </Field>
          <Field label="FBAR part">
            <select value={form.fbar_part} onChange={set("fbar_part")}>
              {PARTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label="Account type">
            <select value={form.account_kind} onChange={set("account_kind")}>
              {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label="Currency">
            <input
              maxLength={3}
              value={form.own_currency}
              onChange={(e) => setForm((f) => ({ ...f, own_currency: e.target.value.toUpperCase() }))}
            />
          </Field>
          <Field label="Country (2-letter)">
            <input
              maxLength={2}
              value={form.institution_country}
              onChange={(e) =>
                setForm((f) => ({ ...f, institution_country: e.target.value.toUpperCase() }))}
            />
          </Field>
          <Field label="Account number" wide>
            <input
              value={form.own_account_number}
              onChange={set("own_account_number")}
              placeholder="IBAN or other designation — Form 114 accepts either"
            />
          </Field>
          <Field label="Institution" wide>
            <input value={form.institution_name} onChange={set("institution_name")} />
          </Field>
        </div>
        <p className="tfa-add__note">
          Created as a <strong>report-only</strong> line: its maximum is typed from a
          statement rather than computed. If fin does track the account, link it in the
          next step — the picker shows each candidate&apos;s {new Date().getFullYear() - 1}{" "}
          maximum, which is what tells same-named accounts apart.
        </p>
        {err && <p className="tfa-error">{err}</p>}
      </div>
    </Modal>
  );
}

function EditDialog({ row, taxYear, onClose, onSaved }) {
  const [form, setForm] = useState({ ...row });
  const [fullNumber, setFullNumber] = useState("");
  const [candidates, setCandidates] = useState(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const currency = row.account_currency || row.own_currency || "";

  useEffect(() => {
    let alive = true;
    Rest.fetchJson(`/api/v2/tax/designations/${row.id}/number`)
      .then((r) => alive && setFullNumber(r?.data?.account_number || ""))
      .catch(() => alive && setFullNumber(""));
    if (!row.account_id && currency) {
      Rest.fetchJson(
        `/api/v2/tax/unlinked-candidates?currency=${encodeURIComponent(currency)}` +
          `&taxYear=${taxYear}&institution=${encodeURIComponent(row.institution_name || "")}`
      )
        .then((r) => alive && setCandidates(r?.data || []))
        .catch(() => alive && setCandidates([]));
    }
    return () => {
      alive = false;
    };
  }, [row.id, row.account_id, row.institution_name, currency, taxYear]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    setSaving(true);
    setErr("");
    try {
      const body = {
        label: form.label,
        fbar_part: form.fbar_part || null,
        account_kind: form.account_kind || null,
        institution_name: form.institution_name,
        institution_street: form.institution_street,
        institution_city: form.institution_city,
        institution_region: form.institution_region,
        institution_postal: form.institution_postal,
        institution_country: form.institution_country,
        joint_owner_name: form.joint_owner_name,
        joint_owner_tin: form.joint_owner_tin,
        joint_owner_address: form.joint_owner_address,
        notes: form.notes,
        review_state: form.review_state,
      };
      // Only a report-only line stores its own number; a linked row's number
      // lives on the ledger account (the schema CHECK enforces the pairing).
      if (!form.account_id) body.own_account_number = fullNumber;
      if (form.account_id !== row.account_id) body.account_id = form.account_id || null;
      await Rest.fetchJson(`/api/v2/tax/designations/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      await onSaved();
    } catch (e) {
      setErr(e?.message || "Save failed.");
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={row.label}
      description="Everything Form 114 asks about this account that fin cannot derive."
      size="wide"
      dismissable={!saving}
      footer={
        <>
          <button type="button" className="btn btn--secondary btn--sm" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn--primary btn--sm" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <div className="tfa-modal">
        <div className="tfa-grid">
          <Field label="Label"><input value={form.label || ""} onChange={set("label")} /></Field>
          <Field label="FBAR part">
            <select value={form.fbar_part || ""} onChange={set("fbar_part")}>
              <option value="">—</option>
              {PARTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label="Account type">
            <select value={form.account_kind || ""} onChange={set("account_kind")}>
              <option value="">—</option>
              {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label="Review state">
            <select value={form.review_state} onChange={set("review_state")}>
              {STATES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>

          <Field label="Account number" wide>
            <input
              value={fullNumber}
              onChange={(e) => setFullNumber(e.target.value)}
              disabled={!!form.account_id}
              placeholder={form.account_id ? "held on the linked fin account" : "IBAN or other designation"}
            />
          </Field>

          <Field label="Institution" wide>
            <input value={form.institution_name || ""} onChange={set("institution_name")} />
          </Field>
          <Field label="Street" wide>
            <input value={form.institution_street || ""} onChange={set("institution_street")} />
          </Field>
          <Field label="City"><input value={form.institution_city || ""} onChange={set("institution_city")} /></Field>
          <Field label="Region"><input value={form.institution_region || ""} onChange={set("institution_region")} /></Field>
          <Field label="Postal"><input value={form.institution_postal || ""} onChange={set("institution_postal")} /></Field>
          <Field label="Country (2-letter)">
            <input
              maxLength={2}
              value={form.institution_country || ""}
              onChange={(e) => setForm((f) => ({ ...f, institution_country: e.target.value.toUpperCase() }))}
            />
          </Field>

          {form.fbar_part === "III" && (
            <>
              <Field label="Joint owner" wide>
                <input value={form.joint_owner_name || ""} onChange={set("joint_owner_name")} />
              </Field>
              <Field label="Joint owner TIN">
                <input value={form.joint_owner_tin || ""} onChange={set("joint_owner_tin")} />
              </Field>
              <Field label="Joint owner address">
                <input value={form.joint_owner_address || ""} onChange={set("joint_owner_address")} />
              </Field>
            </>
          )}

          <Field label="Notes" wide>
            <textarea rows={2} value={form.notes || ""} onChange={set("notes")} />
          </Field>
        </div>

        {!row.account_id && (
          <section className="tfa-link">
            <h3>Link to a fin account</h3>
            <p className="tfa-link__why">
              Without a link there is no computed maximum and you type the figure by hand.
              Linked to the <em>wrong</em> account, the figure is real and belongs to
              something else — which no total will catch. Every unlinked {currency || "—"}{" "}
              account is listed, including properties and holdings, so check the{" "}
              <strong>group</strong> as well as the name; {taxYear} maxima are shown so you
              can also tell them apart by amount.
            </p>
            {candidates === null ? (
              <p>Looking for candidates…</p>
            ) : candidates.length === 0 ? (
              <p className="tfa-link__none">
                No unlinked {currency} account in fin. This stays report-only.
              </p>
            ) : (
              <ul className="tfa-cands">
                <li>
                  <label>
                    <input
                      type="radio"
                      name="cand"
                      checked={!form.account_id}
                      onChange={() => setForm((f) => ({ ...f, account_id: null }))}
                    />
                    <span>Leave unlinked (type the figure)</span>
                  </label>
                </li>
                {candidates.map((c) => (
                  <li key={c.id}>
                    <label>
                      <input
                        type="radio"
                        name="cand"
                        checked={form.account_id === c.id}
                        onChange={() => setForm((f) => ({ ...f, account_id: c.id }))}
                      />
                      <span>{c.name}</span>
                      {/* The COA group is the discriminator. Nothing is filtered
                          out of this list, so a property and a company sit in it
                          alongside the bank accounts — and "PL - Properties"
                          beside the name is what makes that obvious at a glance,
                          without a rule that decides for you. */}
                      <span className="tfa-cands__grp">{c.parent_name || "—"}</span>
                      <span className="tfa-cands__amt">
                        {c.refused ? `refused: ${c.refusal}` : `max ${fmt(c.max_native, c.currency)}`}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {err && <p className="tfa-error">{err}</p>}
      </div>
    </Modal>
  );
}

function Field({ label, children, wide }) {
  return (
    <label className={`tfa-field${wide ? " tfa-field--wide" : ""}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}
