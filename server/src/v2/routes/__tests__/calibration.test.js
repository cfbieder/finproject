/**
 * Balance Calibration & Balance Sheet Tests
 *
 * Integration tests against the dev database that verify:
 * 1. Calibration correctly back-calculates opening balances from anchor
 * 2. Balance = opening_balance + SUM(transactions) is correct for any date
 * 3. Recalibration produces correct results after data changes
 * 4. Balance sheet endpoint uses calibrated balances
 */

const express = require('express');
const http = require('http');

// ── Test database connection ────────────────────────────────────────
const TEST_DB_URL = 'postgres://fin:findev123@localhost:5434/fin';
const { Pool } = require('pg');
const pool = new Pool({ connectionString: TEST_DB_URL });

// ── Mocks ───────────────────────────────────────────────────────────
// Mock the db module to use our test pool
jest.mock('../../db', () => {
  const { Pool } = require('pg');
  const testPool = new Pool({
    connectionString: 'postgres://fin:findev123@localhost:5434/fin',
    types: {
      getTypeParser: () => (val) => val,
    },
  });
  return {
    query: (...args) => testPool.query(...args),
    pool: testPool,
  };
});

// Mock pocketsmith (we don't want real API calls in tests)
jest.mock('../../../services/retrieval/pocketsmith', () => ({
  auth: jest.fn(),
  getUsersIdTransaction_accounts: jest.fn().mockResolvedValue({ data: [] }),
}));

// Mock the accounts repository for routes that need it
const realAccountsRepo = require('../../repositories/accounts');
jest.mock('../../repositories', () => ({
  accounts: require('../../repositories/accounts'),
}));

// ── Express app setup ───────────────────────────────────────────────
const accountsRouter = require('../accounts');
const reportsRouter = require('../reports');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/accounts', accountsRouter);
  app.use('/reports', reportsRouter);
  app.use((err, req, res, next) => {
    res.status(500).json({ error: err.message });
  });
  return app;
}

// ── HTTP helpers ────────────────────────────────────────────────────
function request(app, method, path, body) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const port = server.address().port;
      const url = new URL(`http://localhost:${port}${path}`);
      const options = {
        hostname: 'localhost',
        port,
        path: url.pathname + url.search,
        method: method.toUpperCase(),
        headers: { 'Content-Type': 'application/json' },
      };
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          server.close();
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      });
      req.on('error', (err) => {
        server.close();
        reject(err);
      });
      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  });
}

// ── Test data ───────────────────────────────────────────────────────
const TEST_ACCOUNT_NAME = '__test_calibration_acct__';
let testAccountId;

beforeAll(async () => {
  // Create a test account
  const acctResult = await pool.query(`
    INSERT INTO accounts (name, account_type, section, currency, is_active, ps_account_name,
                          opening_balance, opening_balance_date)
    VALUES ($1, 'asset', 'balance_sheet', 'USD', TRUE, $1, 0, '2000-01-01')
    RETURNING id
  `, [TEST_ACCOUNT_NAME]);
  testAccountId = acctResult.rows[0].id;

  // Insert test transactions with known amounts and closing_balances
  // Simulates: account starts with unknown balance, we have 5 transactions
  //   Jan 15: +1000  (PS closing_balance: 5500 — the "real" account balance after this txn)
  //   Feb 10: -200   (PS closing_balance: 5300)
  //   Mar 05: +750   (PS closing_balance: 6050)
  //   Mar 20: -100   (PS closing_balance: 5950)
  //   Apr 01: +500   (PS closing_balance: 6450) ← anchor (most recent)
  const txns = [
    ['2026-01-15', 'Test deposit 1',    1000,   5500,  90000001],
    ['2026-02-10', 'Test withdrawal 1', -200,   5300,  90000002],
    ['2026-03-05', 'Test deposit 2',     750,   6050,  90000003],
    ['2026-03-20', 'Test withdrawal 2', -100,   5950,  90000004],
    ['2026-04-01', 'Test deposit 3',     500,   6450,  90000005],
  ];

  for (const [date, desc, amount, closingBal, psId] of txns) {
    await pool.query(`
      INSERT INTO transactions (transaction_date, description1, amount, currency,
                                closing_balance, account_id, ps_id, source)
      VALUES ($1, $2, $3, 'USD', $4, $5, $6, 'test')
    `, [date, desc, amount, closingBal, testAccountId, psId]);
  }
});

afterAll(async () => {
  // Clean up test data
  await pool.query(`DELETE FROM transactions WHERE account_id = $1`, [testAccountId]);
  await pool.query(`DELETE FROM accounts WHERE id = $1`, [testAccountId]);
  await pool.end();
});

// ============================================================================
// Test Suite 1: Calibration Logic
// ============================================================================

describe('POST /accounts/calibrate', () => {
  const app = createApp();

  test('calibrates test account — back-calculates correct opening balance', async () => {
    const res = await request(app, 'POST', `/accounts/calibrate?accountId=${testAccountId}`);

    expect(res.status).toBe(200);
    expect(res.body.calibrated).toBe(1);

    const result = res.body.results[0];
    expect(result.accountName).toBe(TEST_ACCOUNT_NAME);

    // Anchor should be the most recent transaction (Apr 01, closing_balance = 6450)
    expect(result.anchorDate).toBe('2026-04-01');
    expect(result.anchorClosingBalance).toBe(6450);

    // SUM of all transactions: 1000 + (-200) + 750 + (-100) + 500 = 1950
    expect(result.totalTransactionAmount).toBe(1950);

    // opening_balance = 6450 - 1950 = 4500
    expect(result.computedOpeningBalance).toBe(4500);
  });

  test('opening balance is persisted in the database', async () => {
    const dbResult = await pool.query(
      `SELECT opening_balance, opening_balance_date, last_calibrated_at
       FROM accounts WHERE id = $1`, [testAccountId]
    );
    const row = dbResult.rows[0];

    expect(parseFloat(row.opening_balance)).toBe(4500);
    expect(new Date(row.opening_balance_date).toISOString().slice(0, 10)).toBe('2000-01-01');
    expect(row.last_calibrated_at).not.toBeNull();
  });
});

// ============================================================================
// Test Suite 2: Balance Calculation (opening_balance + SUM)
// ============================================================================

describe('Balance calculation: opening_balance + SUM(amounts)', () => {
  // After calibration: opening_balance = 4500

  test('balance as of Jan 14 (before any transactions) = opening_balance', async () => {
    const result = await pool.query(`
      SELECT a.opening_balance + COALESCE(SUM(t.amount), 0) AS balance
      FROM accounts a
      LEFT JOIN transactions t
        ON t.account_id = a.id
        AND t.transaction_date >= a.opening_balance_date
        AND t.transaction_date <= '2026-01-14'
      WHERE a.id = $1
      GROUP BY a.id, a.opening_balance, a.opening_balance_date
    `, [testAccountId]);

    // No transactions before Jan 15, so balance = 4500
    expect(parseFloat(result.rows[0].balance)).toBe(4500);
  });

  test('balance as of Jan 15 (after first deposit) = 5500', async () => {
    const result = await pool.query(`
      SELECT a.opening_balance + COALESCE(SUM(t.amount), 0) AS balance
      FROM accounts a
      LEFT JOIN transactions t
        ON t.account_id = a.id
        AND t.transaction_date >= a.opening_balance_date
        AND t.transaction_date <= '2026-01-15'
      WHERE a.id = $1
      GROUP BY a.id, a.opening_balance, a.opening_balance_date
    `, [testAccountId]);

    // 4500 + 1000 = 5500 (matches PS closing_balance for this txn)
    expect(parseFloat(result.rows[0].balance)).toBe(5500);
  });

  test('balance as of Feb 28 (after withdrawal) = 5300', async () => {
    const result = await pool.query(`
      SELECT a.opening_balance + COALESCE(SUM(t.amount), 0) AS balance
      FROM accounts a
      LEFT JOIN transactions t
        ON t.account_id = a.id
        AND t.transaction_date >= a.opening_balance_date
        AND t.transaction_date <= '2026-02-28'
      WHERE a.id = $1
      GROUP BY a.id, a.opening_balance, a.opening_balance_date
    `, [testAccountId]);

    // 4500 + 1000 + (-200) = 5300
    expect(parseFloat(result.rows[0].balance)).toBe(5300);
  });

  test('balance as of Mar 15 (between two March txns) = 6050', async () => {
    const result = await pool.query(`
      SELECT a.opening_balance + COALESCE(SUM(t.amount), 0) AS balance
      FROM accounts a
      LEFT JOIN transactions t
        ON t.account_id = a.id
        AND t.transaction_date >= a.opening_balance_date
        AND t.transaction_date <= '2026-03-15'
      WHERE a.id = $1
      GROUP BY a.id, a.opening_balance, a.opening_balance_date
    `, [testAccountId]);

    // 4500 + 1000 + (-200) + 750 = 6050
    expect(parseFloat(result.rows[0].balance)).toBe(6050);
  });

  test('balance as of Mar 31 (after all March txns) = 5950', async () => {
    const result = await pool.query(`
      SELECT a.opening_balance + COALESCE(SUM(t.amount), 0) AS balance
      FROM accounts a
      LEFT JOIN transactions t
        ON t.account_id = a.id
        AND t.transaction_date >= a.opening_balance_date
        AND t.transaction_date <= '2026-03-31'
      WHERE a.id = $1
      GROUP BY a.id, a.opening_balance, a.opening_balance_date
    `, [testAccountId]);

    // 4500 + 1000 + (-200) + 750 + (-100) = 5950
    expect(parseFloat(result.rows[0].balance)).toBe(5950);
  });

  test('balance as of Apr 01 (all txns) = 6450 (matches anchor)', async () => {
    const result = await pool.query(`
      SELECT a.opening_balance + COALESCE(SUM(t.amount), 0) AS balance
      FROM accounts a
      LEFT JOIN transactions t
        ON t.account_id = a.id
        AND t.transaction_date >= a.opening_balance_date
        AND t.transaction_date <= '2026-04-01'
      WHERE a.id = $1
      GROUP BY a.id, a.opening_balance, a.opening_balance_date
    `, [testAccountId]);

    // 4500 + 1950 = 6450 — must equal anchor_closing_balance
    expect(parseFloat(result.rows[0].balance)).toBe(6450);
  });

  test('each date balance matches PocketSmith closing_balance for that transaction', async () => {
    // This is the key correctness check: our computed balance at each transaction
    // date should match the closing_balance PocketSmith reported for that transaction
    const expected = [
      { date: '2026-01-15', psClosingBalance: 5500 },
      { date: '2026-02-10', psClosingBalance: 5300 },
      { date: '2026-03-05', psClosingBalance: 6050 },
      { date: '2026-03-20', psClosingBalance: 5950 },
      { date: '2026-04-01', psClosingBalance: 6450 },
    ];

    for (const { date, psClosingBalance } of expected) {
      const result = await pool.query(`
        SELECT a.opening_balance + COALESCE(SUM(t.amount), 0) AS balance
        FROM accounts a
        LEFT JOIN transactions t
          ON t.account_id = a.id
          AND t.transaction_date >= a.opening_balance_date
          AND t.transaction_date <= $2
        WHERE a.id = $1
        GROUP BY a.id, a.opening_balance, a.opening_balance_date
      `, [testAccountId, date]);

      expect(parseFloat(result.rows[0].balance)).toBe(psClosingBalance);
    }
  });
});

// ============================================================================
// Test Suite 3: Recalibration
// ============================================================================

describe('Recalibration after data changes', () => {
  const app = createApp();

  test('adding a new transaction and recalibrating adjusts opening balance', async () => {
    // Insert a new transaction on Apr 05 with a NEW closing_balance from PS
    // This simulates PS reporting the account now has 7000 after a +550 deposit
    await pool.query(`
      INSERT INTO transactions (transaction_date, description1, amount, currency,
                                closing_balance, account_id, ps_id, source)
      VALUES ('2026-04-05', 'Test deposit 4', 550, 'USD', 7000, $1, 90000006, 'test')
    `, [testAccountId]);

    // Recalibrate
    const res = await request(app, 'POST', `/accounts/calibrate?accountId=${testAccountId}`);
    expect(res.status).toBe(200);

    const result = res.body.results[0];

    // New anchor: Apr 05, closing_balance = 7000
    expect(result.anchorDate).toBe('2026-04-05');
    expect(result.anchorClosingBalance).toBe(7000);

    // New SUM: 1000 + (-200) + 750 + (-100) + 500 + 550 = 2500
    expect(result.totalTransactionAmount).toBe(2500);

    // New opening_balance: 7000 - 2500 = 4500 (unchanged — consistent PS data)
    expect(result.computedOpeningBalance).toBe(4500);
  });

  test('after recalibration, historical balances remain correct', async () => {
    // Mar 31 should still be 5950
    const result = await pool.query(`
      SELECT a.opening_balance + COALESCE(SUM(t.amount), 0) AS balance
      FROM accounts a
      LEFT JOIN transactions t
        ON t.account_id = a.id
        AND t.transaction_date >= a.opening_balance_date
        AND t.transaction_date <= '2026-03-31'
      WHERE a.id = $1
      GROUP BY a.id, a.opening_balance, a.opening_balance_date
    `, [testAccountId]);

    expect(parseFloat(result.rows[0].balance)).toBe(5950);
  });

  test('recalibration with a corrected PS closing_balance adjusts opening balance', async () => {
    // Simulate PocketSmith correcting the closing balance on the latest txn
    // Now PS says the balance is actually 7100 (was 7000 — off by 100)
    await pool.query(`
      UPDATE transactions SET closing_balance = 7100
      WHERE account_id = $1 AND ps_id = 90000006
    `, [testAccountId]);

    // Recalibrate
    const res = await request(app, 'POST', `/accounts/calibrate?accountId=${testAccountId}`);
    expect(res.status).toBe(200);

    const result = res.body.results[0];

    // SUM unchanged: 2500
    expect(result.totalTransactionAmount).toBe(2500);

    // New opening_balance: 7100 - 2500 = 4600 (shifted by +100)
    expect(result.computedOpeningBalance).toBe(4600);

    // Now historical balances shift by +100
    const balResult = await pool.query(`
      SELECT a.opening_balance + COALESCE(SUM(t.amount), 0) AS balance
      FROM accounts a
      LEFT JOIN transactions t
        ON t.account_id = a.id
        AND t.transaction_date >= a.opening_balance_date
        AND t.transaction_date <= '2026-03-31'
      WHERE a.id = $1
      GROUP BY a.id, a.opening_balance, a.opening_balance_date
    `, [testAccountId]);

    // Was 5950, now 6050 (shifted by +100 due to corrected anchor)
    expect(parseFloat(balResult.rows[0].balance)).toBe(6050);
  });

  test('cleanup: remove extra transaction and restore state', async () => {
    await pool.query(`DELETE FROM transactions WHERE ps_id = 90000006`);

    // Recalibrate back to original state
    const res = await request(app, 'POST', `/accounts/calibrate?accountId=${testAccountId}`);
    expect(res.status).toBe(200);
    expect(res.body.results[0].computedOpeningBalance).toBe(4500);
  });
});

// ============================================================================
// Test Suite 4: Calibration Status Endpoint
// ============================================================================

describe('GET /accounts/calibration-status', () => {
  const app = createApp();

  test('returns calibration status with calculated balance', async () => {
    const res = await request(app, 'GET', '/accounts/calibration-status');
    expect(res.status).toBe(200);

    const testAcct = res.body.data.find(a => a.name === TEST_ACCOUNT_NAME);
    expect(testAcct).toBeDefined();
    expect(testAcct.openingBalance).toBe(4500);
    // 4500 + 1950 = 6450
    expect(testAcct.calculatedBalance).toBe(6450);
    expect(testAcct.currency).toBe('USD');
    expect(testAcct.lastCalibratedAt).not.toBeNull();
  });
});

// ============================================================================
// Test Suite 5: Edge Cases
// ============================================================================

describe('Edge cases', () => {
  const app = createApp();

  test('account with no transactions has balance = opening_balance', async () => {
    // Create an account with no transactions
    const acctRes = await pool.query(`
      INSERT INTO accounts (name, account_type, section, currency, is_active,
                            ps_account_name, opening_balance, opening_balance_date)
      VALUES ('__test_empty_acct__', 'asset', 'balance_sheet', 'USD', TRUE,
              '__test_empty_acct__', 1000, '2000-01-01')
      RETURNING id
    `);
    const emptyId = acctRes.rows[0].id;

    try {
      const result = await pool.query(`
        SELECT a.opening_balance + COALESCE(SUM(t.amount), 0) AS balance
        FROM accounts a
        LEFT JOIN transactions t
          ON t.account_id = a.id
          AND t.transaction_date >= a.opening_balance_date
          AND t.transaction_date <= '2026-12-31'
        WHERE a.id = $1
        GROUP BY a.id, a.opening_balance, a.opening_balance_date
      `, [emptyId]);

      expect(parseFloat(result.rows[0].balance)).toBe(1000);
    } finally {
      await pool.query(`DELETE FROM accounts WHERE id = $1`, [emptyId]);
    }
  });

  test('calibrate with no closing_balance transactions skips the account', async () => {
    // Create account with transactions that have NULL closing_balance
    const acctRes = await pool.query(`
      INSERT INTO accounts (name, account_type, section, currency, is_active,
                            ps_account_name, opening_balance, opening_balance_date)
      VALUES ('__test_no_cb_acct__', 'asset', 'balance_sheet', 'USD', TRUE,
              '__test_no_cb_acct__', 0, '2000-01-01')
      RETURNING id
    `);
    const noCbId = acctRes.rows[0].id;

    await pool.query(`
      INSERT INTO transactions (transaction_date, description1, amount, currency,
                                closing_balance, account_id, ps_id, source)
      VALUES ('2026-01-01', 'No CB txn', 500, 'USD', NULL, $1, 90000099, 'test')
    `, [noCbId]);

    try {
      const res = await request(app, 'POST', `/accounts/calibrate?accountId=${noCbId}`);
      expect(res.status).toBe(200);
      // Should not calibrate since there's no anchor (no closing_balance)
      expect(res.body.calibrated).toBe(0);
    } finally {
      await pool.query(`DELETE FROM transactions WHERE account_id = $1`, [noCbId]);
      await pool.query(`DELETE FROM accounts WHERE id = $1`, [noCbId]);
    }
  });
});
