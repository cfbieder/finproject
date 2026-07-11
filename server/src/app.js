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

// Central error handler (CR043 Phase 1.4). Response shape is unchanged
// ({ error, status }); the addition is that an unexpected 5xx is logged
// server-side with its stack (previously swallowed into the response only),
// while expected 4xx (AppError/validation/404) stay quiet. Success-envelope
// unification ({ data, meta }) is deliberately NOT done here — it's cross-
// cutting with the frontend and scoped to Phase 3.3 (see CR043 N8).
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) {
    console.error(`[error] ${req.method} ${req.originalUrl} → ${status}:`, err.stack || err.message);
  }
  res.status(status).json({
    error: err.message,
    status,
  });
});

module.exports = app;
