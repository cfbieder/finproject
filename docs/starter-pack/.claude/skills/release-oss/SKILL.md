---
name: release-oss
description: Take this project's source code public (publish the repo), as distinct from exposing the running service. Runs the irreversible git-history scan first, then genericizes the working tree, adds the four files a public repo owes its readers, and hardens CI as the contributor contract. Use when asked to open-source the project, make the repo public, publish the source, or add a LICENSE for release.
---

# /release-oss — private repo → public source

Condensed from `docs/guides/open-source-release.md` (copy it in if absent). Publishing the
**source** is independent of exposing the **service** — `deploy-to-public` answers the other
question.

## The one-way door

The moment the repo is public every commit is fetchable, and deleting the repo later does not
un-fetch it. Everything below happens **before** the visibility switch. Never flip visibility
in the same session the scan finds something unresolved.

## Phase 0 — scan the HISTORY, not the working tree (do not skip)

A `sed` pass over the working tree changes HEAD and nothing about `git log -p`.

```bash
git log --all -S'<identifier>' --oneline      # hosts, VPN IPs, internal domains, emails,
git log --all -p -S'<identifier>' | head -50  #   employer/customer names, keys, buckets
git log --all --oneline --diff-filter=A -- '*.env' '*.env.*' '*.pem' '*.key'
git log --all --oneline -- 'Backups/*' '*.dump' '*.sql.gz' '*.sqlite'
```

Classify every hit, and report the table to the user before acting:

| Found in history | Severity | Action |
|---|---|---|
| Credential, token, private key, password | **Critical** | **Rotate now.** A rewrite does not un-leak a pushed value; rotation is the fix. |
| DB dump or any real user data | **Critical** | `git filter-repo` before publishing; treat as a personal-data incident if it reached a shared remote. |
| Internal hostname, VPN IP, private domain | **Moderate** | Not a credential, but it names your infrastructure. Decide deliberately and **write the decision down**. |
| Personal email in commit authorship | **Low** | Rewriting authorship rewrites every hash. Usually accept. |

If rewriting: full mirror, tag, offline backup clone, `git filter-repo` (never
`filter-branch`), before the repo is ever public.

## Phase 1 — genericize the working tree

**A fresh clone must run for a stranger and contain nothing about you.**

- Hosts/domains → `localhost`, `example.com`. Never a real domain, never a VPN IP.
- Derive, don't duplicate — read the deployment domain from a value the operator already
  sets rather than adding a second variable that can disagree.
- Web-server config → catch-all `server_name`; compose/app defaults env-driven with a
  `localhost` fallback so `docker compose up` works with no `.env`.
- **Companion clients** (extensions, mobile apps, CLIs) hardcode your host in a manifest, an
  options page, and a background script — check all three.
- **Untrack personal agent config in one commit:** `git rm -r --cached .claude` + gitignore.
- **The starter pack itself must never be in the tree** — it carries live homelab
  identifiers. Keep it outside the repo directory entirely.

Verify by simulating the stranger — the only check that works:

```bash
git clone <repo> /tmp/fresh && cd /tmp/fresh
grep -rInE '<your-domain>|<your-vpn-subnet>|<your-email>|ts\.net' . && echo "LEAK"
./scripts/setup-dev.sh    # does the documented path work with nothing of yours present?
```

## Phase 2 — the four files (seed from `templates/oss/`, keep them short)

`LICENSE` (choose deliberately — permissive vs copyleft; not choosing means nobody may
legally use it) · `README.md` (what it is, what it runs on, **a quickstart that works from a
fresh clone**) · `CONTRIBUTING.md` (workflow, tests, an explicit no-secrets checklist, and
what you will not accept) · `SECURITY.md` (how to report **privately**, and the response to
expect).

## Phase 3 — CI is the contributor contract

PRs now arrive from people who never read `CLAUDE.md`. Before accepting contributions, make
`scripts/ci-guards.sh` cover the publication invariants: no tracked `.env` (examples
excepted), no `.claude/` or private pack tracked, no dump or backup tracked, no secret with a
non-empty default in a non-dev compose file.

## Phase 4 — after the switch

Issues/PRs are a support channel — state the response you can sustain ("best-effort,
evenings" is fine; silence is not). Say in `CONTRIBUTING.md` that the maintainer pushes to
`main` while contributors fork. Add the public-surface question to the CR template's impact
checklist. Tag releases — someone is pinning them now.
