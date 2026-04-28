#!/usr/bin/env node
/**
 * rebuild-db.js — Rebuild the PostgreSQL database from CSV data
 *
 * This script re-seeds accounts, categories, and transactions from the
 * existing ps-transactions.csv file after a data loss event.
 *
 * Usage (inside server container):
 *   node /app/src/scripts/rebuild-db.js
 *
 * Usage (via docker exec from project root):
 *   docker exec fin-server node /app/src/scripts/rebuild-db.js
 */

'use strict';

const fs = require('node:fs');
const readline = require('node:readline');
const path = require('node:path');
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL || 'postgres://fin:findev123@fin-postgres:5432/fin';
const pool = new Pool({ connectionString });

// Path to CSV inside container
const CSV_PATH = process.env.CSV_PATH || '/app/components/data/ps-transactions.csv';

// ─────────────────────────────────────────────────────────────────────────────
// COA Account tree definition
// ─────────────────────────────────────────────────────────────────────────────

const COA_TREE = [
  {
    name: 'Balance Sheet Accounts',
    section: 'balance_sheet',
    account_type: 'asset',
    children: [
      {
        name: 'Assets',
        account_type: 'asset',
        children: [
          {
            name: 'Cash and Bank Accounts',
            account_type: 'asset',
            children: [
              { name: 'Capital One Savings', currency: 'USD' },
              { name: 'Cash EUR', currency: 'EUR' },
              { name: 'Caixa EUR', currency: 'EUR' },
              { name: 'Chase Checking', currency: 'USD' },
              { name: 'Chase Saving', currency: 'USD' },
              { name: 'PKO', currency: 'PLN' },
              { name: 'PKO EUR', currency: 'EUR' },
              { name: 'PKO Savings', currency: 'PLN' },
              { name: 'PKO - Deposits', currency: 'PLN' },
              { name: 'PKO - USD', currency: 'USD' },
              { name: 'Revolut-EUR', currency: 'EUR' },
              { name: 'Revolut-USD', currency: 'USD' },
              { name: 'Santandar', currency: 'EUR' },
              { name: 'WISE - EUR', currency: 'EUR' },
              { name: 'WISE - GBP', currency: 'GBP' },
              { name: 'WISE - PLN', currency: 'PLN' },
              { name: 'WISE - USD - Old', currency: 'USD' },
              { name: 'Wise - USD', currency: 'USD' },
            ],
          },
          {
            name: 'Investments',
            account_type: 'asset',
            children: [
              { name: 'CVC - MIP', currency: 'USD' },
              { name: 'CVC Fund VIII', currency: 'USD' },
              { name: 'CVC Fund IX', currency: 'USD' },
              { name: 'Fidelity Bond', currency: 'USD' },
              { name: 'Fidelity Cash Mgt', currency: 'USD' },
              { name: 'Fidelity IRA', currency: 'USD' },
              { name: 'Fidelity Options', currency: 'USD' },
              { name: 'Fidelity Stocks', currency: 'USD' },
              { name: 'Misc Investments', currency: 'USD' },
              { name: 'PKO TFI', currency: 'PLN' },
              { name: 'Tax Reserve - PL', currency: 'PLN' },
              { name: 'Tax Reserve - US', currency: 'USD' },
              { name: 'Tradier', currency: 'USD' },
            ],
          },
          {
            name: 'Real Estate',
            account_type: 'asset',
            children: [
              { name: 'PL - Muszlowa', currency: 'PLN' },
              { name: 'PL - Niemena', currency: 'PLN' },
              { name: 'SP - Panorama Mar 4', currency: 'EUR' },
              { name: 'SP - Panorama Mar 6', currency: 'EUR' },
              { name: 'SP - Sea Senses', currency: 'EUR' },
              { name: 'US - Casarina', currency: 'USD' },
              { name: 'US - Nokomis', currency: 'USD' },
            ],
          },
          {
            name: 'Business Holdings',
            account_type: 'asset',
            children: [
              { name: 'Barkeria Sp. z o.o.', currency: 'PLN' },
              { name: 'OCME Sp. z o.o.', currency: 'PLN' },
              { name: 'United Beverages', currency: 'PLN' },
            ],
          },
        ],
      },
      {
        name: 'Liabilities',
        account_type: 'liability',
        children: [
          {
            name: 'Credit Cards',
            account_type: 'liability',
            children: [
              { name: 'Amazon Visa', currency: 'USD' },
              { name: 'Bonvoy Amex Card', currency: 'USD' },
              { name: 'Delta SkyMiles Reserve Card', currency: 'USD' },
              { name: 'Hilton Honors Card', currency: 'USD' },
              { name: 'LUXURY CARD', currency: 'USD' },
              { name: 'Marriot Visa', currency: 'USD' },
              { name: 'PKO VISA Infinity CB', currency: 'PLN' },
              { name: 'PKO VISA Infinity KB', currency: 'PLN' },
              { name: 'PKO Visa Gold CB', currency: 'PLN' },
              { name: 'PKO Visa Gold KB', currency: 'PLN' },
            ],
          },
          {
            name: 'Mortgages',
            account_type: 'liability',
            children: [
              { name: 'Mortgage - Casarina', currency: 'USD' },
              { name: 'Mortgage - Nokomis', currency: 'USD' },
            ],
          },
        ],
      },
    ],
  },
  {
    name: 'Profit & Loss Accounts',
    section: 'profit_loss',
    account_type: 'income',
    children: [
      {
        name: 'Income',
        account_type: 'income',
        children: [
          { name: 'Total Salary', account_type: 'income' },
          { name: 'Financial Income', account_type: 'income' },
        ],
      },
      {
        name: 'Expense',
        account_type: 'expense',
        children: [
          { name: 'Financial Expenses', account_type: 'expense' },
          { name: 'Living Expenses', account_type: 'expense' },
          { name: 'Property Costs', account_type: 'expense' },
          { name: 'Purchases', account_type: 'expense' },
          { name: 'Taxes', account_type: 'expense' },
          { name: 'Travel', account_type: 'expense' },
          { name: 'One-Off Items', account_type: 'expense' },
        ],
      },
    ],
  },
];

// Map: top-level PS category parent → P&L account name
const CATEGORY_TO_PL_ACCOUNT = {
  'Total Salary':      'Total Salary',
  'Financial Income':  'Financial Income',
  'Financial Expenses': 'Financial Expenses',
  'Living Expenses':   'Living Expenses',
  'Property Costs':    'Property Costs',
  'Travel':            'Travel',
  'One-Off Items':     'One-Off Items',
  'Purchases':         'Purchases',
  'Taxes':             'Taxes',
  'Transfers':         null, // will be marked as transfer
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
      continue;
    }
    if (ch === ',' && !inQuotes) { values.push(current); current = ''; continue; }
    current += ch;
  }
  values.push(current);
  return values;
}

async function parseCsv(filePath) {
  return new Promise((resolve, reject) => {
    const rows = [];
    let headers = null;
    const rl = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity });
    rl.on('line', (line) => {
      if (!line.trim()) return;
      const values = parseCsvLine(line);
      if (!headers) { headers = values; return; }
      const row = {};
      headers.forEach((h, i) => { row[h] = (values[i] || '').trim(); });
      rows.push(row);
    });
    rl.on('close', () => resolve(rows));
    rl.on('error', reject);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Seeding logic
// ─────────────────────────────────────────────────────────────────────────────

async function insertAccount(client, { name, parentId, accountType, section, currency, displayOrder }) {
  const result = await client.query(
    `INSERT INTO accounts (name, parent_id, account_type, section, currency, display_order, is_active, ps_account_name)
     VALUES ($1, $2, $3, $4, $5, $6, TRUE, $1)
     ON CONFLICT (name) DO UPDATE SET
       parent_id    = EXCLUDED.parent_id,
       account_type = EXCLUDED.account_type,
       section      = EXCLUDED.section,
       currency     = COALESCE(EXCLUDED.currency, accounts.currency),
       display_order = EXCLUDED.display_order,
       is_active    = TRUE
     RETURNING id`,
    [name, parentId || null, accountType, section, currency || null, displayOrder || 0]
  );
  const accountId = result.rows[0].id;

  // Auto-create pocketsmith source mapping
  await client.query(
    `INSERT INTO account_source_mappings (account_id, source, external_name)
     VALUES ($1, 'pocketsmith', $2)
     ON CONFLICT (source, external_name) DO NOTHING`,
    [accountId, name]
  );

  return accountId;
}

async function seedNode(client, node, parentId, section, inheritedType, order) {
  const accountType = node.account_type || inheritedType;
  const nodeSection = node.section || section;

  const id = await insertAccount(client, {
    name: node.name,
    parentId,
    accountType,
    section: nodeSection,
    currency: node.currency || null,
    displayOrder: order,
  });

  if (Array.isArray(node.children)) {
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      if (typeof child === 'string') {
        await insertAccount(client, {
          name: child,
          parentId: id,
          accountType,
          section: nodeSection,
          currency: null,
          displayOrder: i,
        });
      } else {
        await seedNode(client, child, id, nodeSection, accountType, i);
      }
    }
  }

  return id;
}

async function seedAccounts(client) {
  console.log('\n[1/3] Seeding accounts...');
  let total = 0;
  for (let i = 0; i < COA_TREE.length; i++) {
    await seedNode(client, COA_TREE[i], null, COA_TREE[i].section, COA_TREE[i].account_type, i);
  }

  const { rows } = await client.query('SELECT COUNT(*) FROM accounts');
  total = parseInt(rows[0].count, 10);
  console.log(`    ✓ ${total} accounts seeded`);
}

async function seedCategories(client, csvRows) {
  console.log('\n[2/3] Seeding P&L accounts from CSV...');

  // Collect unique categories with their top-level parent breadcrumb
  const catMap = new Map(); // catName → topLevelParent
  for (const row of csvRows) {
    const cat = row['Category'];
    const parent = row['Parent Categories'];
    if (cat && !catMap.has(cat)) {
      const topLevel = (parent.split('>')[0] || '').trim();
      catMap.set(cat, topLevel);
    }
  }

  // Build lookup: P&L account name → id
  const plAccountIds = {};
  for (const plName of Object.values(CATEGORY_TO_PL_ACCOUNT)) {
    if (plName) {
      const r = await client.query('SELECT id FROM accounts WHERE name = $1', [plName]);
      if (r.rows[0]) plAccountIds[plName] = r.rows[0].id;
    }
  }

  let plInserted = 0;
  let order = 0;

  for (const [catName, topLevel] of catMap) {
    const isTransfer = topLevel === 'Transfers' || catName.toLowerCase().startsWith('transfer');
    const parentPlName = CATEGORY_TO_PL_ACCOUNT[topLevel] || null;
    const parentPlId = parentPlName ? (plAccountIds[parentPlName] || null) : null;

    // Determine account_type from parent
    const accountType = (topLevel === 'Total Salary' || topLevel === 'Financial Income')
      ? 'income' : 'expense';

    if (parentPlId) {
      // Create / upsert a P&L account for this PS category, carrying is_transfer.
      const r = await client.query(
        `INSERT INTO accounts (name, parent_id, account_type, section, display_order, is_active, ps_account_name, is_transfer)
         VALUES ($1, $2, $3, 'profit_loss', $4, TRUE, $1, $5)
         ON CONFLICT (name) DO UPDATE SET
           parent_id    = EXCLUDED.parent_id,
           account_type = EXCLUDED.account_type,
           section      = EXCLUDED.section,
           display_order = EXCLUDED.display_order,
           is_active    = TRUE,
           is_transfer  = EXCLUDED.is_transfer
         RETURNING id`,
        [catName, parentPlId, accountType, order++, isTransfer]
      );
      plInserted++;

      // Auto-create pocketsmith source mapping
      await client.query(
        `INSERT INTO account_source_mappings (account_id, source, external_name)
         VALUES ($1, 'pocketsmith', $2)
         ON CONFLICT (source, external_name) DO NOTHING`,
        [r.rows[0].id, catName]
      );
    }
  }

  console.log(`    ✓ ${plInserted} P&L accounts added (categories collapsed into accounts)`);
}

async function ingestTransactions() {
  console.log('\n[3/3] Ingesting transactions from CSV...');
  try {
    // Use the existing ingestor service
    const PsCsvIngestorV2 = require('../v2/services/psCsvIngestorV2');
    const ingestor = new PsCsvIngestorV2();
    const result = await ingestor.ingestPsTransactionsFromCsv();
    console.log(`    ✓ Staging: ${result.insertedCount || 0} inserted, ${result.updatedCount || 0} updated, ${result.skippedCount || 0} skipped`);

    // Sync staging to transactions
    const db = require('../v2/db');

    const upsertResult = await db.query(`
      WITH staged AS (
        SELECT
          s.ps_id::bigint as ps_id,
          s.transaction_date,
          s.description1,
          s.description2,
          s.amount,
          s.currency,
          s.base_amount,
          s.base_currency,
          s.transaction_type,
          a.id as account_id,
          c.id as category_id,
          s.closing_balance,
          CASE WHEN s.labels IS NOT NULL AND s.labels != ''
            THEN string_to_array(s.labels, ',')
            ELSE NULL
          END as labels,
          s.memo,
          s.note,
          s.bank
        FROM psdata_staging s
        LEFT JOIN account_source_mappings asm
          ON LOWER(s.account_name) = LOWER(asm.external_name) AND asm.source = 'pocketsmith'
        LEFT JOIN accounts a ON asm.account_id = a.id
        LEFT JOIN account_source_mappings csm
          ON LOWER(s.category_name) = LOWER(csm.external_name) AND csm.source = 'pocketsmith'
        LEFT JOIN accounts c ON csm.account_id = c.id AND c.section = 'profit_loss'
        WHERE a.id IS NOT NULL
          AND s.amount IS NOT NULL
          AND s.transaction_date IS NOT NULL
          AND s.currency IS NOT NULL
      )
      INSERT INTO transactions (
        ps_id, transaction_date, description1, description2,
        amount, currency, base_amount, base_currency,
        transaction_type, account_id, category_id,
        closing_balance, labels, memo, note, bank
      )
      SELECT
        ps_id, transaction_date, description1, description2,
        amount, currency, base_amount, base_currency,
        transaction_type, account_id, category_id,
        closing_balance, labels, memo, note, bank
      FROM staged
      ON CONFLICT (ps_id) DO UPDATE SET
        transaction_date  = EXCLUDED.transaction_date,
        description1      = EXCLUDED.description1,
        description2      = EXCLUDED.description2,
        amount            = EXCLUDED.amount,
        currency          = EXCLUDED.currency,
        base_amount       = EXCLUDED.base_amount,
        base_currency     = EXCLUDED.base_currency,
        transaction_type  = EXCLUDED.transaction_type,
        account_id        = EXCLUDED.account_id,
        category_id       = EXCLUDED.category_id,
        closing_balance   = EXCLUDED.closing_balance,
        labels            = EXCLUDED.labels,
        memo              = EXCLUDED.memo,
        note              = EXCLUDED.note,
        bank              = EXCLUDED.bank
    `);

    const txCount = await db.query('SELECT COUNT(*) FROM transactions');
    console.log(`    ✓ Transactions synced: ${txCount.rows[0].count} total in DB`);

    // Check how many staged rows had no matching account
    const unmapped = await db.query(`
      SELECT DISTINCT s.account_name FROM psdata_staging s
      LEFT JOIN account_source_mappings asm
        ON LOWER(s.account_name) = LOWER(asm.external_name) AND asm.source = 'pocketsmith'
      LEFT JOIN accounts a ON asm.account_id = a.id
      WHERE a.id IS NULL AND s.account_name IS NOT NULL
    `);
    if (unmapped.rows.length > 0) {
      console.log(`\n    ⚠ Unmapped accounts (transactions skipped for these):`);
      unmapped.rows.forEach(r => console.log(`      - ${r.account_name}`));
    }
  } catch (err) {
    console.error('    ✗ Ingest failed:', err.message);
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const client = await pool.connect();
  try {
    console.log('==============================================');
    console.log('  Rebuild Database from CSV');
    console.log('==============================================');
    console.log(`  CSV: ${CSV_PATH}`);
    console.log(`  DB:  ${connectionString.replace(/:([^:@]+)@/, ':***@')}`);

    if (!fs.existsSync(CSV_PATH)) {
      throw new Error(`CSV file not found: ${CSV_PATH}`);
    }

    const csvRows = await parseCsv(CSV_PATH);
    console.log(`\n  Parsed ${csvRows.length} CSV rows`);

    await client.query('BEGIN');
    await seedAccounts(client);
    await seedCategories(client, csvRows);
    await client.query('COMMIT');

    // Ingest outside of transaction (uses its own connection)
    await ingestTransactions();

    // Summary
    console.log('\n==============================================');
    console.log('  Rebuild Summary');
    console.log('==============================================');
    const { rows: summary } = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM accounts WHERE is_active) as accounts,
        (SELECT COUNT(*) FROM accounts WHERE is_active AND section='profit_loss') as pl_leaves,
        (SELECT COUNT(*) FROM psdata_staging) as staging,
        (SELECT COUNT(*) FROM transactions) as transactions
    `);
    const s = summary[0];
    console.log(`  Accounts:     ${s.accounts}`);
    console.log(`  P&L leaves:   ${s.pl_leaves}`);
    console.log(`  Staging rows: ${s.staging}`);
    console.log(`  Transactions: ${s.transactions}`);
    console.log('==============================================\n');

  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('\n✗ Rebuild failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
