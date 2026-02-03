const express = require("express");
const db = require("../v2/db");

const router = express.Router();

router.get("/", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString()
  });
});

// PostgreSQL health check endpoint
router.get("/postgres", async (req, res) => {
  try {
    const result = await db.query("SELECT NOW() as server_time, current_database() as database");
    res.json({
      status: "ok",
      database: "postgres",
      server_time: result.rows[0].server_time,
      database_name: result.rows[0].database,
    });
  } catch (error) {
    res.status(503).json({
      status: "error",
      database: "postgres",
      error: error.message,
    });
  }
});

// Full health check - all systems
router.get("/full", async (req, res) => {
  const health = {
    status: "ok",
    timestamp: new Date().toISOString(),
    services: {},
  };

  // Check PostgreSQL
  try {
    await db.healthCheck();
    health.services.postgres = { status: "ok" };
  } catch (error) {
    health.status = "degraded";
    health.services.postgres = { status: "error", error: error.message };
  }

  const statusCode = health.status === "ok" ? 200 : 503;
  res.status(statusCode).json(health);
});

module.exports = router;
