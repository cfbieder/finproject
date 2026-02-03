/**
 * Migrate Transactions from MongoDB (psdata) to PostgreSQL
 *
 * Reads from MongoDB psdata collection and inserts into PostgreSQL transactions table.
 * Maps category names to category IDs and account names to account IDs.
 *
 * Usage: MONGO_URI=... DATABASE_URL=... node migrate-transactions.js
 */

const mongoose = require('mongoose');
const db = require('../v2/db');

// MongoDB model
const PSdataSchema = new mongoose.Schema({
  Date: Date,
  Description1: String,
  Description2: String,
  Amount: Number,
  Currency: String,
  BaseAmount: Number,
  BaseCurrency: String,
  TransactionType: String,
  Account: String,
  ClosingBalance: Number,
  Category: String,
  ParentCategories: String,
  Labels: String,
  Memo: String,
  Note: String,
  ID: String,
  Bank: String
});

const PSdata = mongoose.model('psdata', PSdataSchema, 'psdata');

async function migrateTransactions() {
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
  const totalCount = await PSdata.countDocuments();
  console.log(`Found ${totalCount} transactions in MongoDB`);

  // Clear existing transactions
  console.log('Clearing existing transactions...');
  await db.query('TRUNCATE transactions CASCADE');

  // Process in batches
  const BATCH_SIZE = 500;
  let processed = 0;
  let inserted = 0;
  let skipped = 0;

  const cursor = PSdata.find().cursor();

  let batch = [];

  for await (const doc of cursor) {
    const accountId = accountNameToId.get(doc.Account) || null;
    const categoryId = categoryNameToId.get(doc.Category) || null;

    // Parse labels (stored as comma-separated string in MongoDB)
    const labels = doc.Labels ? doc.Labels.split(',').map(l => l.trim()).filter(l => l) : null;

    batch.push({
      ps_id: doc.ID ? parseInt(doc.ID, 10) : null,
      transaction_date: doc.Date,
      description1: doc.Description1 || null,
      description2: doc.Description2 || null,
      amount: doc.Amount || 0,
      currency: doc.Currency || 'USD',
      base_amount: doc.BaseAmount || null,
      base_currency: doc.BaseCurrency || 'USD',
      transaction_type: doc.TransactionType || null,
      account_id: accountId,
      closing_balance: doc.ClosingBalance || null,
      category_id: categoryId,
      labels: labels,
      memo: doc.Memo || null,
      note: doc.Note || null,
      bank: doc.Bank || null,
      source: 'pocketsmith'
    });

    if (batch.length >= BATCH_SIZE) {
      const result = await insertBatch(batch);
      inserted += result.inserted;
      skipped += result.skipped;
      processed += batch.length;
      batch = [];

      if (processed % 1000 === 0) {
        console.log(`  Processed ${processed}/${totalCount} (${Math.round(processed/totalCount*100)}%)`);
      }
    }
  }

  // Insert remaining
  if (batch.length > 0) {
    const result = await insertBatch(batch);
    inserted += result.inserted;
    skipped += result.skipped;
    processed += batch.length;
  }

  console.log(`\nMigration complete!`);
  console.log(`  Total processed: ${processed}`);
  console.log(`  Inserted: ${inserted}`);
  console.log(`  Skipped (no ps_id): ${skipped}`);

  // Print date range
  const dateRange = await db.query(`
    SELECT MIN(transaction_date) as min_date, MAX(transaction_date) as max_date
    FROM transactions
  `);
  console.log(`  Date range: ${dateRange.rows[0].min_date} to ${dateRange.rows[0].max_date}`);

  await mongoose.disconnect();
  console.log('Disconnected from MongoDB');
}

async function insertBatch(batch) {
  let inserted = 0;
  let skipped = 0;

  for (const txn of batch) {
    // Skip if no ps_id (can't track uniqueness)
    if (!txn.ps_id) {
      skipped++;
      continue;
    }

    try {
      await db.query(`
        INSERT INTO transactions (
          ps_id, transaction_date, description1, description2,
          amount, currency, base_amount, base_currency,
          transaction_type, account_id, closing_balance,
          category_id, labels, memo, note, bank, source
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        ON CONFLICT (ps_id) DO UPDATE SET
          transaction_date = EXCLUDED.transaction_date,
          description1 = EXCLUDED.description1,
          amount = EXCLUDED.amount,
          category_id = EXCLUDED.category_id
      `, [
        txn.ps_id,
        txn.transaction_date,
        txn.description1,
        txn.description2,
        txn.amount,
        txn.currency,
        txn.base_amount,
        txn.base_currency,
        txn.transaction_type,
        txn.account_id,
        txn.closing_balance,
        txn.category_id,
        txn.labels,
        txn.memo,
        txn.note,
        txn.bank,
        txn.source
      ]);
      inserted++;
    } catch (err) {
      console.error(`Error inserting transaction ${txn.ps_id}:`, err.message);
    }
  }

  return { inserted, skipped };
}

// Run if called directly
if (require.main === module) {
  migrateTransactions()
    .then(() => {
      process.exit(0);
    })
    .catch(err => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}

module.exports = { migrateTransactions };
