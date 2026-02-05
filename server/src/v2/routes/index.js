/**
 * V2 API Routes (PostgreSQL)
 *
 * All new routes using PostgreSQL repositories.
 * Mounted at /api/v2 in app.js
 */

const express = require('express');
const router = express.Router();

const transactionsRouter = require('./transactions');
const accountsRouter = require('./accounts');
const categoriesRouter = require('./categories');
const budgetRouter = require('./budget');
const forecastRouter = require('./forecast');
const healthRouter = require('./health');
const reportsRouter = require('./reports');
const utilRouter = require('./util');
const ingestPsRouter = require('./ingestPs');

// Mount routes
router.use('/health', healthRouter);
router.use('/transactions', transactionsRouter);
router.use('/accounts', accountsRouter);
router.use('/categories', categoriesRouter);
router.use('/budget', budgetRouter);
router.use('/forecast', forecastRouter);
router.use('/reports', reportsRouter);
router.use('/util', utilRouter);
router.use('/ingest-ps', ingestPsRouter);

// API root info
router.get('/', (req, res) => {
  res.json({
    version: 'v2',
    database: 'PostgreSQL',
    routes: [
      '/api/v2/health',
      '/api/v2/transactions',
      '/api/v2/accounts',
      '/api/v2/categories',
      '/api/v2/budget',
      '/api/v2/forecast',
      '/api/v2/reports',
      '/api/v2/util',
      '/api/v2/ingest-ps'
    ]
  });
});

module.exports = router;
