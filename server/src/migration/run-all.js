/**
 * Run All Migrations
 *
 * Executes all migration scripts in the correct order:
 * 1. Accounts (from coa.json)
 * 2. Categories (from coa.json P&L section)
 * 3. Transactions (from MongoDB psdata)
 * 4. Budget (from MongoDB budgetData)
 * 5. Forecast (from MongoDB FCModule, FCIncExp)
 *
 * Usage: MONGO_URI=... DATABASE_URL=... node run-all.js
 */

const { migrateAccounts } = require('./migrate-accounts');
const { migrateCategories } = require('./migrate-categories');
const { migrateTransactions } = require('./migrate-transactions');
const { migrateBudget } = require('./migrate-budget');
const { migrateForecast } = require('./migrate-forecast');
const db = require('../v2/db');

async function runAllMigrations() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║           FIN Database Migration: MongoDB → PostgreSQL      ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  const startTime = Date.now();

  try {
    // Verify PostgreSQL connection
    console.log('Verifying PostgreSQL connection...');
    await db.healthCheck();
    console.log('✓ PostgreSQL connected\n');

    // Step 1: Accounts
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('STEP 1: Migrating Accounts from coa.json');
    console.log('═══════════════════════════════════════════════════════════════');
    await migrateAccounts();
    console.log();

    // Step 2: Categories
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('STEP 2: Migrating Categories from coa.json');
    console.log('═══════════════════════════════════════════════════════════════');
    await migrateCategories();
    console.log();

    // Step 3: Transactions
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('STEP 3: Migrating Transactions from MongoDB');
    console.log('═══════════════════════════════════════════════════════════════');
    await migrateTransactions();
    console.log();

    // Step 4: Budget
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('STEP 4: Migrating Budget from MongoDB');
    console.log('═══════════════════════════════════════════════════════════════');
    await migrateBudget();
    console.log();

    // Step 5: Forecast
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('STEP 5: Migrating Forecast from MongoDB');
    console.log('═══════════════════════════════════════════════════════════════');
    await migrateForecast();
    console.log();

    // Final summary
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║                    MIGRATION COMPLETE                       ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    const counts = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM accounts) as accounts,
        (SELECT COUNT(*) FROM categories) as categories,
        (SELECT COUNT(*) FROM transactions) as transactions,
        (SELECT COUNT(*) FROM budget_entries) as budget_entries,
        (SELECT COUNT(*) FROM forecast_modules) as forecast_modules,
        (SELECT COUNT(*) FROM forecast_income_expense) as forecast_incexp
    `);

    const c = counts.rows[0];
    console.log('Final record counts:');
    console.log(`  Accounts:           ${c.accounts}`);
    console.log(`  Categories:         ${c.categories}`);
    console.log(`  Transactions:       ${c.transactions}`);
    console.log(`  Budget entries:     ${c.budget_entries}`);
    console.log(`  Forecast modules:   ${c.forecast_modules}`);
    console.log(`  Forecast inc/exp:   ${c.forecast_incexp}`);
    console.log(`\nTotal time: ${elapsed}s`);

  } catch (err) {
    console.error('\n╔════════════════════════════════════════════════════════════╗');
    console.error('║                    MIGRATION FAILED                         ║');
    console.error('╚════════════════════════════════════════════════════════════╝');
    console.error('\nError:', err.message);
    console.error(err.stack);
    throw err;
  } finally {
    await db.close();
  }
}

// Run if called directly
if (require.main === module) {
  runAllMigrations()
    .then(() => {
      process.exit(0);
    })
    .catch(() => {
      process.exit(1);
    });
}

module.exports = { runAllMigrations };
