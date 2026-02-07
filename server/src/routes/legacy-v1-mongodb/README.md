# Legacy v1 Routes (MongoDB-based)

This directory contains the original MongoDB-based API routes that have been replaced by PostgreSQL-based v2 routes.

## Migration Status

These routes were deprecated and replaced during the MongoDB → PostgreSQL migration completed in February 2026.

### Replaced Routes:
- `balance.js` → `/api/v2/reports/balance` (v2/routes/reports.js)
- `cashFlow.js` → `/api/v2/reports/cash-flow` (v2/routes/reports.js)
- `budget.js` → `/api/v2/budget/*` (v2/routes/budget.js)
- `forecast.js` → `/api/v2/forecast/*` (v2/routes/forecast.js)
- `ingestPs.js` → `/api/v2/ingest-ps/*` (v2/routes/ingestPs.js)

## Why Archived?

These files are kept for historical reference and potential data recovery needs, but are no longer actively used in the application. All functionality has been reimplemented using PostgreSQL in the v2 API routes.

## Do Not Use

**⚠️ Warning:** These routes depend on MongoDB (mongoose) which has been removed from the application. They will not function without MongoDB connectivity.
