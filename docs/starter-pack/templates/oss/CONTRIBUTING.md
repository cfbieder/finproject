# Contributing

Thanks for looking. This is a <solo / small-team> project — read this first so a PR does not
surprise either of us.

## How work happens here

The maintainer pushes to `main` directly; contributors fork and open a PR. That asymmetry is
deliberate, not a double standard — it keeps a small project moving.

## What is likely to be accepted

- Bug fixes with a test that fails before and passes after.
- Documentation fixes, especially anything that was wrong from a fresh clone.
- Small, focused improvements.

**Open an issue before writing a feature.** Features that change the product's scope may be
declined even when the code is good — better to hear that before you build it.

## Before you open a PR

```bash
cp .env.example .env
docker compose -f docker-compose.dev.yml up -d
<test command>
bash scripts/ci-guards.sh
```

CI runs the same commands; a red run will not be merged.

## No-secrets checklist (every PR)

- [ ] No `.env` file, key, token, password, or certificate added — `.env.example` only.
- [ ] No database dump, backup, or file of real user data.
- [ ] No personal or internal hostnames, VPN/private IPs, internal domains, or employer /
      customer names — in the diff **or** in the commit messages.
- [ ] No editor or agent config (`.claude/`, IDE directories) added to the tree.

A secret that reaches a public repo must be rotated, not just reverted — please check before
pushing, not after.

## Commits and style

- <Commit convention, e.g. "imperative subject under 72 chars"; conventional commits if used.>
- Match the surrounding code; keep changes surgical — every changed line should trace to the
  issue being fixed.
