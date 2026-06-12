const express = require("express");
const cors = require("cors");
const morgan = require("morgan");

const v2Routes = require("./v2/routes");
const app = express();

app.use(morgan("tiny"));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
// CORS allowlist. The SPA is normally same-origin (nginx proxies /api), so
// this only matters for the cross-origin dev/Tailscale paths. Requests with
// no Origin header (curl, same-origin) always pass. Override via CORS_ORIGINS
// (comma-separated) without a code change.
const DEFAULT_CORS_ORIGINS = [
  "http://localhost:5174",
  "http://127.0.0.1:5174",
  "http://100.94.46.62:5174",      // Vite dev over Tailscale
  "http://192.168.1.87:3006",      // prod HTTP
  "https://192.168.1.87:5175",     // prod HTTPS
  "https://fin.tail413695.ts.net", // Tailscale serve
];
const corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)
  : DEFAULT_CORS_ORIGINS;
app.use(
  cors({
    origin: (origin, cb) => cb(null, !origin || corsOrigins.includes(origin)),
    credentials: true,
  })
);

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

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  res.status(err.status || 500).json({
    error: err.message,
    status: err.status || 500,
  });
});

module.exports = app;
