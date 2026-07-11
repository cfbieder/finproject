# <<APP>> — Project Brief

> **Template (pack v1.3.0).** The brief is the *what and why*; the pack is the *how*. Fill
> every section — write "none" rather than deleting one, so absence is a decision, not an
> oversight. Sections marked *(if applicable)* may be brief but should be consciously
> dismissed. Version this file (v0.1, v0.2 …) as understanding evolves; once building
> starts, decisions migrate into CR docs and this brief freezes as the founding record.

**Brief version:** v0.1 · **Date:** YYYY-MM-DD · **Author:** <name>

## 1. Problem & opportunity

- What hurts today, for whom, and what it costs them (time/money/risk). Evidence over
  assertion — cite the workbook, the conversation, the numbers you actually saw.
- Why now; why existing tools don't solve it (one line each for the closest alternatives).

## 2. Users & stakeholders

- Primary users (role, technical level, where they work from — desktop/mobile/on-site).
- Secondary: admins, clients-of-the-client, integrators. Who pays vs. who uses.

## 3. Scope

**In scope (v1):** the smallest coherent product — bullet capabilities, not features lists.

**Explicit non-goals:** what this deliberately does NOT do in v1 (and, where known, ever).
This section prevents more scope creep than any process will.

## 4. Success criteria

- **Phase 1 criterion (the 30-day test):** one measurable statement of what must be true
  ~30 days after Phase 1 ships for the project to be worth continuing
  (e.g. "clinic X runs its real bookings through it for 2 consecutive weeks without
  falling back to the old system").
- Longer-horizon markers *(if applicable)*: revenue, users, replaced systems.
- **Kill criteria:** what observation would mean stop/pivot.

## 5. Domain & data

- Core entities and their relationships (a rough sketch is enough — the schema is CR work).
- Data sources/migrations: what existing data must come in, from where, in what shape.
- Volumes & growth expectations (rows, files, users — order of magnitude).
- **Personal/sensitive data inventory:** what PII/medical/financial data will exist —
  drives the PII-scrub scope, GDPR posture, and backup encryption decisions from day one.

## 6. Regulatory & compliance landscape *(if applicable)*

Applicable regimes (GDPR baseline is assumed; add sector-specific — e.g. Polish e-health
P1/EDM, fiscal/Posnet, invoicing) and what each concretely requires of v1 vs. later.

## 7. Competitive & alternative landscape *(if applicable)*

Closest 2–4 alternatives (including "keep using the spreadsheet"): what they do well, the
gap this project exploits, switching costs for the user.

## 8. Technical shape — answers to infra-bootstrap §12

Answer these here so the architecture session starts decided, not exploring:

1. Single host now / future split expected? Anything split-ready from day one?
2. **Async/background work** — none / fire-and-forget in-process / durable (broker+worker)?
3. **Tailscale-only or public domain?** If public: closed (Access allow-list) or open
   (self-service) — i.e., which deploy-to-public branch, and roughly when.
4. Stack choices (backend / frontend / DB) if pre-decided; otherwise "recommend".
5. User-uploaded/file state to mount & back up?
6. Off-host backup target?
7. vNext parallel track / staging tier anticipated?
8. Which optional living catalogs does this domain need (migration matrix is default-on;
   job registry, integrations catalog, secrets inventory)?
9. External integrations & contracts *(if applicable)*: other repos/services, who owns the
   contract, HANDOFFS.md needed?

## 9. Constraints & assumptions

Budget/hosting ceiling, deadlines or external dates, client availability, languages/i18n,
device/browser floor, and the assumptions you are consciously making without evidence.

## 10. Risks & open questions

- Top 3–5 risks with a one-line mitigation each.
- Open questions **for the user/client** (feeds `/question` at kickoff).
- Open questions requiring research (feed CR-001 or a spike).

## 11. Phase plan (rough)

Phase 1 = the smallest shippable slice that can meet §4's criterion. One line per phase,
2–4 phases max; detail lives in CRs once building starts.
