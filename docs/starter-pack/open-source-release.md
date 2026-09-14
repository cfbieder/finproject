# Open-Source Release — taking a private repo public

> **Pack role:** the playbook for publishing a project's **source**, as distinct from
> exposing its **service**. [`deploy-to-public.md`](deploy-to-public.md) answers "how do
> people reach the running app"; this answers "how does the code become something a stranger
> can read, fork, and send a PR to — without publishing anything that was only ever meant for
> your own machines". The two are independent: a Tailscale-private app can have a public
> repo, and usually should before it has public users.
>
> Distilled from a real single-host project (Vue + Fastify + Postgres, ~40 CRs of history)
> taken public under MIT.
>
> **Operational distillation:** the `release-oss` skill (`/release-oss`) runs these phases;
> the four Phase-2 files are seeded from [`templates/oss/`](templates/oss/).
>
> **Last reviewed:** 2026-08-30.

## The one-way door

Publication is irreversible in the way that matters: the moment the repo is public, every
commit is fetchable, and deleting the repo later does not un-fetch it. Forks, archives, and
crawlers keep what they got. So the whole discipline is **front-loaded** — everything below
happens before the visibility switch, because after it there is no cheap fix.

## Phase 0 — scan the HISTORY, not the working tree

**This is the step projects skip, and it is the only one that cannot be repaired afterwards.**

Genericizing the current files is the obvious half of the job and the easy half. Git keeps
every prior version, so a `sed` pass over the working tree changes what a reader sees at HEAD
and nothing at all about what `git log -p` hands them.

```bash
# For every identifier that should not be public: hosts, VPN IPs, internal domains,
# personal emails, employer names, customer names, API keys, bucket names.
git log --all -S'<identifier>' --oneline      # commits that ADDED or REMOVED it
git log --all -p -S'<identifier>' | head -50  # see it in context

# Files that should never have been tracked at all:
git log --all --oneline --diff-filter=A -- '*.env' '*.env.*' '*.pem' '*.key'
git log --all --oneline -- 'Backups/*' '*.dump' '*.sql.gz' '*.sqlite'
```

Then classify each hit, and be honest about the difference:

| Found in history | Severity | Action |
|---|---|---|
| A credential, token, private key, or password | **Critical** | **Rotate it. Now.** Rewriting history does not un-leak a value that was pushed to a remote or shared. Rotation is the fix; the rewrite is optional cleanup after. |
| A database dump, or any file of real user data | **Critical** | Rewrite history (`git filter-repo`) **before** publishing, and treat it as a personal-data incident if it ever reached a shared remote. |
| An internal hostname, VPN IP, or private domain | **Moderate** | A CGNAT/VPN address is not routable from the internet and is not a credential — but it does name your infrastructure. Decide deliberately: accept it, or rewrite. Write the decision down; do not let it be an accident. |
| A personal email in commit authorship | **Low, and noisy to fix** | Rewriting authorship rewrites every commit hash. Usually accept, or set the account's privacy email going forward. |

**If you do rewrite:** do it before the repo is ever public, on a full mirror, with a tag and
a backup clone kept offline. `git filter-repo` (not `filter-branch`). Every hash changes, so
any existing clone must be re-cloned — trivial for a solo project, disruptive for a team, and
one more reason to do this before rather than after.

**The decision to record.** Whatever you conclude, put a line in the project's docs saying
what history contains and that it was reviewed. The next maintainer's alternative is to
re-derive it from scratch or, more likely, to never look.

## Phase 1 — genericize the working tree

The rule: **a fresh clone must run for a stranger, and must contain nothing about you.**
Every environment-specific value becomes either a documented env var or an obviously-fake
default.

- **Hosts and domains** → `localhost`, `example.com`, `app.example.com`. Never a real
  domain, not even one you own, and never a VPN IP.
- **Derive, don't duplicate.** Where a script needs the deployment's domain, derive it from
  a value the operator already sets (e.g. parse it out of `CORS_ORIGIN` in the prod env file)
  rather than adding a second variable that can disagree with the first.
- **Web-server config** → a catch-all `server_name`, so the config is correct for any
  deployment instead of correct only for yours.
- **Compose and app defaults** → env-driven with a `localhost` fallback, so `docker compose
  up` works out of the box for someone with no `.env` yet.
- **Companion clients** (browser extensions, mobile apps, CLIs) are easy to forget and often
  the worst offenders — they tend to have your host hardcoded in a manifest, an options page,
  and a background script.
- **Personal agent config** (`.claude/`, editor settings, private runbooks): **untrack it and
  gitignore it**, in one commit. `git rm -r --cached .claude` — it stays on your disk and
  leaves the repo. Check it does not come back: a guard in `ci-guards.sh` costs one line.
- **The private starter pack itself** must never be in the tree. It carries live homelab
  identifiers by design. Gitignore it by pattern, and keep it outside the repo directory
  entirely — an untracked file in `docs/` is one `git add .` from being published.

Then verify by simulating the stranger, which is the only check that actually works:

```bash
git clone <repo> /tmp/fresh && cd /tmp/fresh
grep -rInE '<your-domain>|<your-vpn-subnet>|<your-email>|ts\.net' . && echo "LEAK"
./scripts/setup-dev.sh      # does the documented path work with nothing of yours present?
```

## Phase 2 — the four files a public repo owes its readers

Keep them short. Long ones do not get read, and do not get updated.

(Seed all four from [`templates/oss/`](templates/oss/) — `LICENSE-MIT.txt`,
`CONTRIBUTING.md`, `SECURITY.md`, and the project `README.md` from
[`templates/project-readme.md`](templates/project-readme.md).)

- **`LICENSE`** — pick it deliberately, because it is effectively permanent once others have
  contributed. Permissive (MIT/Apache-2.0) if you want the code used with no friction;
  copyleft (AGPL) if a self-hosted app's improvements should come back. Apache-2.0 over MIT
  when patents matter. Not choosing means "all rights reserved" — nobody may legally use it.
- **`README.md`** — what it is, a screenshot, what it runs on, and *the quickstart that
  actually works from a fresh clone*. The commonest failure is a README describing the
  maintainer's environment.
- **`CONTRIBUTING.md`** — the fork/PR workflow, the commit convention, how to run the tests,
  and an explicit **no-secrets checklist** for PR authors. Say plainly what you will and will
  not accept; a solo maintainer's "I may say no to features" is kinder written down than
  discovered in a closed PR.
- **`SECURITY.md`** — how to report a vulnerability **privately** (a security advisory or an
  email, never a public issue), and what response to expect. Without it, the first report
  arrives as a public issue with a working exploit in it.

## Phase 3 — CI is the contributor contract

A private repo can rely on the maintainer's habits. A public one cannot: PRs arrive from
people who have never read `CLAUDE.md`, and nothing enforces a convention that lives only in
prose. Before accepting contributions, wire the gates from
[`testing-and-ci.md`](testing-and-ci.md) — and make sure `ci-guards.sh` covers the
publication invariants specifically, since they are exactly the ones a newcomer breaks
without knowing:

- no `.env` file tracked (examples excepted);
- no personal agent config (`.claude/`) or private pack tracked;
- no database dump or backup tracked;
- no secret given a non-empty default in a non-dev compose file.

A guard is worth more than a written rule here, because the reader you are guarding against
has not read the rule.

## Phase 4 — after the switch

- **Issues and PRs are now a support channel.** Decide the response you can actually sustain
  and say so in the README. "Best-effort, evenings" is a fine answer; silence is not.
- **The maintainer usually keeps pushing to `main` directly** while contributors fork and
  PR. That asymmetry is normal and worth stating in `CONTRIBUTING.md` so it does not read as
  a double standard.
- **Every future CR gains a public-surface question:** does this change what a stranger sees,
  need config a fork must set, or embed anything of yours? Put it in the CR template's impact
  checklist — that is the only place it will reliably get asked.
- **Releases become other people's dependency.** Tag them, and keep the version string
  meaningful; someone is now pinning it.
