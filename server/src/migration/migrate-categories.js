/**
 * Migrate Categories to PostgreSQL
 *
 * Categories in this system map PocketSmith categories to our accounts.
 * We create categories from the P&L accounts (Income/Expense) in COA.
 *
 * Usage: DATABASE_URL=... node migrate-categories.js
 */

const fs = require('fs');
const path = require('path');
const db = require('../v2/db');

const COA_PATH = path.resolve(__dirname, '../../../components/data/coa.json');
const TRAITS_PATH = path.resolve(__dirname, '../../../components/data/coa_traits.json');

/**
 * Extract all leaf account names from COA that are in P&L section
 */
function extractPLCategories(node, parentName = null, inPL = false) {
  const categories = [];

  if (Array.isArray(node)) {
    for (const item of node) {
      categories.push(...extractPLCategories(item, parentName, inPL));
    }
  } else if (typeof node === 'object' && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      const isInPL = inPL || key === 'Profit & Loss Accounts' || key === 'Income' || key === 'Expense';
      const isLeaf = typeof value === 'string' ||
                     (Array.isArray(value) && value.every(v => typeof v === 'string'));

      if (isInPL && key !== 'Profit & Loss Accounts') {
        // Add this node as a potential category
        categories.push({
          name: key,
          parentName: parentName,
          isLeaf: isLeaf
        });
      }

      if (isLeaf && isInPL) {
        // Add leaf values as categories
        const children = Array.isArray(value) ? value : (value ? [value] : []);
        for (const childName of children) {
          if (childName) {
            categories.push({
              name: childName,
              parentName: key,
              isLeaf: true
            });
          }
        }
      } else if (!isLeaf) {
        categories.push(...extractPLCategories(value, key, isInPL));
      }
    }
  }

  return categories;
}

async function migrateCategories() {
  console.log('Loading COA data...');

  const coaData = JSON.parse(fs.readFileSync(COA_PATH, 'utf8'));
  const traitsData = JSON.parse(fs.readFileSync(TRAITS_PATH, 'utf8'));

  console.log('Extracting P&L categories...');
  const categories = extractPLCategories(coaData);

  // Remove duplicates
  const uniqueCategories = [];
  const seen = new Set();

  for (const cat of categories) {
    if (!seen.has(cat.name)) {
      seen.add(cat.name);
      cat.traits = traitsData[cat.name] || null;
      uniqueCategories.push(cat);
    }
  }

  console.log(`Found ${uniqueCategories.length} unique categories`);

  // Get account name to ID mapping
  const accountResult = await db.query('SELECT id, name FROM accounts');
  const accountNameToId = new Map(accountResult.rows.map(r => [r.name, r.id]));

  // Clear existing categories
  console.log('Clearing existing categories...');
  await db.query('TRUNCATE categories CASCADE');

  // Insert categories
  console.log('Inserting categories...');
  const nameToId = new Map();
  let inserted = 0;

  for (const cat of uniqueCategories) {
    // Check if this category is a transfer type
    const isTransfer = cat.traits?.Type === 'Transfer' ||
                       cat.name.startsWith('Transfer -') ||
                       cat.name === 'FX';

    // Map to account if exists
    const mappedAccountId = accountNameToId.get(cat.name) || null;

    const result = await db.query(`
      INSERT INTO categories (name, mapped_account_id, is_transfer, is_active)
      VALUES ($1, $2, $3, TRUE)
      RETURNING id
    `, [cat.name, mappedAccountId, isTransfer]);

    nameToId.set(cat.name, result.rows[0].id);
    inserted++;
  }

  // Update parent_id references
  console.log('Setting parent relationships...');

  for (const cat of uniqueCategories) {
    if (cat.parentName && nameToId.has(cat.parentName)) {
      await db.query(`
        UPDATE categories SET parent_id = $1 WHERE id = $2
      `, [nameToId.get(cat.parentName), nameToId.get(cat.name)]);
    }
  }

  console.log(`Inserted ${inserted} categories`);

  // Print summary
  const summary = await db.query(`
    SELECT
      COUNT(*) FILTER (WHERE is_transfer) as transfers,
      COUNT(*) FILTER (WHERE NOT is_transfer) as regular,
      COUNT(*) FILTER (WHERE mapped_account_id IS NOT NULL) as mapped
    FROM categories
  `);

  console.log('\nSummary:');
  console.log(`  Regular categories: ${summary.rows[0].regular}`);
  console.log(`  Transfer categories: ${summary.rows[0].transfers}`);
  console.log(`  Mapped to accounts: ${summary.rows[0].mapped}`);

  return nameToId;
}

// Run if called directly
if (require.main === module) {
  migrateCategories()
    .then(() => {
      console.log('\nDone!');
      process.exit(0);
    })
    .catch(err => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}

module.exports = { migrateCategories };
