const express = require("express");
const cors = require("cors");
const morgan = require("morgan");

const healthRouter = require("./routes/health");
// Legacy v1 routes (MongoDB-based) - Commented out after migration to PostgreSQL
// const balanceRouter = require("./routes/balance");
// const cashFlowRouter = require("./routes/cashFlow");
const coaRouter = require("./routes/coa");
// const ingestRouter = require("./routes/ingestPs");
const utilRouter = require("./routes/util");
// const budgetRouter = require("./routes/budget");
// const forecastRouter = require("./routes/forecast");
const v2Routes = require("./v2/routes");
const app = express();

app.use(morgan("tiny"));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors({ origin: true, credentials: true }));

// Active routes
app.use("/api/util", utilRouter);
app.use("/api/health", healthRouter);
app.use("/api/coa", coaRouter);
app.use("/api/v2", v2Routes);

// Legacy v1 routes (MongoDB-based) - nginx rewrites these to v2
// app.use("/api/balance", balanceRouter);
// app.use("/api/cash-flow", cashFlowRouter);
// app.use("/api/ingest-ps", ingestRouter);
// app.use("/api/budget", budgetRouter);
// app.use("/api/forecast", forecastRouter);

// PostgreSQL connection
const postgres = require("./v2/db");
console.log("[SERVER] PostgreSQL URL: ", process.env.DATABASE_URL ? "configured" : "not configured");

// Test PostgreSQL connection on startup
if (process.env.DATABASE_URL) {
  postgres.healthCheck()
    .then(() => console.log("[SERVER] Connected to PostgreSQL"))
    .catch((err) => console.log("[SERVER] PostgreSQL connection pending:", err.message));
}

app.get("/", (req, res) => {
  res.json({
    service: "fin-server",
    status: "running",
    routes: [
      "/api/health",
      "/api/balance",
      "/api/cash-flow",
      "/api/coa/BalanceSheet",
      "/api/coa/CashFlow",
      "/api/ingest-ps",
      "/api/ingest-ps/upload-ps",
      "/api/ingest-ps/analyze-ps",
      "/api/ingest-ps/refresh-ps",
      "/api/forecast",
    ],
    v2Routes: [
      "/api/v2/health",
      "/api/v2/transactions",
      "/api/v2/accounts",
      "/api/v2/categories",
      "/api/v2/budget",
      "/api/v2/forecast",
    ],
  });
});

app.use((req, res, next) => {
  const err = new Error("Not Found");
  err.status = 404;
  next(err);
});

app.use((err, req, res) => {
  res.status(err.status || 500).json({
    error: err.message,
    status: err.status || 500,
  });
});

module.exports = app;
