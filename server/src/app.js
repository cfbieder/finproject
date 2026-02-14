const express = require("express");
const cors = require("cors");
const morgan = require("morgan");

const v2Routes = require("./v2/routes");
const app = express();

app.use(morgan("tiny"));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors({ origin: true, credentials: true }));

// All routes via V2 (PostgreSQL-backed)
app.use("/api/v2", v2Routes);

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
      "/api/v2/health",
      "/api/v2/accounts",
      "/api/v2/budget",
      "/api/v2/categories",
      "/api/v2/forecast",
      "/api/v2/ingest-ps",
      "/api/v2/reports",
      "/api/v2/transactions",
      "/api/v2/util",
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
