/**
 * V2 Health Check Routes
 */

const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', async (req, res) => {
  try {
    const result = await db.query('SELECT NOW() as server_time, current_database() as database');
    res.json({
      status: 'ok',
      version: 'v2',
      database: 'PostgreSQL',
      server_time: result.rows[0].server_time,
      database_name: result.rows[0].database
    });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      version: 'v2',
      error: error.message
    });
  }
});

module.exports = router;
