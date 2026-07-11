---
paths:
  - "docker-compose*.yml"
  - "**/docker-compose*.yml"
  - "**/Caddyfile"
---
# Docker Compose safety rules

- **Every compose command names its file explicitly** (`-f docker-compose.prod.yml` /
  `-f docker-compose.dev.yml` / the VM file). A bare `docker compose up/down/exec` is
  forbidden — on this pack's layouts it can target production or drop a service off the
  shared `edge` network (instant 502).
- Compose project names are **pinned and distinct per stack** (`name:` in each file); never
  rely on the directory basename.
- **Data volumes are pinned by explicit `name:`** (e.g. `name: <<APP>>_pg_data`) so the
  volume's identity survives a project/directory rename — an unpinned volume is silently
  abandoned (fresh empty DB) when the compose project name changes.
- Prod secrets in compose use **fail-loud `${VAR:?msg}`** — never `${VAR:-default}`.
- Never `--remove-orphans` when a connector (`cloudflared`) lives in a separate overlay
  under the same project — it kills the connector. Stopping "the stack" must pass **both**
  `-f` files if an overlay exists.
- `docker restart` does **not** reload `env_file`; recreate with `up -d <service>` instead.
- Caddyfile edits via a bind mount are **not** applied by `caddy reload` — use
  `up -d --force-recreate caddy`, then verify each host actually proxies.
- On any network shared with co-tenant apps, address peers by unique `<<APP>>-*` container
  name, never a generic service name (`backend`, `web`).
