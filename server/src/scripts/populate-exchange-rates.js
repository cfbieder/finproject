/**
 * Populate exchange_rates table from Frankfurter API
 *
 * Fetches daily exchange rates for PLN, EUR, GBP to USD
 * and inserts them into the PostgreSQL exchange_rates table.
 *
 * Usage: node populate-exchange-rates.js [startYear] [endYear]
 * Default: fetches from 2020 to current year
 */

const db = require('../v2/db');

const BASE_URL = 'https://api.frankfurter.app';
const CURRENCIES = ['PLN', 'EUR', 'GBP'];
const BASE_CURRENCY = 'USD';

async function fetchRates(startDate, endDate) {
  const currencies = CURRENCIES.join(',');
  const url = `${BASE_URL}/${startDate}..${endDate}?from=${BASE_CURRENCY}&to=${currencies}`;
  console.log(`Fetching: ${url}`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function insertRates(data) {
  if (!data.rates) return 0;

  let inserted = 0;
  const dates = Object.keys(data.rates).sort();

  for (const date of dates) {
    const dayRates = data.rates[date];

    for (const currency of CURRENCIES) {
      const rate = dayRates[currency];
      if (!rate) continue;

      // Store as "from currency TO USD" rate (inverse of what Frankfurter returns)
      // Frankfurter returns USD->PLN rate, we need PLN->USD
      const toUsdRate = 1 / rate;

      try {
        await db.query(`
          INSERT INTO exchange_rates (from_currency, to_currency, rate, rate_date, source)
          VALUES ($1, $2, $3, $4, 'frankfurter')
          ON CONFLICT (from_currency, to_currency, rate_date) DO UPDATE SET
            rate = EXCLUDED.rate,
            created_at = NOW()
        `, [currency, 'USD', toUsdRate.toFixed(6), date]);
        inserted++;
      } catch (err) {
        console.error(`Failed to insert ${currency} ${date}:`, err.message);
      }
    }
  }

  return inserted;
}

async function main() {
  const args = process.argv.slice(2);
  const startYear = parseInt(args[0]) || 2020;
  const endYear = parseInt(args[1]) || new Date().getFullYear();

  console.log(`Populating exchange rates from ${startYear} to ${endYear}`);
  console.log(`Currencies: ${CURRENCIES.join(', ')} → ${BASE_CURRENCY}`);

  let totalInserted = 0;

  for (let year = startYear; year <= endYear; year++) {
    const startDate = `${year}-01-01`;
    const endDate = year === endYear
      ? new Date().toISOString().split('T')[0]
      : `${year}-12-31`;

    try {
      console.log(`\nFetching ${year}...`);
      const data = await fetchRates(startDate, endDate);
      const count = await insertRates(data);
      totalInserted += count;
      console.log(`  Inserted/updated ${count} rates for ${year}`);

      // Rate limit: wait 500ms between requests
      if (year < endYear) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } catch (err) {
      console.error(`Failed to fetch ${year}:`, err.message);
    }
  }

  console.log(`\nDone! Total rates inserted/updated: ${totalInserted}`);

  // Show summary
  const summary = await db.query(`
    SELECT from_currency, COUNT(*) as rate_count, MIN(rate_date) as earliest, MAX(rate_date) as latest
    FROM exchange_rates
    GROUP BY from_currency
    ORDER BY from_currency
  `);
  console.log('\nExchange rates summary:');
  for (const row of summary.rows) {
    console.log(`  ${row.from_currency} → USD: ${row.rate_count} rates (${row.earliest} to ${row.latest})`);
  }

  await db.end();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
