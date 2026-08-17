'use strict';
/**
 * cr083.budgetLe.test.js — CR083 P0b, the repository.
 *
 * Self-seeding, cleaned up by name, never reads ambient data. It uses years
 * **1975 and 2190** for every absolute assertion because neither `transactions`
 * nor `budget_entries` holds a row in them on any database — dev, prod or a
 * CI-built one. That matters more than it sounds: dev and prod already disagree
 * about the live COA (prod has 2026 activity on `Purchases - IT Costs` that
 * dev's last sync predates, so the same 3,560 transactions group into 93
 * categories on one and 92 on the other). Any suite asserting a live row count
 * would pass on one database and fail on the other.
 */

const repo = require('../budgetLe');
const db = require('../../db');

const dbDescribe = process.env.SKIP_DB_TESTS ? describe.skip : describe;

const TAG = 'CR083LE';
const YEAR = 1975;

dbDescribe('budgetLe repository (DB)', () => {
  const ids = {};

  async function cleanup() {
    await db.query(
      `DELETE FROM budget_le WHERE budget_year IN ($1, 2190)`, [YEAR]
    );
    await db.query(`DELETE FROM transactions WHERE description1 LIKE $1`, [`${TAG}%`]);
    await db.query(`DELETE FROM budget_entries WHERE description LIKE $1`, [`${TAG}%`]);
    await db.query(`DELETE FROM accounts WHERE name LIKE $1`, [`${TAG}%`]);
  }

  async function addAccount(name, isTransfer = false) {
    const { rows } = await db.query(
      `INSERT INTO accounts (name, account_type, section, is_transfer, currency, is_active)
       VALUES ($1, 'expense', 'profit_loss', $2, 'USD', TRUE) RETURNING id`,
      [name, isTransfer]
    );
    return rows[0].id;
  }

  beforeAll(async () => {
    await cleanup();
    ids.a = await addAccount(`${TAG} Alpha`);
    ids.b = await addAccount(`${TAG} Beta`);
    ids.t = await addAccount(`${TAG} Transferish`, true);

    // Actual half: March, two currencies on Alpha (the multi-currency grain).
    for (const [cat, month, amt, ccy] of [
      [ids.a, 3, -100, 'USD'], [ids.a, 3, -200, 'EUR'], [ids.b, 4, -50, 'USD'],
      [ids.t, 3, -999999, 'USD'], // excluded
    ]) {
      await db.query(
        `INSERT INTO transactions
           (transaction_date, description1, amount, currency, base_amount, base_currency, category_id)
         VALUES (make_date($1,$2,15), $3, $4, $5, $4, 'USD', $6)`,
        [YEAR, month, `${TAG} a`, amt, ccy, cat]
      );
    }
    // Estimate half: months after the cut.
    for (const [cat, month, amt] of [
      [ids.a, 9, -300], [ids.b, 10, -70], [ids.t, 9, -888888],
    ]) {
      await db.query(
        `INSERT INTO budget_entries
           (entry_date, description, amount, currency, base_amount, base_currency, category_id, budget_year)
         VALUES (make_date($1,$2,1), $3, $4, 'USD', $4, 'USD', $5, $1)`,
        [YEAR, month, `${TAG} b`, amt, cat]
      );
    }
  });

  afterAll(async () => {
    await cleanup();
    await db.close();
  });

  describe('leName — MM is the FIRST ESTIMATE month, not the creation month', () => {
    test('a July cut is LE-08, which is the owner\'s own example', () => {
      expect(repo.leName('2026-07-31')).toBe('LE-08-26');
    });
    test('the earliest legal cut (Jan) is LE-02', () => {
      expect(repo.leName('2026-01-31')).toBe('LE-02-26');
    });
    test('the latest legal cut (Nov) is LE-12', () => {
      expect(repo.leName('2026-11-30')).toBe('LE-12-26');
    });
    test('it rolls the year only where the cut does not — Dec is refused by the schema, not here', () => {
      expect(repo.leName('2025-11-30')).toBe('LE-12-25');
    });
  });

  describe('materialise', () => {
    test('splits at the cut, and the two halves carry different sources', async () => {
      const rows = await repo.materialise({ budgetYear: YEAR, actualThrough: `${YEAR}-07-31` });
      const mine = rows.filter((r) => [ids.a, ids.b].includes(r.category_id));
      const actual = mine.filter((r) => r.source === 'actual');
      const est = mine.filter((r) => r.source === 'budget_carry');

      expect(actual).toHaveLength(3);   // Alpha USD, Alpha EUR, Beta USD
      expect(est).toHaveLength(2);      // Alpha Sep, Beta Oct
      expect(actual.every((r) => r.method === 'ACTUAL')).toBe(true);
      expect(est.every((r) => r.method === 'CARRY')).toBe(true);
    });

    test('currency is part of the grain — one category-month, two rows', async () => {
      const rows = await repo.materialise({ budgetYear: YEAR, actualThrough: `${YEAR}-07-31` });
      const alphaMar = rows.filter(
        (r) => r.category_id === ids.a && r.source === 'actual'
      );
      expect(alphaMar).toHaveLength(2);
      expect(alphaMar.map((r) => r.currency).sort()).toEqual(['EUR', 'USD']);
    });

    test('actual rows carry a snapshot; estimate rows do not', async () => {
      const rows = await repo.materialise({ budgetYear: YEAR, actualThrough: `${YEAR}-07-31` });
      const mine = rows.filter((r) => [ids.a, ids.b].includes(r.category_id));
      for (const r of mine) {
        if (r.source === 'actual') {
          expect(r.snapshot_row_count).toBeGreaterThan(0);
          expect(Number(r.snapshot_sum)).toBeCloseTo(Number(r.base_amount), 2);
        } else {
          expect(r.snapshot_row_count).toBeNull();
        }
      }
    });

    test('the transfer category is excluded from BOTH halves', async () => {
      const rows = await repo.materialise({ budgetYear: YEAR, actualThrough: `${YEAR}-07-31` });
      expect(rows.some((r) => r.category_id === ids.t)).toBe(false);
      // -999,999 and -888,888 were seeded on it; if the exclusion failed the
      // totals would be six figures rather than three.
      const mine = rows.filter((r) => [ids.a, ids.b].includes(r.category_id));
      const total = mine.reduce((s, r) => s + Number(r.base_amount), 0);
      expect(total).toBeCloseTo(-720, 2); // -350 actual + -370 estimate
    });

    test('it is SPARSE — no row for a category-month with neither budget nor actual', async () => {
      const rows = await repo.materialise({ budgetYear: YEAR, actualThrough: `${YEAR}-07-31` });
      const mine = rows.filter((r) => [ids.a, ids.b].includes(r.category_id));
      // Dense would be 2 categories x 12 months = 24 (before currency slices).
      // Sparse is 5. The difference is what keeps "never budgeted" distinct from
      // "deliberately zeroed", which is what L4 polices.
      expect(mine).toHaveLength(5);
      const months = mine.map((r) => String(r.period_month).slice(0, 7));
      // Only the months that actually carry something: Mar and Apr (actual),
      // Sep and Oct (budget). June has neither and must have no row at all.
      expect(months).not.toContain(`${YEAR}-06`);
      expect(new Set(months)).toEqual(
        new Set([`${YEAR}-03`, `${YEAR}-04`, `${YEAR}-09`, `${YEAR}-10`])
      );
    });

    test('a cut before the year starts yields estimate rows only', async () => {
      const rows = await repo.materialise({ budgetYear: YEAR, actualThrough: `${YEAR - 1}-12-31` });
      const mine = rows.filter((r) => [ids.a, ids.b].includes(r.category_id));
      expect(mine.every((r) => r.source === 'budget_carry')).toBe(true);
    });
  });

  describe('create', () => {
    test('materialises in one transaction and snapshots the excluded scope', async () => {
      const le = await repo.create({
        budgetYear: YEAR, actualThrough: `${YEAR}-07-31`, label: `${TAG} first`,
      });
      expect(le.name).toBe('LE-08-75');
      expect(le.status).toBe('draft');
      expect(le.line_count).toBeGreaterThanOrEqual(5);

      // The scope is snapshotted, not re-derived — is_transfer is a live flag,
      // so an LE that did not record its exclusions would stop describing its
      // own total the moment the flag moved.
      expect(le.excluded_category_ids).toContain(ids.t);

      const lines = await repo.findLines(le.id);
      expect(lines.length).toBe(le.line_count);
      expect(lines.some((l) => l.category_id === ids.t)).toBe(false);
    });

    test('a second LE on the SAME cut is refused while the first is live', async () => {
      await expect(
        repo.create({ budgetYear: YEAR, actualThrough: `${YEAR}-07-31` })
      ).rejects.toThrow(/unique|duplicate/i);
    });

    test('the schema refuses a January LE, a December cut and a mid-month cut', async () => {
      await expect(
        repo.create({ budgetYear: YEAR, actualThrough: `${YEAR - 1}-12-31` })
      ).rejects.toThrow(/budget_le_not_january_chk/);
      await expect(
        repo.create({ budgetYear: YEAR, actualThrough: `${YEAR}-12-31` })
      ).rejects.toThrow(/budget_le_not_month_13_chk/);
      await expect(
        repo.create({ budgetYear: YEAR, actualThrough: `${YEAR}-08-15` })
      ).rejects.toThrow(/budget_le_month_end_chk/);
    });

    test('a failed materialisation leaves NO header behind', async () => {
      const before = await repo.findAll({ budgetYear: 2190 });
      await expect(
        repo.create({ budgetYear: 2190, actualThrough: '2190-13-01' })
      ).rejects.toThrow();
      const after = await repo.findAll({ budgetYear: 2190 });
      expect(after.length).toBe(before.length);
    });
  });
});
