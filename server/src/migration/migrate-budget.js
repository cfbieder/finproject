/**
 * Migrate Budget Data from MongoDB (budgetData) to PostgreSQL
 *
 * Reads from MongoDB budgetData collection and inserts into PostgreSQL budget_entries table.
 *
 * Usage: MONGO_URI=... DATABASE_URL=... node migrate-budget.js
 */

const mongoose = require('mongoose');
const db = require('../v2/db');

// MongoDB model
const BudgetDataSchema = new mongoose.Schema({
  Date: Date,
  Description1: String,
  Amount: Number,
  Currency: String,
  BaseAmount: Number,
  BaseCurrency: String,
  Account: String,
  Category: String,
  Labels: String,
  Note: String
});

const BudgetData = mongoose.model('budgetData', BudgetDataSchema, 'budgetData');

async function migrateBudget() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB');

  // Load lookup maps from PostgreSQL
  console.log('Loading lookup data from PostgreSQL...');

  const accountResult = await db.query('SELECT id, name FROM accounts');
  const accountNameToId = new Map(accountResult.rows.map(r => [r.name, r.id]));

  const categoryResult = await db.query('SELECT id, name FROM categories');
  const categoryNameToId = new Map(categoryResult.rows.map(r => [r.name, r.id]));

  console.log(`Loaded ${accountNameToId.size} accounts, ${categoryNameToId.size} categories`);

  // Count MongoDB documents
  const totalCount = await BudgetData.countDocuments();
  console.log(`Found ${totalCount} budget entries in MongoDB`);

  if (totalCount === 0) {
    console.log('No budget data to migrate.');
    await mongoose.disconnect();
    return;
  }

  // Clear existing budget entries
  console.log('Clearing existing budget entries...');
  await db.query('TRUNCATE budget_entries CASCADE');

  // Create a default budget version for the migration
  const years = await BudgetData.distinct('Date').then(dates =>
    [...new Set(dates.map(d => new Date(d).getFullYear()))]
  );

  const versionMap = new Map();
  for (const year of years) {
    if (!isNaN(year)) {
      const result = await db.query(`
        INSERT INTO budget_versions (budget_year, version_name, description, is_active)
        VALUES ($1, $2, $3, TRUE)
        ON CONFLICT (budget_year, version_name) DO UPDATE SET updated_at = NOW()
        RETURNING id
      `, [year, 'Original', `Migrated budget for ${year}`]);
      versionMap.set(year, result.rows[0].id);
    }
  }

  console.log(`Created budget versions for years: ${[...versionMap.keys()].join(', ')}`);

  // Process all budget entries
  let inserted = 0;
  const cursor = BudgetData.find().cursor();

  for await (const doc of cursor) {
    const entryDate = new Date(doc.Date);
    const budgetYear = entryDate.getFullYear();
    const versionId = versionMap.get(budgetYear) || null;

    const accountId = accountNameToId.get(doc.Account) || null;
    const categoryId = categoryNameToId.get(doc.Category) || null;

    // Parse labels
    const labels = doc.Labels ? doc.Labels.split(',').map(l => l.trim()).filter(l => l) : null;

    try {
      await db.query(`
        INSERT INTO budget_entries (
          version_id, entry_date, description, amount, currency,
          base_amount, base_currency, account_id, category_id,
          labels, note, budget_year
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `, [
        versionId,
        entryDate,
        doc.Description1 || null,
        doc.Amount || 0,
        doc.Currency || 'USD',
        doc.BaseAmount || null,
        doc.BaseCurrency || 'USD',
        accountId,
        categoryId,
        labels,
        doc.Note || null,
        budgetYear
      ]);
      inserted++;
    } catch (err) {
      console.error(`Error inserting budget entry:`, err.message);
    }

    if (inserted % 500 === 0) {
      console.log(`  Inserted ${inserted} entries...`);
    }
  }

  console.log(`\nBudget migration complete!`);
  console.log(`  Total inserted: ${inserted}`);

  // Print summary by year
  const summary = await db.query(`
    SELECT budget_year, COUNT(*) as count, SUM(base_amount) as total
    FROM budget_entries
    GROUP BY budget_year
    ORDER BY budget_year
  `);

  console.log('\nSummary by year:');
  for (const row of summary.rows) {
    console.log(`  ${row.budget_year}: ${row.count} entries, total: ${parseFloat(row.total || 0).toFixed(2)}`);
  }

  await mongoose.disconnect();
  console.log('Disconnected from MongoDB');
}

// Run if called directly
if (require.main === module) {
  migrateBudget()
    .then(() => {
      process.exit(0);
    })
    .catch(err => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}

module.exports = { migrateBudget };
