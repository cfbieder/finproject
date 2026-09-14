# <<APP>>

<one sentence: what this does and for whom.>

> Seeded from the starter pack. Keep this README the thing a stranger reads first — what it
> is, what it runs on, and a quickstart that works **from a fresh clone**. Project state
> lives in `docs/current/`, not here.

## Status

<e.g. "Private beta on <<PROD_URL>>. Best-effort maintenance." — link
[docs/current/status.md](docs/current/status.md) for the live snapshot.>

## Stack

<<BACKEND>> · <<FRONTEND>> · <<DB>> · <<WEB>>, on a single host with Docker Compose.
Full architecture: [docs/current/project-description.md](docs/current/project-description.md).

## Quickstart (fresh clone)

```bash
cp .env.example .env                 # fill the values it names — no secrets in git
docker compose -f docker-compose.dev.yml up -d
cd backend && npm ci && npm run migrate && npm run dev
cd frontend && npm ci && npm run dev
```

Then open the dev server on the host's network address (not `localhost` — see
`.claude/rules/collaboration.md`).

## Tests

```bash
cd backend && npm test
bash scripts/ci-guards.sh            # convention guards, same ones CI runs
```

## Docs

| Where | What |
|---|---|
| [docs/current/status.md](docs/current/status.md) | Session snapshot — the first read |
| [docs/current/project-description.md](docs/current/project-description.md) | What is built now |
| [docs/current/project-roadmap.md](docs/current/project-roadmap.md) | What is planned |
| [docs/cr/README.md](docs/cr/README.md) | Change requests — canonical ship dates/versions |
| [docs/guides/](docs/guides/) | Operational runbooks |

## License

<none yet — private repo. On publishing, see the `release-oss` skill and `templates/oss/`.>
