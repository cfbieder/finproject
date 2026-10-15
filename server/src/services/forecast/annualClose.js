'use strict';
/**
 * The annual close — CR064 P2.
 *
 * Copies a BASE scenario into next year's base, re-anchors every module at one year-end, moves
 * `PeriodStart` with it, and re-creates the base's variants against the copy. Owner decision
 * (2026-08-02): the close MINTS A COPY each year, so last year's scenario survives as a record.
 *
 * The years follow the owner's rule from CR075 (2026-08-07): *forecast year −2 = ACTUAL, −1 =
 * BUDGET, 0 = start forecast*. So closing year-end Y (the last ACTUAL) gives PeriodStart = Y + 2,
 * and the scenario is named for its budget year Y + 1 — "2026 Base" closes into "2027 Base".
 * A module anchored at the end of PeriodStart − 2 is therefore current, not a year behind;
 * CR064 §3.1's "a year behind" reading predates that rule.
 *
 * It replaces `crud.refreshModulesFromActuals`, which was blind and wrong three ways (measured on
 * prod 2026-10-15 against 2026 Base):
 *   • it summed only transactions posted DIRECTLY on the module's account and ignored the opening
 *     balance, so every module on a parent account (Fidelity, both credit-card groups, Tax
 *     Liabilities) found nothing and was silently left on its old anchor;
 *   • it wrote the ledger value into `base_value`, the COST BASIS, for every module — Fidelity
 *     Stocks would have gone from 1,019,072 (cost) to 1,369,072 (market), and every later sale's
 *     capital-gains tax with it;
 *   • it valued USD as Σ historical `base_amount`, while the engine reads a module's FX from the
 *     ratio base_value_usd / base_value (index.js), so the ratio was a blended historical rate.
 *
 * The ledger value now comes from the Balance Sheet report — the same figure the module form
 * shows as "PY Actual", which already rolls up parents, adds opening balances, reads Fidelity's
 * feed balance and converts at the year-end rate. On prod it matches 14 of the 22 valued modules
 * of 2026 Base to the unit; the other eight are values the owner set by hand.
 *
 * Which is why the two value columns are decided SEPARATELY, per module: a column is rolled to
 * the ledger by default only when it TRACKED the ledger at the old anchor (equal within one unit
 * of local currency). A hand-set figure — UB's 4,000,000 PLN cost, a CVC fund's committed basis —
 * stays put unless the owner ticks it in the preview, which shows both numbers.
 */

const db = require('../../v2/db');
const repo = require('../../v2/repositories').forecast;
const variants = require('../../v2/services/forecastVariants');
const reports = require('../reports');

/** "Tracked the ledger" tolerance, in the module's own currency. */
const TRACK_TOLERANCE = 1;

/**
 * Patch keys that pin a VALUE the close re-bases — flagged in the preview of a carried variant,
 * because they carry as they are. (A pinned `base_date` or `PeriodStart` is shifted instead.)
 */
const VALUE_PIN_KEYS = new Set(['base_value', 'base_value_usd', 'market_value', 'market_value_usd']);

const ISO_YEAR_END = /^(\d{4})-12-31$/;

function findNode(nodes, name) {
  const stack = [...(nodes || [])];
  while (stack.length) {
    const n = stack.pop();
    if (n && n.name === name) return n;
    if (n && Array.isArray(n.children)) stack.push(...n.children);
  }
  return null;
}

/** A node's local-currency value: its own for a leaf, the leaves' sum when they share one currency. */
function localOf(node) {
  if (!Array.isArray(node.children) || node.children.length === 0) {
    return { local: node.total == null ? null : Number(node.total), currency: node.currency || null };
  }
  let sum = 0;
  let currency;
  const stack = [...node.children];
  while (stack.length) {
    const n = stack.pop();
    if (Array.isArray(n.children) && n.children.length > 0) { stack.push(...n.children); continue; }
    if (n.total == null) continue;
    if (currency === undefined) currency = n.currency || null;
    else if (currency !== (n.currency || null)) return { local: null, currency: 'mixed' };
    sum += Number(n.total);
  }
  return { local: currency === undefined ? 0 : sum, currency: currency ?? null };
}

/** { local, usd } for an account at a date, or { reason } when it cannot stand for a module. */
function ledgerFor(report, accountName, moduleCurrency) {
  const node = findNode(report['Balance Sheet Accounts'], accountName);
  if (!node) return { reason: 'account not on the balance sheet' };
  const usd = Number(node.totalUSD) || 0;
  const { local, currency } = localOf(node);
  const cur = moduleCurrency || 'USD';
  if (currency === 'mixed') {
    return cur === 'USD' ? { local: usd, usd } : { reason: `account mixes currencies; module is ${cur}` };
  }
  if (currency && currency !== cur) return { reason: `account is ${currency}; module is ${cur}` };
  return { local: local ?? 0, usd };
}

const near = (a, b) => a != null && b != null && Math.abs(Number(a) - Number(b)) <= TRACK_TOLERANCE;
const round2 = (n) => (n == null ? null : Math.round(Number(n) * 100) / 100);

function parseYearEnd(asOfDate) {
  const m = ISO_YEAR_END.exec(String(asOfDate || ''));
  if (!m) throw Object.assign(new Error('The close date must be a 31 December (YYYY-12-31)'), { status: 400 });
  return Number(m[1]);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/** The leading year in a name, replaced by `to` — "2026 Upside" → "2027 Upside". */
function renameForYear(name, from, to) {
  const re = new RegExp(`\\b${from}\\b`);
  return re.test(name) ? name.replace(re, String(to)) : `${name} (${to})`;
}

async function loadBase(client, scenarioId) {
  const s = (await client.query('SELECT * FROM forecast_scenarios WHERE id = $1', [scenarioId])).rows[0];
  if (!s) throw Object.assign(new Error('Scenario not found'), { status: 404 });
  if (s.parent_scenario_id) {
    throw Object.assign(new Error('The annual close runs on a base scenario; its variants come across with it'), { status: 400 });
  }
  return s;
}

async function periodOf(client, name) {
  const raw = (await client.query(`SELECT value FROM forecast_assumptions WHERE key = 'scenarios'`)).rows[0]?.value;
  const list = typeof raw === 'string' ? JSON.parse(raw) : raw || [];
  const e = list.find((x) => x && x.Name === name) || {};
  if (e.PeriodStart == null) {
    // Without a period the close cannot move one — and would report that it had.
    throw Object.assign(new Error(`Scenario '${name}' has no PeriodStart in its assumptions; set its period first`), { status: 400 });
  }
  return { periodStart: Number(e.PeriodStart), periodEnd: e.PeriodEnd ?? null };
}

/**
 * Per-module plan. `rollBase` / `rollMarket` are the DEFAULTS; `canRoll` false means neither
 * column may be rolled (the reason says why), but the date still moves.
 */
async function planModules(client, scenarioId, asOfDate) {
  const report = await reports.buildBalanceSheetReport(asOfDate);
  const mods = (await client.query(
    `SELECT m.id, m.name, m.module_type, m.currency, m.base_date, m.base_value, m.base_value_usd,
            m.market_value, m.market_value_usd, m.is_matched, m.has_valuation,
            m.loan_interest_rate, a.name AS account_name
       FROM forecast_modules m LEFT JOIN accounts a ON a.id = m.account_id
      WHERE m.scenario_id = $1 ORDER BY m.has_valuation DESC, m.module_type, m.name`,
    [scenarioId]
  )).rows;

  // What each account read at each module's OLD anchor — "did this column track the ledger?"
  const oldReports = new Map();
  const reportAt = async (date) => {
    if (!oldReports.has(date)) oldReports.set(date, await reports.buildBalanceSheetReport(date));
    return oldReports.get(date);
  };

  const rows = [];
  for (const m of mods) {
    const row = {
      moduleId: m.id, name: m.name, type: m.module_type, account: m.account_name,
      currency: m.currency || 'USD', baseDate: m.base_date,
      baseValue: round2(m.base_value), marketValue: round2(m.market_value),
      ledger: null, ledgerUsd: null, canRoll: false, rollBase: false, rollMarket: false, reason: null,
    };
    if (!m.has_valuation) row.reason = 'flow module — date only';
    else if (!m.is_matched || !m.account_name) row.reason = 'not matched to an account — date only';
    else {
      const now = ledgerFor(report, m.account_name, row.currency);
      if (now.reason) row.reason = now.reason;
      else {
        row.ledger = round2(now.local);
        row.ledgerUsd = round2(now.usd);
        row.canRoll = true;
        const then = m.base_date ? ledgerFor(await reportAt(m.base_date), m.account_name, row.currency) : {};
        const isLoan = m.loan_interest_rate != null;
        // A loan's outstanding balance IS its ledger balance (CR062) — both columns follow it.
        row.rollBase = isLoan || (!then.reason && near(m.base_value, then.local));
        row.rollMarket = isLoan || (!then.reason && near(m.market_value, then.local));
        if (!row.rollBase && !row.rollMarket) row.reason = 'values set by hand — kept unless ticked';
      }
    }
    rows.push(row);
  }
  return rows;
}

async function planVariants(client, base, fromYear, toYear) {
  const out = [];
  for (const v of await variants.variantsOf(base.id, client)) {
    const local = (await client.query(
      'SELECT COUNT(*)::int AS n FROM forecast_modules WHERE scenario_id = $1 AND origin_base_id IS NULL', [v.id]
    )).rows[0].n;
    const overrides = (await variants.listOverrides(v.id, client)).map((o) => ({
      kind: o.entity_type,
      target: o.entity_type === 'assumption' ? o.entity_key : null,
      baseEntityId: o.base_entity_id,
      deleted: o.is_deleted,
      fields: Object.keys(o.patch || {}),
      pinsValue: o.entity_type !== 'assumption' && Object.keys(o.patch || {}).some((k) => VALUE_PIN_KEYS.has(k)),
    }));
    const names = new Map((await client.query(
      'SELECT id, name FROM forecast_modules WHERE scenario_id = $1', [base.id]
    )).rows.map((r) => [r.id, r.name]));
    for (const o of overrides) if (o.kind !== 'assumption') o.target = names.get(o.baseEntityId) || '(removed module)';
    out.push({
      id: v.id, name: v.name, newName: renameForYear(v.name, fromYear, toYear),
      overrides,
      carry: local === 0,
      reason: local === 0 ? null : `has ${local} variant-only module(s) — not carried; re-create by hand`,
    });
  }
  return out;
}

/** Read-only: what the close would do. */
async function previewAnnualClose(scenarioId, asOfDate) {
  const year = parseYearEnd(asOfDate);
  const base = await loadBase(db, scenarioId);
  const { periodStart, periodEnd } = await periodOf(db, base.name);
  const fromYear = periodStart - 1;
  const modules = await planModules(db, scenarioId, asOfDate);
  return {
    scenario: { id: base.id, name: base.name, periodStart, periodEnd },
    asOfDate,
    closed: asOfDate < todayIso(),
    newPeriodStart: year + 2,
    suggestedName: renameForYear(base.name, fromYear, year + 1),
    modules,
    variants: await planVariants(db, base, fromYear, year + 1),
  };
}

/**
 * Apply the close. `rollBase` / `rollMarket` are arrays of SOURCE module ids the owner ticked
 * (the preview's defaults, unless changed); `variantNames` maps a source variant id to its new
 * name. One transaction for the base; variants are synced after commit (below).
 */
async function runAnnualClose(scenarioId, { newName, asOfDate, rollBase = [], rollMarket = [], variantNames = {} }) {
  const year = parseYearEnd(asOfDate);
  if (asOfDate >= todayIso()) {
    throw Object.assign(new Error(`${asOfDate} has not happened yet — a year-end balance for it would be today's, labelled as the future`), { status: 400 });
  }
  const name = String(newName || '').trim();
  if (!name) throw Object.assign(new Error('New scenario name is required'), { status: 400 });

  const baseSet = new Set(rollBase.map(Number));
  const marketSet = new Set(rollMarket.map(Number));

  const result = await db.transaction(async (client) => {
    const base = await loadBase(client, scenarioId);
    const { periodStart } = await periodOf(client, base.name);
    const fromYear = periodStart - 1;
    const newPeriodStart = year + 2;
    // A module that is not rolled keeps its place RELATIVE to the period: a flow module sits at
    // PeriodStart − 1 (CR069 pins it there), a planned purchase wherever the owner put it.
    const shift = newPeriodStart - periodStart;
    const plan = await planModules(client, scenarioId, asOfDate);
    const vplan = await planVariants(client, base, fromYear, year + 1);

    const wanted = [name, ...vplan.filter((v) => v.carry).map((v) => (variantNames[v.id] || v.newName).trim())];
    if (new Set(wanted).size !== wanted.length) {
      throw Object.assign(new Error('Two of the new scenarios would share a name'), { status: 400 });
    }
    const taken = (await client.query('SELECT name FROM forecast_scenarios WHERE name = ANY($1)', [wanted])).rows;
    if (taken.length) {
      // copyScenario OVERWRITES an existing name; a close must never do that to a live scenario.
      throw Object.assign(new Error(`Scenario '${taken[0].name}' already exists`), { status: 409 });
    }

    const idMap = new Map();
    const copy = await repo.copyScenario(base.id, name, { client, idMapOut: idMap });

    // Re-anchor every module; roll a value column only where the owner (or the default) said so.
    // A matched module moves to the close date even when its values are kept — the owner's figure
    // is then their estimate AT that year-end. Anything else shifts with the period.
    for (const row of plan) {
      const newId = idMap.get(row.moduleId);
      const takeBase = row.canRoll && baseSet.has(row.moduleId);
      const takeMarket = row.canRoll && marketSet.has(row.moduleId);
      await client.query(
        `UPDATE forecast_modules SET
            base_date = CASE WHEN $8 THEN $2::date
                             ELSE COALESCE((base_date + make_interval(years => $7::int))::date, $2::date) END,
            base_value = CASE WHEN $3 THEN $5::numeric ELSE base_value END,
            base_value_usd = CASE WHEN $3 THEN $6::numeric ELSE base_value_usd END,
            market_value = CASE WHEN $4 THEN $5::numeric ELSE market_value END,
            market_value_usd = CASE WHEN $4 THEN $6::numeric ELSE market_value_usd END,
            updated_at = NOW()
          WHERE id = $1`,
        [newId, asOfDate, takeBase, takeMarket, row.ledger, row.ledgerUsd, shift, row.canRoll]
      );
    }

    // PeriodStart moves with the anchor — the copy route never moved it, so a re-based copy kept
    // last year's period and its "budget year" was a closed year.
    const raw = (await client.query(`SELECT value FROM forecast_assumptions WHERE key = 'scenarios'`)).rows[0]?.value;
    const list = typeof raw === 'string' ? JSON.parse(raw) : raw || [];
    for (const e of list) if (e && e.Name === name) e.PeriodStart = newPeriodStart;
    await client.query(
      `UPDATE forecast_assumptions SET value = $1, updated_at = NOW() WHERE key = 'scenarios'`,
      [JSON.stringify(list)]
    );

    // Variants: a new row against the copy, and each override re-pointed at the copy's module.
    const variantRowIds = new Map(); // old variant module id → its base module id
    const carried = [];
    for (const v of vplan.filter((x) => x.carry)) {
      const vName = (variantNames[v.id] || v.newName).trim();
      const src = (await client.query('SELECT * FROM forecast_scenarios WHERE id = $1', [v.id])).rows[0];
      const nv = (await client.query(
        `INSERT INTO forecast_scenarios (name, description, is_active, parent_scenario_id, cash_sweep_low, cash_sweep_high)
         VALUES ($1, $2, TRUE, $3, $4, $5) RETURNING id`,
        [vName, src.description, copy.id, src.cash_sweep_low, src.cash_sweep_high]
      )).rows[0];

      for (const r of (await client.query(
        'SELECT id, origin_base_id FROM forecast_modules WHERE scenario_id = $1', [v.id]
      )).rows) variantRowIds.set(r.id, r.origin_base_id);

      for (const o of await variants.listOverrides(v.id, client)) {
        const patch = { ...(o.patch || {}) };
        // A link to another module is an id; it may name a BASE module or the old VARIANT's row.
        if (patch.secured_asset_module_id != null) {
          const target = Number(patch.secured_asset_module_id);
          const baseTarget = variantRowIds.get(target) ?? target;
          patch.secured_asset_module_id = idMap.get(baseTarget) ?? null;
        }
        // A pinned period or anchor moves with the base's period, or the variant would be a year
        // shorter (or anchored a year behind) the moment it is carried.
        if (o.entity_type === 'assumption' && o.entity_key === 'PeriodStart' && patch.value != null) {
          patch.value = Number(patch.value) + shift;
        }
        if (o.entity_type !== 'assumption' && patch.base_date) {
          patch.base_date = (await client.query(
            'SELECT ($1::date + make_interval(years => $2::int))::date::text AS d', [patch.base_date, shift]
          )).rows[0].d;
        }
        const baseEntityId = o.entity_type === 'assumption' ? null : (idMap.get(o.base_entity_id) ?? null);
        if (o.entity_type !== 'assumption' && baseEntityId == null) continue; // its base module is gone
        await client.query(
          `INSERT INTO forecast_scenario_overrides (scenario_id, entity_type, base_entity_id, entity_key, patch, is_deleted, note)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [nv.id, o.entity_type, baseEntityId, o.entity_key, JSON.stringify(patch), o.is_deleted, o.note]
        );
      }
      carried.push({ id: nv.id, name: vName, from: v.name });
    }

    return {
      scenario: copy,
      periodStart: newPeriodStart,
      rolled: plan.filter((r) => r.canRoll && (baseSet.has(r.moduleId) || marketSet.has(r.moduleId))).length,
      modules: plan.length,
      carried,
      notCarried: vplan.filter((x) => !x.carry).map((x) => ({ name: x.name, reason: x.reason })),
    };
  });

  // Sync AFTER commit: syncAssumptions writes the assumptions document on its own connection, and
  // inside our transaction it would wait on the row lock we hold — and read a document that does
  // not have the new base yet. A sync that fails here is retried lazily at the variant's build.
  for (const v of result.carried) {
    try {
      await variants.syncVariant(v.id, { force: true });
    } catch (err) {
      v.syncError = err.message;
    }
  }
  return result;
}

/**
 * §3.3 — per scenario, where its account-matched valued modules are anchored, against the last
 * ACTUAL year (PeriodStart − 2, CR075). `behind`: how many sit before it — the scenario needs its
 * annual close. `mixed`: they disagree with each other. Flow modules are excluded (CR069 pins
 * their date and nothing reads it), and so are unmatched ones (a planned purchase's date is the
 * owner's, not the ledger's).
 */
async function anchorStatus() {
  const raw = (await db.query(`SELECT value FROM forecast_assumptions WHERE key = 'scenarios'`)).rows[0]?.value;
  const list = typeof raw === 'string' ? JSON.parse(raw) : raw || [];
  const periodByName = new Map(list.filter(Boolean).map((e) => [e.Name, e.PeriodStart]));
  const rows = (await db.query(
    `SELECT s.id, s.name, m.base_date::text AS base_date, COUNT(*)::int AS n
       FROM forecast_scenarios s JOIN forecast_modules m ON m.scenario_id = s.id
      WHERE NOT s.is_scratch AND m.base_date IS NOT NULL AND m.has_valuation AND m.is_matched
      GROUP BY s.id, s.name, m.base_date ORDER BY s.name, m.base_date`
  )).rows;
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.id)) {
      const ps = periodByName.get(r.name) ?? null;
      out.set(r.id, { scenarioId: r.id, name: r.name, periodStart: ps, actualYear: ps ? ps - 2 : null, anchors: [] });
    }
    out.get(r.id).anchors.push({ date: r.base_date, modules: r.n });
  }
  return [...out.values()].map((s) => {
    const behindBy = s.actualYear == null ? [] : s.anchors.filter((a) => Number(a.date.slice(0, 4)) < s.actualYear);
    return { ...s, behind: behindBy.reduce((n, a) => n + a.modules, 0), mixed: s.anchors.length > 1 };
  });
}

module.exports = { previewAnnualClose, runAnnualClose, anchorStatus, renameForYear, TRACK_TOLERANCE };
