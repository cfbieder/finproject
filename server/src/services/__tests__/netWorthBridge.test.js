'use strict';
/**
 * netWorthBridge.test.js — CR092.
 *
 * Two halves, for two different failure shapes.
 *
 * The pure half covers period layout, where an off-by-one silently drops a
 * month of drivers into the neighbouring column.
 *
 * The DB half exists for the only claim this feature actually makes: that the
 * drivers ADD UP. Everything else about the modal is presentation; if the tie
 * is non-zero the page is lying, and no amount of prose fixes it.
 *
 * THE FIXTURE IS BUILT, NOT BORROWED. `server/db/ci-seed.sql` is 34 lines with
 * four P&L accounts and ZERO transactions — it has no `Assets` root at all — so
 * a test asserting "United Beverages is −1,873,619" would pass on dev and never
 * run in CI, which is the ambient-data class that has turned `main` red five
 * times. So this seeds its own Assets/Liabilities chain (attaching to the real
 * roots when they already exist), its own rates, and asserts INVARIANTS —
 * the tie, the sums, and agreement with the balance sheet — which hold on any
 * data, including prod's.
 *
 * Skip the DB half with SKIP_DB_TESTS=1.
 */

const {
  periodEnds,
  isValidDateString,
  DRIVER_KEYS,
  buildNetWorthBridge,
} = require('../netWorthBridge');

describe('periodEnds', () => {
  it('closes on toDate even when it is not a period end', () => {
    // The hero's window ends today. If the last period were snapped to the
    // month end, the bridge would explain a change the hero never showed.
    const out = periodEnds('2025-10-31', '2026-09-05', 'month');
    expect(out[out.length - 1]).toBe('2026-09-05');
    expect(out[0]).toBe('2025-11-30');
    expect(out).toHaveLength(11);
  });

  it('never emits a period end on or before fromDate', () => {
    // fromDate is itself a month end; emitting it would create a zero-length
    // first period whose drivers all land in the wrong column.
    expect(periodEnds('2026-01-31', '2026-03-31', 'month')).toEqual([
      '2026-02-28', '2026-03-31',
    ]);
    // and mid-month, the containing month's end is a real period
    expect(periodEnds('2026-01-10', '2026-03-31', 'month')).toEqual([
      '2026-01-31', '2026-02-28', '2026-03-31',
    ]);
  });

  it('anchors quarters and years to the calendar', () => {
    expect(periodEnds('2025-02-15', '2025-12-31', 'quarter')).toEqual([
      '2025-03-31', '2025-06-30', '2025-09-30', '2025-12-31',
    ]);
    expect(periodEnds('2024-06-01', '2026-03-31', 'year')).toEqual([
      '2024-12-31', '2025-12-31', '2026-03-31',
    ]);
  });

  it('collapses to a single period when asked for none', () => {
    expect(periodEnds('2025-01-01', '2026-09-05', 'none')).toEqual(['2026-09-05']);
  });

  it('does not emit a duplicate when toDate is itself a period end', () => {
    const out = periodEnds('2025-12-31', '2026-02-28', 'month');
    expect(out).toEqual(['2026-01-31', '2026-02-28']);
    expect(new Set(out).size).toBe(out.length);
  });
});

describe('isValidDateString', () => {
  it('rejects what a date picker can actually send', () => {
    expect(isValidDateString('2026-09-05')).toBe(true);
    expect(isValidDateString('2026-9-5')).toBe(false);
    expect(isValidDateString('05/09/2026')).toBe(false);
    expect(isValidDateString('2026-13-01')).toBe(false);
    expect(isValidDateString('')).toBe(false);
    expect(isValidDateString(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------

const db = require('../../v2/db');
const reportsService = require('../reports');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;

dbDescribe('buildNetWorthBridge — the drivers add up (DB)', () => {
  const PREFIX = 'TestNwb';
  const FROM = '2026-01-31';
  const TO = '2026-04-30';
  // Deliberately NOT a rate the app already holds: the fixture must not depend
  // on prod's exchange_rates, and must not disturb them either.
  const RATE_DATES = ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'];
  const RATES = { '2026-01-31': 0.25, '2026-02-28': 0.26, '2026-03-31': 0.24, '2026-04-30': 0.27 };
  const CCY = 'ZZZ'; // a currency prod cannot hold, so no live account is touched

  let created = [];       // account ids this test made, newest first
  let rateIds = [];

  const q = (sql, params) => db.query(sql, params);

  async function ensureRoot(name, type) {
    const { rows } = await q(`SELECT id FROM accounts WHERE name = $1`, [name]);
    if (rows.length) return { id: rows[0].id, mine: false };
    const ins = await q(
      `INSERT INTO accounts (name, account_type, section, currency, opening_balance,
                             opening_balance_date, is_active)
       VALUES ($1, $2, 'balance_sheet', 'USD', 0, '1990-01-01'::date, TRUE) RETURNING id`,
      [name, type]
    );
    return { id: ins.rows[0].id, mine: true };
  }

  async function mkAccount(suffix, { parentId, type, currency, opening }) {
    const { rows } = await q(
      `INSERT INTO accounts (name, parent_id, account_type, section, currency,
                             opening_balance, opening_balance_date, is_active)
       VALUES ($1, $2, $3, 'balance_sheet', $4, $5, '1990-01-01'::date, TRUE) RETURNING id`,
      [`${PREFIX}_${suffix}`, parentId, type, currency, opening]
    );
    created.unshift(rows[0].id);
    return rows[0].id;
  }

  async function mkTx(accountId, date, amount, categoryName, currency) {
    const cat = categoryName
      ? (await q(`SELECT id FROM accounts WHERE name = $1 LIMIT 1`, [categoryName])).rows[0]
      : null;
    await q(
      `INSERT INTO transactions (transaction_date, amount, currency, base_amount,
                                 account_id, category_id, description1)
       VALUES ($1::date, $2, $3, $2, $4, $5, $6)`,
      [date, amount, currency, accountId, cat ? cat.id : null, `${PREFIX} fixture`]
    );
  }

  /** A P&L category to book against; reused if the DB already has one. */
  async function ensureCategory(name, type, isTransfer) {
    const { rows } = await q(`SELECT id FROM accounts WHERE name = $1`, [name]);
    if (rows.length) return rows[0].id;
    const ins = await q(
      `INSERT INTO accounts (name, account_type, section, currency, is_transfer, is_active)
       VALUES ($1, $2, 'profit_loss', 'USD', $3, TRUE) RETURNING id`,
      [name, type, isTransfer]
    );
    created.unshift(ins.rows[0].id);
    return ins.rows[0].id;
  }

  beforeAll(async () => {
    await cleanup();
    created = [];
    rateIds = [];

    for (const d of RATE_DATES) {
      const ins = await q(
        `INSERT INTO exchange_rates (from_currency, to_currency, rate, rate_date, source)
         VALUES ($1, 'USD', $2, $3::date, 'test')
         -- DO UPDATE, not DO NOTHING: a row left behind by a previous failed run
         -- would otherwise be silently reused, and the fixture would assert
         -- against a rate it did not set. That is exactly how this test first
         -- "failed" for a reason that had nothing to do with the code.
         ON CONFLICT (from_currency, to_currency, rate_date)
         DO UPDATE SET rate = EXCLUDED.rate RETURNING id`,
        // `exchange_rates.rate` is USD PER UNIT of from_currency — reports.js
        // stores its reciprocal and then divides, which nets back to a multiply.
        // Inserting 1/rate here made the fixture's own arithmetic wrong by 13.7x.
        [CCY, RATES[d], d]
      );
      if (ins.rows.length) rateIds.push(ins.rows[0].id);
    }

    const assets = await ensureRoot('Assets', 'asset');
    const liabilities = await ensureRoot('Liabilities', 'liability');
    if (assets.mine) created.push(assets.id);
    if (liabilities.mine) created.push(liabilities.id);

    await ensureCategory(PREFIX + '_Salary', 'income', false);
    await ensureCategory(PREFIX + '_Groceries', 'expense', false);
    await ensureCategory(PREFIX + '_Move', 'expense', true);
    await ensureCategory('Unrealized G/L', 'expense', false);

    // A USD account: income, spending, and a transfer out.
    const usdAcct = await mkAccount('Bank', {
      parentId: assets.id, type: 'asset', currency: 'USD', opening: 10000,
    });
    await mkTx(usdAcct, '2026-02-10', 5000, `${PREFIX}_Salary`, 'USD');
    await mkTx(usdAcct, '2026-03-12', -1200, `${PREFIX}_Groceries`, 'USD');
    await mkTx(usdAcct, '2026-04-02', -3000, `${PREFIX}_Move`, 'USD');

    // A foreign account that is BOTH re-valued and translated, so the
    // revaluation and currency drivers are separable rather than co-linear.
    const fxAcct = await mkAccount('Holding', {
      parentId: assets.id, type: 'asset', currency: CCY, opening: 400000,
    });
    await mkTx(fxAcct, '2026-03-31', -50000, 'Unrealized G/L', CCY);
    await mkTx(fxAcct, '2026-04-02', 3000, `${PREFIX}_Move`, CCY);

    // A liability, so the sum is not assets-only. Stored negative.
    const card = await mkAccount('Card', {
      parentId: liabilities.id, type: 'liability', currency: 'USD', opening: -500,
    });
    await mkTx(card, '2026-02-20', -800, `${PREFIX}_Groceries`, 'USD');

    // An uncategorised row — invisible to any bucketing that assumes a category.
    await mkTx(usdAcct, '2026-03-20', -37, null, 'USD');
  });

  afterAll(async () => {
    await cleanup();
    await db.close();
  });

  async function cleanup() {
    await q(
      `DELETE FROM transactions WHERE description1 LIKE $1`,
      [`${PREFIX}%`]
    );
    await q(
      `DELETE FROM transactions WHERE account_id IN (SELECT id FROM accounts WHERE name LIKE $1)`,
      [`${PREFIX}%`]
    );
    // Children first: parent_id is a FK back into this same table.
    await q(`DELETE FROM accounts WHERE name LIKE $1`, [`${PREFIX}%`]);
    for (const id of created) {
      await q(`DELETE FROM accounts WHERE id = $1`, [id]).catch(() => {});
    }
    // By CURRENCY, not by the ids this run happens to hold: a crashed run leaves
    // rows behind that the next run would then inherit. `ZZZ` is fixture-only.
    await q(`DELETE FROM exchange_rates WHERE from_currency = $1`, [CCY]);
    created = [];
    rateIds = [];
  }

  it('ties exactly — the drivers reconstruct the change', async () => {
    const { data, meta } = await buildNetWorthBridge({
      fromDate: FROM, toDate: TO, granularity: 'month', moverLimit: 500,
    });
    const summed = data.drivers.reduce((a, d) => a + d.amount, 0);

    // The bridge is exact, not an estimate. A tolerance here would hide the
    // one bug this whole feature can have.
    expect(meta.tieOk).toBe(true);
    expect(Math.abs(meta.tie)).toBeLessThanOrEqual(0.01);
    expect(summed).toBeCloseTo(data.change, 1);
    expect(data.change).toBeCloseTo(data.to.netWorth - data.from.netWorth, 2);
  });

  it('agrees with the balance sheet at BOTH endpoints', async () => {
    // The number the modal explains must be the number the hero shows. A
    // bridge that is internally consistent but disagrees with the chart is
    // worse than none.
    const { data } = await buildNetWorthBridge({
      fromDate: FROM, toDate: TO, granularity: 'month', moverLimit: 500,
    });
    for (const { date, netWorth } of [data.from, data.to]) {
      const report = (await reportsService.buildBalanceSheetReport(date))['Balance Sheet Accounts'];
      const pick = (n) => report.find((x) => (x.name || '').toLowerCase() === n)?.totalUSD ?? 0;
      expect(netWorth).toBeCloseTo(pick('assets') + pick('liabilities'), 2);
    }
  });

  it('the periods sum to the headline, driver by driver', async () => {
    // This is what the ending-rate FX basis buys, and the reason the modal can
    // show a month table under the total at all. Under a per-period rate it
    // fails: measured −1,608 chained vs −81,899 for the same live window.
    const { data } = await buildNetWorthBridge({
      fromDate: FROM, toDate: TO, granularity: 'month', moverLimit: 500,
    });
    const headline = Object.fromEntries(DRIVER_KEYS.map((k) => [k, 0]));
    for (const d of data.drivers) headline[d.key] = d.amount;

    for (const key of DRIVER_KEYS) {
      const chained = data.periods.reduce((a, p) => a + p.drivers[key], 0);
      expect(chained).toBeCloseTo(headline[key], 1);
    }
    expect(data.periods.reduce((a, p) => a + p.change, 0)).toBeCloseTo(data.change, 1);
  });

  it('separates a revaluation from the currency move on the same account', async () => {
    // Co-linear by nature: both change a foreign holding's USD value with no
    // cash moving. If the split collapsed, one of them would read 0.
    const { data } = await buildNetWorthBridge({
      fromDate: FROM, toDate: TO, granularity: 'month', moverLimit: 500,
    });
    const holding = data.movers.find((m) => m.account === `${PREFIX}_Holding`);
    expect(holding).toBeDefined();
    // Marked down 50,000 units at the closing rate 0.27.
    expect(holding.drivers.revaluation).toBeCloseTo(-13500, 2);
    // The rate ran 0.25 → 0.27 on an opening 400,000 units.
    expect(holding.drivers.currency).toBeCloseTo(8000, 2);
    expect(holding.change).toBeCloseTo(
      DRIVER_KEYS.reduce((a, k) => a + holding.drivers[k], 0), 2
    );
  });

  it('books an uncategorised row rather than dropping it into currency', async () => {
    // A NULL category has no bucket unless one is written for it, and the
    // residual would swallow it in silence — the exact shape that left
    // investmentReturns off by $8,781.87.
    const { data } = await buildNetWorthBridge({
      fromDate: FROM, toDate: TO, granularity: 'month', moverLimit: 500,
    });
    const uncategorised = data.drivers.find((d) => d.key === 'uncategorised');
    expect(uncategorised).toBeDefined();
    expect(uncategorised.amount).toBeCloseTo(-37, 2);
  });

  it('reports transfers as their own driver, not as spending', async () => {
    const { data } = await buildNetWorthBridge({
      fromDate: FROM, toDate: TO, granularity: 'month', moverLimit: 500,
    });
    // PER ACCOUNT, not the whole-DB totals: dev is a copy of prod and carries
    // its own transfers in this window, so asserting `data.drivers` against
    // fixture amounts tests the ambient data, not the bucketing. (It failed
    // exactly that way first — -12,348 against an expected -2,190.)
    const of = (name) => data.movers.find((m) => m.account === `${PREFIX}_${name}`);
    const bank = of('Bank');
    const holding = of('Holding');
    const card = of('Card');
    expect([bank, holding, card].every(Boolean)).toBe(true);

    // The transfer legs stay in `transfers` on both sides and never leak into
    // spending, even though the outgoing leg looks exactly like a payment.
    expect(bank.drivers.transfers).toBeCloseTo(-3000, 2);
    expect(holding.drivers.transfers).toBeCloseTo(810, 2); // 3,000 units at 0.27
    expect(bank.drivers.spending).toBeCloseTo(-1200, 2);
    expect(bank.drivers.income).toBeCloseTo(5000, 2);
    // A liability's spending is stored negative too, and still belongs to the
    // account that carries it rather than to the category's own section.
    expect(card.drivers.spending).toBeCloseTo(-800, 2);
    expect(card.change).toBeCloseTo(-800, 2);
  });

  it('names the big item under its driver — by ACCOUNT, and by CATEGORY for spending', async () => {
    const { data } = await buildNetWorthBridge({
      fromDate: FROM, toDate: TO, granularity: 'month', moverLimit: 500,
    });
    const driver = (k) => data.drivers.find((d) => d.key === k);

    // A re-valuation IS an account. Asserted as the label KIND, not as "the
    // fixture's own mark is listed" — dev carries prod's data, where the
    // re-valuation is United Beverages at −1.87M and this fixture's −13,500
    // is correctly below the floor. That first draft failed for exactly the
    // ambient-data reason this suite exists to avoid.
    const reval = driver('revaluation');
    expect(reval.namedBy).toBe('account');
    for (const c of reval.contributors) {
      const { rows } = await q('SELECT section FROM accounts WHERE name = $1', [c.label]);
      expect(rows[0] && rows[0].section).toBe('balance_sheet');
    }

    // Spending is a CATEGORY. Measured on prod, the top spending ACCOUNT is
    // whichever card paid (`PKO`, `Chase Checking`) while the top spending item
    // is `Kasia Spending` — naming the account there answers nothing.
    expect(driver('spending').namedBy).toBe('category');
    expect(driver('income').namedBy).toBe('category');
    // Dev carries prod's own rows under these drivers, so the assertion is the
    // LABEL KIND rather than the fixture's amounts: every listed spending
    // contributor must resolve to a P&L account, i.e. a category.
    for (const c of driver('spending').contributors) {
      const { rows } = await q('SELECT section FROM accounts WHERE name = $1', [c.label]);
      expect(rows[0] && rows[0].section).toBe('profit_loss');
    }
  });

  it('refuses to name legs under a CANCELLING driver, and says it cancelled', async () => {
    // Prod's transfers line nets to −23,621 on ~1.75M of movement. Listing its
    // ±$500K legs under that figure is individually true and collectively a lie
    // about what the line means — which is what a net-relative floor did.
    const { data } = await buildNetWorthBridge({
      fromDate: FROM, toDate: TO, granularity: 'month', moverLimit: 500,
    });
    const transfers = data.drivers.find((d) => d.key === 'transfers');
    expect(transfers).toBeDefined();

    // Asserted as the RULE, not as a figure this database happens to produce.
    const gross = data.movers.reduce((a, m) => a + Math.abs(m.drivers.transfers), 0);
    if (Math.abs(transfers.amount) < gross * 0.4) {
      expect(transfers.offsetting).toBe(true);
      expect(transfers.contributors).toEqual([]);
      expect(transfers.gross).toBeGreaterThan(Math.abs(transfers.amount));
    } else {
      expect(transfers.offsetting).toBeUndefined();
      expect(Array.isArray(transfers.contributors)).toBe(true);
    }
  });

  it('emits no share percentage, because a contributor can exceed its driver', async () => {
    // United Beverages is −1,873,619 against a −1,741,398 re-valuation, because
    // other marks were positive. "108%" would read as an error rather than as
    // "the rest offset it", so no share is emitted at all.
    const { data } = await buildNetWorthBridge({
      fromDate: FROM, toDate: TO, granularity: 'month', moverLimit: 500,
    });
    for (const d of data.drivers) {
      for (const c of d.contributors) {
        expect(Object.keys(c).sort()).toEqual(['amount', 'label']);
      }
    }
  });

  it('states the basis and the caveats rather than leaving them to the page', async () => {
    const { meta } = await buildNetWorthBridge({
      fromDate: FROM, toDate: TO, granularity: 'month', moverLimit: 500,
    });
    expect(meta.basis).toBe('ending-rate');
    expect(meta.basisNote).toMatch(/today's dollars/);
    // The two drivers the method structurally cannot see must be disclosed.
    expect(meta.caveats.join(' ')).toMatch(/opening balance/i);
    expect(meta.caveats.join(' ')).toMatch(/Closing an account/i);
  });

  it('caps the mover list, and lets a caller lift the cap', async () => {
    // CR092 P2: the modal wants a top handful, the /net-worth-drivers report
    // wants every account. A cap the report cannot lift would truncate the grid
    // it exists to show, with nothing on screen to say it had.
    const capped = await buildNetWorthBridge({
      fromDate: FROM, toDate: TO, granularity: 'month', moverLimit: 2,
    });
    expect(capped.data.movers).toHaveLength(2);

    const full = await buildNetWorthBridge({
      fromDate: FROM, toDate: TO, granularity: 'month', moverLimit: 500,
    });
    expect(full.data.movers.length).toBeGreaterThan(capped.data.movers.length);

    // Capping must not reorder: the two lists agree on the biggest movers.
    expect(capped.data.movers.map((m) => m.account))
      .toEqual(full.data.movers.slice(0, 2).map((m) => m.account));

    // And the cap is bounded server-side — an unbounded caller-supplied limit
    // is a payload-size hole, not a feature.
    const absurd = await buildNetWorthBridge({
      fromDate: FROM, toDate: TO, granularity: 'month', moverLimit: 10 ** 6,
    });
    expect(absurd.data.movers.length).toBeLessThanOrEqual(500);
  });

  it('rejects an inverted window instead of returning a mirrored answer', async () => {
    await expect(
      buildNetWorthBridge({ fromDate: TO, toDate: FROM, granularity: 'month' })
    ).rejects.toMatchObject({ status: 400 });
  });
});
