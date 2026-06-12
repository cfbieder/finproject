#!/usr/bin/env node

/**
 * Seed the PostgreSQL accounts table from coa.json + coa_traits.json.
 *
 * Usage:
 *   DATABASE_URL=postgres://fin:$POSTGRES_PASSWORD@localhost:5434/fin node server/src/scripts/seedAccounts.js
 *
 * This script is idempotent — it uses ON CONFLICT (name) DO UPDATE so it can
 * be re-run safely.
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// ---------------------------------------------------------------------------
// Resolve data file paths
// ---------------------------------------------------------------------------
const DATA_DIR = path.resolve(__dirname, '../../../components/data');
const COA_PATH = path.join(DATA_DIR, 'coa.json');
const TRAITS_PATH = path.join(DATA_DIR, 'coa_traits.json');

// ---------------------------------------------------------------------------
// Map tree position to account_type enum
// ---------------------------------------------------------------------------
const TYPE_MAP = {
  Assets: 'asset',
  Liabilities: 'liability',
  Income: 'income',
  Expense: 'expense',
};

const SECTION_MAP = {
  'Balance Sheet Accounts': 'balance_sheet',
  'Profit & Loss Accounts': 'profit_loss',
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('ERROR: DATABASE_URL environment variable is not set.');
    process.exit(1);
  }

  const coaData = JSON.parse(fs.readFileSync(COA_PATH, 'utf8'));
  const traitsData = JSON.parse(fs.readFileSync(TRAITS_PATH, 'utf8'));

  const pool = new Pool({ connectionString });
  const client = await pool.connect();

  let insertCount = 0;

  try {
    await client.query('BEGIN');

    for (const sectionObj of coaData) {
      const sectionName = Object.keys(sectionObj)[0]; // e.g. "Balance Sheet Accounts"
      const section = SECTION_MAP[sectionName];
      if (!section) {
        console.warn(`Skipping unknown section: ${sectionName}`);
        continue;
      }

      const groups = sectionObj[sectionName]; // array of { Assets: [...] }, { Liabilities: [...] }, etc.

      // Insert the section root node
      const sectionId = await insertAccount(client, {
        name: sectionName,
        parentId: null,
        accountType: section === 'balance_sheet' ? 'asset' : 'income', // placeholder type for root
        section,
        currency: null,
        accountNumber: null,
        displayOrder: 0,
        traits: traitsData[sectionName],
      });
      insertCount++;

      let groupOrder = 0;
      for (const groupObj of groups) {
        const groupName = Object.keys(groupObj)[0]; // e.g. "Assets", "Liabilities"
        const accountType = TYPE_MAP[groupName];
        if (!accountType) {
          console.warn(`Skipping unknown group: ${groupName}`);
          continue;
        }

        // Insert the primary group node (Assets, Liabilities, Income, Expense)
        const groupId = await insertAccount(client, {
          name: groupName,
          parentId: sectionId,
          accountType,
          section,
          currency: null,
          accountNumber: null,
          displayOrder: groupOrder++,
          traits: traitsData[groupName],
        });
        insertCount++;

        // Recursively insert children
        const count = await insertChildren(
          client,
          groupObj[groupName],
          groupId,
          accountType,
          section,
          traitsData,
        );
        insertCount += count;
      }
    }

    await client.query('COMMIT');

    console.log(`\nSeeded ${insertCount} accounts successfully.\n`);

    // Print summary
    const summary = await client.query(`
      SELECT section, account_type, COUNT(*) as count
      FROM accounts
      GROUP BY section, account_type
      ORDER BY section, account_type
    `);
    console.log('Summary by section/type:');
    for (const row of summary.rows) {
      console.log(`  ${row.section} / ${row.account_type}: ${row.count}`);
    }

    const depthSummary = await client.query(`
      WITH RECURSIVE tree AS (
        SELECT id, name, parent_id, 0 as depth FROM accounts WHERE parent_id IS NULL
        UNION ALL
        SELECT a.id, a.name, a.parent_id, t.depth + 1
        FROM accounts a JOIN tree t ON a.parent_id = t.id
      )
      SELECT depth, COUNT(*) as count FROM tree GROUP BY depth ORDER BY depth
    `);
    console.log('\nSummary by depth:');
    for (const row of depthSummary.rows) {
      console.log(`  depth ${row.depth}: ${row.count} nodes`);
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed, rolled back:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

// ---------------------------------------------------------------------------
// Insert a single account row (upsert)
// ---------------------------------------------------------------------------
async function insertAccount(client, {
  name, parentId, accountType, section, currency, accountNumber, displayOrder, traits,
}) {
  // Resolve currency: prefer traits, fall back to provided, then NULL
  let resolvedCurrency = currency;
  if (traits) {
    const traitCurrency = traits.Currency;
    if (traitCurrency && traitCurrency !== 'N/A' && traitCurrency !== '\u2014' && traitCurrency !== '--') {
      resolvedCurrency = traitCurrency.trim();
    }
  }

  // Resolve account number from traits
  let resolvedAccountNumber = accountNumber;
  if (traits && traits.AccountNumber) {
    resolvedAccountNumber = traits.AccountNumber;
  }

  const sql = `
    INSERT INTO accounts (name, parent_id, account_type, section, currency, account_number, display_order, is_active, ps_account_name)
    VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, $1)
    ON CONFLICT (name) DO UPDATE SET
      parent_id = EXCLUDED.parent_id,
      account_type = EXCLUDED.account_type,
      section = EXCLUDED.section,
      currency = EXCLUDED.currency,
      account_number = EXCLUDED.account_number,
      display_order = EXCLUDED.display_order
    RETURNING id
  `;

  const result = await client.query(sql, [
    name,
    parentId,
    accountType,
    section,
    resolvedCurrency || null,
    resolvedAccountNumber || null,
    displayOrder,
  ]);

  return result.rows[0].id;
}

// ---------------------------------------------------------------------------
// Recursively insert children from the COA JSON array
// ---------------------------------------------------------------------------
async function insertChildren(client, items, parentId, accountType, section, traitsData) {
  if (!Array.isArray(items)) return 0;

  let count = 0;
  let order = 0;

  for (const item of items) {
    if (typeof item === 'string') {
      // Leaf account (e.g. "PKO EUR", "Chase Checking")
      if (!item.trim()) continue; // skip empty strings (e.g. "Uncategorized": "")
      await insertAccount(client, {
        name: item.trim(),
        parentId,
        accountType,
        section,
        currency: null,
        accountNumber: null,
        displayOrder: order++,
        traits: traitsData[item.trim()],
      });
      count++;
    } else if (item && typeof item === 'object' && !Array.isArray(item)) {
      // Category node or shorthand leaf
      for (const [key, value] of Object.entries(item)) {
        if (Array.isArray(value)) {
          // Category node with children: { "USD Bank Accounts": [...] }
          const nodeId = await insertAccount(client, {
            name: key,
            parentId,
            accountType,
            section,
            currency: null,
            accountNumber: null,
            displayOrder: order++,
            traits: traitsData[key],
          });
          count++;
          count += await insertChildren(client, value, nodeId, accountType, section, traitsData);
        } else if (typeof value === 'string') {
          if (value === '' || value === key) {
            // Shorthand leaf: { "Groceries": "Groceries" } or { "Uncategorized": "" }
            // Insert just the key as a leaf
            await insertAccount(client, {
              name: key,
              parentId,
              accountType,
              section,
              currency: null,
              accountNumber: null,
              displayOrder: order++,
              traits: traitsData[key],
            });
            count++;
          } else {
            // Key differs from value — treat key as category, value as child
            const nodeId = await insertAccount(client, {
              name: key,
              parentId,
              accountType,
              section,
              currency: null,
              accountNumber: null,
              displayOrder: order++,
              traits: traitsData[key],
            });
            count++;
            await insertAccount(client, {
              name: value.trim(),
              parentId: nodeId,
              accountType,
              section,
              currency: null,
              accountNumber: null,
              displayOrder: 0,
              traits: traitsData[value.trim()],
            });
            count++;
          }
        }
      }
    }
  }

  return count;
}

main();
