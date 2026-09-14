'use strict';
/**
 * cr083.finalize.test.js — CR083 P0b: finalise, recut, the delete that restores,
 * drift (L2) and the advisories (L1, L6).
 *
 * Self-seeding in year 1976, which no database holds data for (the sibling suite
 * uses 1975 and 2190), and cleaned up by tag. The tests run IN ORDER and share one
 * chain of LEs, because the thing under test is a lifecycle.
 */

const repo = require('../budgetLe');
const svc = require('../../../services/budgetLe');
const db = require('../../db');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;

const TAG = 'CR083FIN';
const YEAR = 1976;

dbDescribe('CR083 finalise, recut, drift and advisories (DB)', () => {
  const ids = {};

  async function cleanup() {
    await db.query(`DELETE FROM budget_le WHERE budget_year = $1`, [YEAR]);
    await db.query(`DELETE FROM transactions WHERE description1 LIKE $1`, [`${TAG}%`]);
    await db.query(`DELETE FROM budget_entries WHERE description LIKE $1`, [`${TAG}%`]);
    await db.query(`DELETE FROM accounts WHERE name LIKE $1`, [`${TAG}%`]);
  }

  const txn = (month, amount) => db.query(
    `INSERT INTO transactions
       (transaction_date, description1, amount, currency, base_amount, base_currency, category_id)
     VALUES (make_date($1, $2, 15), $3, $4, 'USD', $4, 'USD', $5)`,
    [YEAR, month, `${TAG} t`, amount, ids.a]
  );

  const budget = (month, amount, categoryId) => db.query(
    `INSERT INTO budget_entries
       (entry_date, description, amount, currency, base_amount, base_currency, category_id, budget_year)
     VALUES (make_date($1, $2, 1), $3, $4, 'USD', $4, 'USD', $5, $1)`,
    [YEAR, month, `${TAG} b`, amount, categoryId]
  );

  beforeAll(async () => {
    await cleanup();
    const { rows } = await db.query(
      `INSERT INTO accounts (name, account_type, section, is_transfer, currency, is_active)
       VALUES ($1, 'expense', 'profit_loss', FALSE, 'USD', TRUE) RETURNING id`,
      [`${TAG} Alpha`]
    );
    ids.a = rows[0].id;
    await txn(3, -100);
    await budget(9, -300, ids.a);
  });

  afterAll(async () => {
    await cleanup();
    await db.close();
  });

  test('finalise freezes: status, finalized_at, the actual half RE-READ, the FY budget snapshotted', async () => {
    const le = await repo.create({ budgetYear: YEAR, actualThrough: `${YEAR}-07-31` });
    ids.first = le.id;
    await txn(3, -50); // lands after the draft was cut, before it is finalised

    const fin = await repo.finalize(le.id);
    expect(fin.status).toBe('final');
    expect(fin.finalized_at).toBeTruthy();

    const actual = (await repo.findLines(le.id))
      .filter((l) => l.category_id === ids.a && l.source === 'actual');
    const frozen = actual.reduce((s, l) => s + Number(l.snapshot_sum), 0);
    expect(frozen).toBeCloseTo(-150, 2);

    const fy = await repo.findBudgetFy(le.id);
    expect(Number(fy.find((r) => r.category_id === ids.a).budget_fy)).toBeCloseTo(-300, 2);
  });

  test('🔴 a final LE keeps its frozen BUDGET FY when the budget is edited — the live read does not', async () => {
    await budget(10, -1000, ids.a);
    const grid = await svc.getGrid(ids.first);
    const row = grid.rows.find((r) => r.categoryId === ids.a);
    expect(row.budgetFy).toBeCloseTo(-300, 2);

    const live = await svc.budgetFyByCategory(YEAR);
    expect(live.get(ids.a)).toBeCloseTo(-1300, 2);
  });

  test('finalise refuses anything but a draft with 409, and a final LE refuses edits', async () => {
    await expect(repo.finalize(ids.first)).rejects.toMatchObject({ status: 409 });
    await expect(
      svc.saveCategoryEstimates(ids.first, ids.a, { [`${YEAR}-09`]: -1 })
    ).rejects.toThrow(/final/);
  });

  test('L2: a small change is reported but does not fire; past a threshold it fires with the frozen figure first', async () => {
    await txn(3, -10);
    let mar = (await svc.getDrift(ids.first)).months.find((m) => m.month === `${YEAR}-03`);
    expect(mar.deltaRows).toBe(1);
    expect(mar.drifted).toBe(false);

    await txn(3, -300);
    mar = (await svc.getDrift(ids.first)).months.find((m) => m.month === `${YEAR}-03`);
    expect(mar.drifted).toBe(true);
    expect(mar.sentence).toMatch(
      /froze MAR at \(\$150\.00\) over 2 rows; the ledger now says \(\$460\.00\) over 4/
    );
  });

  test('recut supersedes then inserts on the same cut; only a final LE can be re-cut', async () => {
    const next = await repo.recut(ids.first);
    ids.second = next.id;
    expect(next.status).toBe('draft');
    expect(String(next.actual_through).slice(0, 10)).toBe(`${YEAR}-07-31`);

    const old = await repo.findById(ids.first);
    expect(old.status).toBe('superseded');
    expect(old.superseded_by).toBe(next.id);

    const live = await repo.findAll({ budgetYear: YEAR });
    expect(live.map((l) => l.id)).toEqual([next.id]);

    await expect(repo.recut(ids.second)).rejects.toMatchObject({ status: 409 });
  });

  test('deleting the draft a recut created RESTORES the final LE it replaced; a plain draft restores nothing', async () => {
    const res = await repo.remove(ids.second);
    expect(res).toEqual({ deleted: true, restored: { id: ids.first, name: 'LE-08-76' } });

    const old = await repo.findById(ids.first);
    expect(old.status).toBe('final');
    expect(old.superseded_by).toBeNull();

    const lone = await repo.create({ budgetYear: YEAR, actualThrough: `${YEAR}-05-31` });
    expect(await repo.remove(lone.id)).toEqual({ deleted: true, restored: null });
  });

  test('L1 fires only when the cut month had ended fewer than 4 days before the freeze', async () => {
    let l1 = (await svc.getAdvisories(ids.first)).advisories.find((a) => a.id === 'L1');
    expect(l1.fires).toBe(false); // frozen today, fifty years after JUL 1976

    await db.query(
      `UPDATE budget_le SET finalized_at = $2 WHERE id = $1`,
      [ids.first, `${YEAR}-08-03T12:00:00Z`]
    );
    l1 = (await svc.getAdvisories(ids.first)).advisories.find((a) => a.id === 'L1');
    expect(l1.fires).toBe(true);
    expect(l1.operands.daysAfter).toBe(3);

    await db.query(
      `UPDATE budget_le SET finalized_at = $2 WHERE id = $1`,
      [ids.first, `${YEAR}-08-04T12:00:00Z`]
    );
    l1 = (await svc.getAdvisories(ids.first)).advisories.find((a) => a.id === 'L1');
    expect(l1.fires).toBe(false);
  });

  test('L6 fires on uncategorised budget rows in the estimate months, and the grid carries the memo line', async () => {
    let l6 = (await svc.getAdvisories(ids.first)).advisories.find((a) => a.id === 'L6');
    expect(l6.fires).toBe(false);

    await budget(2, -40, null);  // an actual month: counts for the year, not the estimate window
    await budget(11, -500, null);
    l6 = (await svc.getAdvisories(ids.first)).advisories.find((a) => a.id === 'L6');
    expect(l6.fires).toBe(true);
    expect(l6.operands.estimateWindow).toBeCloseTo(-500, 2);
    expect(l6.operands.fy).toBeCloseTo(-540, 2);

    const grid = await svc.getGrid(ids.first);
    expect(grid.unallocated).toMatchObject({ rows: 2, estimateRows: 1 });
    // Memo, never inside the total.
    expect(grid.totals.budgetFy).toBeCloseTo(-300, 2);
  });
});
