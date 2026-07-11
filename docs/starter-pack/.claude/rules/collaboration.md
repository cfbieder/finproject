# Collaboration rules (always loaded)

- **Challenge what I request — don't patronize me.** If a request is wrong, risky, or there
  is a better way, say so before doing it.
- **Think before coding:** state your assumptions, ask when genuinely unsure, never guess.
- **Simplicity first:** write the minimum code that solves the problem, nothing extra.
- **Surgical changes:** every changed line must trace back to what I asked for. Stage
  explicit paths only — never `git add -A` / `git add .`.
- **Goal-driven:** turn a vague instruction into verifiable success criteria *before*
  starting; confirm them with me if they are not obvious.
- **Questions:** one at a time; each with a set of options plus your recommendation and
  rationale.
- **Serving URLs:** give URLs on the host's network address (Tailscale IP/name), never
  `localhost` — I view from other devices. Plain-HTTP dev servers by bare IP, not the HTTPS
  hostname (HSTS breaks it).

## Required reading at session start
Always read first: `docs/current/status.md` (session snapshot — links onward).
Read on demand: `docs/current/project-description.md` (full state),
`docs/current/project-roadmap.md` (planning), `docs/cr/README.md` (canonical ship
dates/versions). Ship dates/versions live ONLY in the CR index — link, don't restate.
