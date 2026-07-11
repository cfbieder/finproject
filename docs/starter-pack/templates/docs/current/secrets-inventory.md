# Secrets Inventory — <<APP>>

> Names and locations ONLY — NEVER values. Rules: [security-baseline](../guides/security-baseline.md).

| Secret (env var) | Used by | Lives in | Escrowed? | Last rotated | Rotation trigger |
|---|---|---|---|---|---|
| DB_PASSWORD | postgres, backend | prod .env on <<HOST>> | ☐ | YYYY-MM-DD | host migration / 24 mo |
| JWT_SECRET | backend | prod .env | ☐ | YYYY-MM-DD | 12 mo / exposure |
