# `templates/oss/` — the four files a public repo owes its readers

Seeded by the `release-oss` skill at Phase 2, **not** at project kickoff — a private repo
does not need them, and an unfilled `SECURITY.md` is worse than none.

| File | Copy to | Fill in |
|---|---|---|
| `LICENSE-MIT.txt` | `LICENSE` | Year + copyright holder. MIT is the default here; choose deliberately — Apache-2.0 when patents matter, AGPL when a self-hosted app's improvements should come back. Not choosing means "all rights reserved": nobody may legally use it. |
| `CONTRIBUTING.md` | `CONTRIBUTING.md` | Test command, commit convention, what you will decline. |
| `SECURITY.md` | `SECURITY.md` | The private reporting channel and a response time you can sustain. |
| — | `README.md` | The project README (seeded at kickoff from `templates/project-readme.md`) — re-check that its quickstart works from a fresh clone with nothing of yours present. |

Keep all four short. Long ones do not get read, and do not get updated.
