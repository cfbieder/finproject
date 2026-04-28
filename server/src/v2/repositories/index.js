/**
 * Repository Module Exports
 *
 * Central export for all database repositories.
 *
 * As of migration 021, the categories table has been collapsed into accounts.
 * P&L leaves carry is_transfer and ps_category_id directly. The legacy
 * categories repository has been removed; consumers use accountsRepo.findPLeaves()
 * for the equivalent dropdown / filter functionality.
 */

const transactions = require('./transactions');
const accounts = require('./accounts');
const budget = require('./budget');
const forecast = require('./forecast');
const psdata = require('./psdata');
const budgetFxRates = require('./budgetFxRates');
const transferMatchGroups = require('./transferMatchGroups');
const fcLines = require('./fcLines');
const accountSourceMappings = require('./accountSourceMappings');

module.exports = {
  transactions,
  accounts,
  budget,
  forecast,
  psdata,
  budgetFxRates,
  transferMatchGroups,
  fcLines,
  accountSourceMappings
};
