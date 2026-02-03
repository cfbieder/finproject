/**
 * Migrate Chart of Accounts from coa.json to PostgreSQL accounts table
 *
 * Parses the hierarchical JSON structure and flattens it into rows with
 * parent_id references (adjacency list pattern).
 *
 * Usage: DATABASE_URL=... node migrate-accounts.js
 */

const fs = require('fs');
const path = require('path');
const db = require('../v2/db');

// Load COA data
const COA_PATH = path.resolve(__dirname, '../../../components/data/coa.json');
const TRAITS_PATH = path.resolve(__dirname, '../../../components/data/coa_traits.json');

/**
 * Map trait type to our account_type enum
 */
function mapAccountType(traitType, section) {
  if (section === 'balance_sheet') {
    if (['Cash', 'Security', 'RealEstate', 'Business'].includes(traitType)) return 'asset';
    if (['CreditCard', 'Liability', 'Reserve'].includes(traitType)) return 'liability';
    return 'asset'; // default for balance sheet
  } else {
    if (traitType === 'Income') return 'income';
    if (traitType === 'Expense') return 'expense';
    if (traitType === 'Transfer') return 'expense'; // treat transfers as expense type
    return 'expense'; // default for P&L
  }
}

/**
 * Recursively extract accounts from nested COA structure
 */
function extractAccounts(node, parentName, section, depth = 0) {
  const accounts = [];

  if (Array.isArray(node)) {
    for (const item of node) {
      accounts.push(...extractAccounts(item, parentName, section, depth));
    }
  } else if (typeof node === 'object' && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      // Key is the account/category name
      const isLeaf = typeof value === 'string' ||
                     (Array.isArray(value) && value.every(v => typeof v === 'string'));

      // Determine section from top-level keys
      let currentSection = section;
      if (key === 'Balance Sheet Accounts') currentSection = 'balance_sheet';
      if (key === 'Profit & Loss Accounts') currentSection = 'profit_loss';
      if (key === 'Assets' || key === 'Liabilities') currentSection = 'balance_sheet';
      if (key === 'Income' || key === 'Expense') currentSection = 'profit_loss';

      // Add this node as an account
      accounts.push({
        name: key,
        parentName: parentName,
        section: currentSection || 'balance_sheet',
        isCategory: !isLeaf,
        depth: depth
      });

      // Process children
      if (isLeaf) {
        // Leaf values are account names
        const children = Array.isArray(value) ? value : (value ? [value] : []);
        for (const childName of children) {
          if (childName) {
            accounts.push({
              name: childName,
              parentName: key,
              section: currentSection || 'balance_sheet',
              isCategory: false,
              depth: depth + 1
            });
          }
        }
      } else {
        // Recurse into nested structure
        accounts.push(...extractAccounts(value, key, currentSection, depth + 1));
      }
    }
  }

  return accounts;
}

/**
 * Determine account type based on parent hierarchy
 */
function determineAccountType(account, allAccounts) {
  // Check direct traits first
  if (account.traits) {
    return mapAccountType(account.traits.Type, account.section);
  }

  // Check parent hierarchy for Assets/Liabilities
  let current = account;
  const visited = new Set();

  while (current && current.parentName && !visited.has(current.name)) {
    visited.add(current.name);

    if (current.parentName === 'Assets') return 'asset';
    if (current.parentName === 'Liabilities') return 'liability';
    if (current.parentName === 'Income') return 'income';
    if (current.parentName === 'Expense') return 'expense';

    current = allAccounts.find(a => a.name === current.parentName);
  }

  // Default based on section
  return account.section === 'balance_sheet' ? 'asset' : 'expense';
}

async function migrateAccounts() {
  console.log('Loading COA data...');

  const coaData = JSON.parse(fs.readFileSync(COA_PATH, 'utf8'));
  const traitsData = JSON.parse(fs.readFileSync(TRAITS_PATH, 'utf8'));

  console.log('Extracting accounts from hierarchy...');
  const accounts = extractAccounts(coaData, null, null);

  // Remove duplicates and top-level section headers
  const skipNames = ['Balance Sheet Accounts', 'Profit & Loss Accounts'];
  const uniqueAccounts = [];
  const seen = new Set();

  for (const acc of accounts) {
    if (!seen.has(acc.name) && !skipNames.includes(acc.name)) {
      seen.add(acc.name);
      acc.traits = traitsData[acc.name] || null;
      uniqueAccounts.push(acc);
    }
  }

  console.log(`Found ${uniqueAccounts.length} unique accounts`);

  // Clear existing accounts
  console.log('Clearing existing accounts...');
  await db.query('TRUNCATE accounts CASCADE');

  // Insert accounts in order (parents first)
  console.log('Inserting accounts...');

  // First pass: insert all accounts without parent_id
  const nameToId = new Map();
  let displayOrder = 0;

  for (const acc of uniqueAccounts) {
    const accountType = determineAccountType(acc, uniqueAccounts);
    const currency = acc.traits?.Currency && acc.traits.Currency !== 'N/A' && acc.traits.Currency !== '—'
      ? acc.traits.Currency
      : 'USD';
    const accountNumber = acc.traits?.AccountNumber || null;

    const result = await db.query(`
      INSERT INTO accounts (name, account_type, section, currency, account_number, display_order, ps_account_name)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id
    `, [
      acc.name,
      accountType,
      acc.section,
      currency,
      accountNumber,
      displayOrder++,
      acc.name // ps_account_name same as name initially
    ]);

    nameToId.set(acc.name, result.rows[0].id);
  }

  // Second pass: update parent_id references
  console.log('Setting parent relationships...');

  for (const acc of uniqueAccounts) {
    if (acc.parentName && nameToId.has(acc.parentName)) {
      await db.query(`
        UPDATE accounts SET parent_id = $1 WHERE id = $2
      `, [nameToId.get(acc.parentName), nameToId.get(acc.name)]);
    }
  }

  console.log('Account migration complete!');

  // Print summary
  const summary = await db.query(`
    SELECT account_type, section, COUNT(*) as count
    FROM accounts
    GROUP BY account_type, section
    ORDER BY section, account_type
  `);

  console.log('\nSummary:');
  for (const row of summary.rows) {
    console.log(`  ${row.section} / ${row.account_type}: ${row.count}`);
  }

  return nameToId;
}

// Run if called directly
if (require.main === module) {
  migrateAccounts()
    .then(() => {
      console.log('\nDone!');
      process.exit(0);
    })
    .catch(err => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}

module.exports = { migrateAccounts };
