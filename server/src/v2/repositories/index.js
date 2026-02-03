/**
 * Repository Module Exports
 *
 * Central export for all database repositories.
 */

const transactions = require('./transactions');
const accounts = require('./accounts');
const categories = require('./categories');
const budget = require('./budget');
const forecast = require('./forecast');

module.exports = {
  transactions,
  accounts,
  categories,
  budget,
  forecast
};
