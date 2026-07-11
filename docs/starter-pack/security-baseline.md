# Security Baseline

> **Pack role:** the proactive security floor for every project — secrets lifecycle,
> dependency/patching policy, and a per-project inventory. The pack's other docs already
> carry strong *reactive* and *architectural* security (fail-loud secrets, tunnel hardening,
> Tailscale ringfencing, rate limits); this doc adds the standing policies that otherwise
> exist only as incident responses. Application-layer specifics (auth model, CORS, CSP)
> stay in [`infra-bootstrap.md`](infra-bootstrap.md) and [`deploy-to-public.md`](deploy-to-public.md).
>
> **Last reviewed:** 2026-07-06.

## 1. Secrets — where they live, at rest and in use

- **In use:** gitignored `.env` files, `chmod 600`, owned by the deploy user; a committed
  `.env.example` template with `CHANGE_ME` values. Prod secrets **fail loud** if unset
  (`${VAR:?msg}`) — never `:-defaults`. (infra-bootstrap §8.)
- **At rest / escrow:** the durable homelab fileshare's `secrets/` directory (mirror +
  encrypted off-box PBS backup — [`guides/fileshare-access.md`](guides/fileshare-access.md))
  is the canonical escrow for: SSH deploy keys, PBS paperkeys, tunnel tokens, and a copy of
  each project's prod `.env`. **Rule: any secret whose loss makes something unrecoverable
  (a backup-encryption paperkey above all) is escrowed there the day it's created.**
- **Handling:** type secrets into files over SSH or via a hidden `read -rsp` prompt (the
  pattern in deploy-to-public §2.2) — never paste into a chat/AI session, ticket, or
  screenshot. Verify presence with a count (`grep -c '^KEY=…'`), not by echoing the value.
- **Never in:** git history, compose files, script bodies, `CLAUDE.md`, agent memory, or
  CI logs (mask in CI where the platform supports it).

## 2. Rotation — proactive cadence, not only incident response

The pack's existing rotation triggers (group-readable `.env`, on-screen token, VM
migration) remain; add a standing cadence so long-lived secrets don't quietly become
permanent:

| Secret | Cadence | Mechanics |
|---|---|---|
| `JWT_SECRET` (+ refresh secret) | ~12 months, or any suspicion | New value → recreate backend → all sessions invalidated (announce if multi-user) |
| Cloudflare tunnel token | ~12 months, or any exposure | Tunnel → Configure → Refresh token → update `.env.cloudflared` → `up -d` |
| Third-party API keys (Resend, LLM, etc.) | ~12 months, or on staff/contractor change | Issue new key → hidden-prompt into `.env` → recreate service → revoke old |
| DB passwords | On host migration (natural point) or ~24 months | New password + `ALTER ROLE`; update `.env` in place |
| SSH deploy keys | On repo-access change; audit yearly | Read-only, one repo per key; revoke in the forge UI |
| SMB / infra passwords | ~24 months | `smbpasswd` per the fileshare guide |

**Natural rotation points beat calendar discipline** — bake rotation into events you
already perform: every host migration, every VM rebuild, every offboarding. The calendar
cadence is the backstop, not the plan.

## 3. Per-project secrets inventory (promoted from optional to recommended)

Every project keeps `docs/current/secrets-inventory.md` — **names and locations only,
NEVER values**:

```markdown
| Secret (env var) | Used by | Lives in | Escrowed? | Last rotated | Rotation trigger |
|---|---|---|---|---|---|
| DB_PASSWORD | postgres, backend | prod .env on <<HOST>> | fileshare ✓ | 2026-07-06 | host migration / 24 mo |
| JWT_SECRET | backend | prod .env | fileshare ✓ | 2026-07-06 | 12 mo / exposure |
| TUNNEL_TOKEN | cloudflared | .env.cloudflared | fileshare ✓ | 2026-07-06 | 12 mo / exposure |
```

The inventory is what makes rotation *possible* under pressure — during an incident you
enumerate from the table instead of grepping compose files at 2 a.m. Review it whenever a
CR adds an integration.

## 4. Dependency & image update policy

**Pinning:**
- Base images pinned to a **minor** line (`postgres:16-alpine`, `node:20-alpine`) — patch
  updates flow in on rebuild; major bumps are a deliberate CR.
- The **sole public ingress** (`cloudflared`) pinned **by digest** (`@sha256:…`) so it
  cannot silently self-upgrade (deploy-to-public hardening). Re-pin deliberately, ~quarterly.
- App dependencies locked (`package-lock.json` / `uv.lock` / `requirements.txt` with
  versions) and the lockfile committed; `engines` pinned in `package.json`.

**Update flow:**
- **Renovate or Dependabot on every repo** — grouped weekly PRs for patch/minor, individual
  PRs for major. CI (see [`testing-and-ci.md`](testing-and-ci.md)) is what makes merging
  these cheap; without tests, an update bot is a liability.
- **Security advisories:** enable the forge's vulnerability alerts; `npm audit` /
  `pip-audit` runs in CI as a **warning** (not a gate — advisory noise would train you to
  ignore red), reviewed on the monthly pass.
- **Monthly patch pass (~30 min, calendar it):** merge green update PRs, rebuild + redeploy
  prod images (pulls base-image patches), `apt upgrade` on the host(s), reboot if the
  kernel changed. The deploy script's backup-first behavior makes this low-drama.
- **OS:** hosts run an Ubuntu LTS with `unattended-upgrades` enabled for security packages;
  distribution upgrades are a scheduled CR, never automatic.

## 5. Host & platform floor (checklist — details live in the playbooks)

Restated here as the audit list; mechanics are in deploy-to-public Part 2:

- [ ] SSH: key-only, root login off, passwords off; `fail2ban` on public boxes.
- [ ] Firewall: default-deny; public boxes allow **SSH only** (tunnel is outbound).
- [ ] Public-facing nodes **Tailscale-ringfenced** (tagged + ACL-restricted to only what
      they need) — a compromised edge box must not pivot into the tailnet.
- [ ] Datastores bound to `127.0.0.1`/compose network; never tunnel-routed, never `0.0.0.0`.
- [ ] Non-root container users; user data on volumes with correct ownership (not `0777`).
- [ ] Per-user data isolation enforced server-side; admin-gated mutations; auth rate-limited
      on the **real** client IP.
- [ ] Backups: three tiers + **restore drills** ([`script-library.md`](script-library.md) §11).
- [ ] Prod→dev data sync runs the **PII scrub** (script-library §7) — no raw personal data
      on dev boxes.

## 6. When something leaks anyway

1. Rotate the affected secret **first** (inventory table = the map), then investigate.
2. Assume anything that shared the same `.env` or screen is also exposed — rotate the file's
   worth, not the single value.
3. Check for use: auth logs, Cloudflare dashboard, forge audit log, provider usage pages.
4. Write the gotcha into the relevant playbook's catalog and, if machine-checkable, into
   `ci-guards.sh` — the pack's standing rule: every incident ends by making its class of
   incident harder.
