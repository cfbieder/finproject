---
paths:
  - "docker-compose*.yml"
  - "Scripts/**"
---
# Docker Compose safety rules

Two stacks share this one host — **prod and dev are the same machine**, so a wrong
compose command hits production directly.

- **Every compose command names its file explicitly.** Prod = `docker-compose.yml`
  (project `psproject` — derived from the directory name, so never rename/move the
  checkout), dev = `-f docker-compose.dev.yml`. A bare `docker compose up/down/exec` targets **prod**.
- **Prod DB volume is pinned to the external name `fin_postgres_data`** (survives
  project renames). Never `docker compose down -v` on prod. Dev uses
  `postgres_data_dev`.
- **`POSTGRES_PASSWORD` has no default since CR034** — compose fails loud if unset.
  Keep secrets fail-loud (`${VAR:?msg}`), never `${VAR:-default}` (CI guard checks).
- `docker restart` does **not** reload `env_file` — recreate with `up -d <service>`.
- Ops scripts: `set -euo pipefail`, preflight checks that fail fast, destructive actions
  gated behind a confirm prompt or explicit flag.
