# CR044 — Productization & Marketability Assessment (2026-07-11 Review)

**Status:** ✅ DECIDED 2026-07-11 — **owner chose Option A: stay personal** (via /question, same day as the assessment). No public release planned; the release-only moves (rename, fresh-history repo, LICENSE/README, launch collateral) are dropped; the four **no-regret** moves (pluggable LLM provider, SimpleFIN/CSV-first connectivity, demo seed, migration runner) survive as ordinary backlog items on the owner's own timeline (runner already approved into CR043 Phase 1.1). Revisit this gate only if motivation changes or CR027's invite-only multi-user proves insufficient for the sharing intent. The assessment below is retained as the decision record. Companion CRs: [CR042](CR042_UI_LOOK_AND_FEEL.md) (UI), [CR043](CR043_CODE_STRUCTURE_PROGRAM.md) (code structure).
**Track:** v3 product-level. **Explicitly excludes auth/multi-tenancy** (CR027/v4, per review scope) — items overlapping CR027 scope are flagged, not duplicated.
**Anchor in FC_NEXT_STEPS.md:** [cr044](../FC_NEXT_STEPS.md#cr044)

## Situation

Fin is a mature single-user system with unusually good engineering hygiene (252+117 tests, CI on fresh-migrations DB, CR034 hardening, design system, PWA). But it is marketable to exactly one person today: **no README, no LICENSE** (ISC boilerplate in `server/package.json` only), the bank-feed service is a separate **private gitignored repo**, AI Review hard-depends on the owner's **private ocr-llm gateway**, migrations only auto-run on fresh volumes, docs are saturated with the owner's real finances/IPs/account names (e.g. MTM dollar amounts in FC_NEXT_STEPS v3.0.56; "SP - Properties −$6.4M" in v3.0.61), and a leaked `BANK_FEED_API_KEY` sits in git history (Known Issue #6). **This repo as it stands cannot be published; a public release means a fresh-history repo with sanitized docs.**

## Market scan (2026-07, web-verified)

**Segment (a) — privacy-first self-hosted OSS (Fin's natural home):**
- *Actual Budget* — YNAB-style, local-first; free OSS; bank sync via **SimpleFIN ($15/yr, US)** + GoCardless (EU) — the reference OSS connectivity architecture.
- *Firefly III* — double-entry ledger, multi-currency, rules; closest to Fin's ledger core; **no forecasting engine**.
- *Maybe Finance* — **the cautionary tale**: 54k GitHub stars, VC-funded, repo archived 2025-07 after failing to monetize; pivoted B2B (community fork "Sure" survives).
- *Ghostfolio* — portfolio-only; small paid hosted tier.

**Segment (b) — subscription SaaS:** Monarch $99–199/yr · Copilot $95/yr (Apple-only) · YNAB $109/yr · Lunch Money ~$100/yr. Crowded, marketing-driven, requires Plaid-class aggregation + compliance posture. Not a solo lane.

**Segment (c) — forecasting/planning:** *ProjectionLab* (free tier; $129/yr; solo-founder success) · *Boldin* ex-NewRetirement ($144/yr) — retirement scenario planning, deep US-tax/Monte-Carlo modeling, but **disconnected from your actual ledger**.

**Differentiator — validated with a caveat.** No self-hosted tool combines (1) a real transaction ledger, (2) a balance-sheet-level multi-year forecast engine (modules, cash sweep, scenario copy/compare, audit trail), and (3) private AI narrative review. *"Your actuals feed your 15-year plan, on your own hardware, with an AI reviewer that never sees a cloud"* is a genuinely unoccupied position. The caveat: the addressable audience is (self-hosters) ∩ (serious long-horizon planners) ∩ (will run Postgres + Docker + an LLM) — a niche of a niche; thousands of enthusiastic users at best, not a revenue market. ProjectionLab already serves the SaaS-tolerant majority with deeper tax/Monte-Carlo modeling than Fin's deterministic engine.

## Distribution-model options

| Option | Effort to viable | Revenue potential | Solo-maintainer fit | Verdict |
|---|---|---|---|---|
| A. Remain personal | none | none | perfect | baseline; always acceptable |
| B. OSS self-hosted (AGPLv3) + sponsorship | medium (§Roadmap) | ~zero (Maybe's 54k stars ≠ a business) | good, but issue/support load is real | **recommended if any distribution happens** |
| C. Source-available + paid hosting | very high (others' financial data: uptime, breach liability, aggregator contracts) | low-moderate, slow | poor (Lunch Money was *built* SaaS; retrofitting = CR027 and beyond) | no |
| D. Closed niche planning SaaS (forecast engine as ProjectionLab competitor) | high (planning-only UX + Monte Carlo/tax depth) | moderate ($129–144/yr umbrella exists) | poor-to-fair vs two entrenched incumbents | no |
| E. Extract forecast engine as OSS library (atop Firefly/Actual data) | medium-high (engine coupled to Fin's COA/FC-Lines schema — see CR043 N9) | none direct; highest reputation-per-effort | fair | fallback, not the play |

## The honest take (recommendation)

**Default: do not commercialize; keep Fin personal.** Evidence: Maybe Finance died with 54k stars and a funded team; the SaaS segment is a knife-fight among Mint refugees; the planning segment has two entrenched incumbents whose entire product *is* the polish Fin lacks. Fin's deepest value — feed reconciliation, MTM guards, neutralization — encodes *the owner's specific institutions*, which is the part that generalizes worst. Every genericizing hour is an hour not spent on CR020/CR041-class features the owner actually uses. Distribution isn't free even at $0: issue triage, "doesn't work on my Synology", CVE reports.

**The defensible exception:** if the motivation is impact/reputation/better-software-through-outside-eyes — not revenue — a scoped **Option B** release is achievable and the positioning is real; it would do well on r/selfhosted and Hacker News. Expect hundreds-to-low-thousands of users and revenue ≈ 0; accept that in writing **before** starting. Also weigh: CR027's own trajectory (invite-only multi-user for family/friends) may already capture the actual sharing intent without any public release.

## Gap analysis to "marketable" (excluding auth/tenancy)

**Hard blockers**

1. **ocr-llm gateway dependency.** AI Review/Compare call a private gateway (`LLM_GATEWAY_URL`; `ANTHROPIC_API_KEY` deliberately removed in CR034). Nobody else can run the flagship feature. Fix: **pluggable LLM provider** — OpenAI-compatible base-URL + model config (covers Ollama, LM Studio, vLLM, OpenRouter, cloud keys), ocr-llm becomes one adapter. Call surface is isolated in the aiReview service — contained work.
2. **Bank connectivity.** The private bank-feed service's upstream (fintable.io → Google Sheets) is an idiosyncratic chain no outsider will replicate. Fix: (i) position **CSV/manual as the default path** — CR036's universal column mapper + saved profiles + drift-gated reconcile is already a strong aggregator-free story; (ii) add a **SimpleFIN adapter** ($15/yr, de-facto OSS standard per Actual) inside the service's versioned `/v1` contract and publish the service; fintable stays the owner's personal adapter.
3. **Repo publishability.** Leaked key in history (KI#6), owner financial data throughout Documentation/, tracked debris. Public release = **fresh-history repo + sanitized docs**; rotate `BANK_FEED_API_KEY` first (already on the books).
4. **No LICENSE / README / outsider docs.** Everything assumes the owner's VM (hardcoded IPs, Tailscale names, pinned volume). Recommend **AGPLv3** (segment standard; deters closed-SaaS freeriding).
5. **Install/first-run.** No migration runner on existing DBs (*runner = CR027A scope; CR043 N11 recommends pulling it into v3*); no demo/onboarding (*demo dataset = CR027D scope*). V3-safe slices: single `docker compose up` quickstart with sane defaults + a seed script producing a small fictional dataset (build the generator once, reuse for CR027D).

**Significant gaps**

6. **Naming.** "Fin" is unsearchable and collides with Intercom's heavily-marketed "Fin" AI agent (which operates in fintech) — SEO death + trademark risk. Rename before any public artifact exists.
7. **De-personalization.** PS remnants (`/upload-ps`, `ingest-ps`), Fidelity-specific sweep defaults, hard-coded personal COA names (CR043 N9), owner-workflow Known Issues — become generic settings or clearly optional modules. (CR027 §5 "Data-source IA cleanup" covers part; holds for single-user too.)
8. **Security posture expectations.** Even self-hosted single-user, users expect a documented reverse-proxy/basic-auth story, rate limiting, SECURITY.md. Full auth is CR027B — point at it, and be honest in the README: "no built-in auth; bind to localhost/VPN."
9. **Support/telemetry model.** Decide up front: GitHub issues only, no SLA, opt-in anonymous version ping. Undefined support expectations are the #1 solo-maintainer burnout vector.
10. **Data portability.** pg_dump + per-report CSV/xlsx export + Quicken/CSV importers ≈ near-complete; mostly a documentation gap. FX/multi-currency is a genuine strength vs Actual; English-only UI acceptable for v1 of this niche.

## Sequenced roadmap (if the decision gate passes)

Ordered by marketability-per-effort; **no-regret** = improves the owner's own resilience even if release never happens.

| # | Move | Size | Notes |
|---|---|---|---|
| 1 | **Decision gate + rename**: commit to Option B's zero-revenue premise in writing; pick a searchable non-colliding name | days | everything downstream inherits it |
| 2 | **Pluggable LLM provider** (OpenAI-compatible endpoint config; ocr-llm as one adapter) | S–M | **no-regret** (removes private single point of failure) |
| 3 | **CSV-first connectivity story + SimpleFIN adapter; publish bank-feed service** | M | **no-regret** (SimpleFIN also de-risks fintable for the owner) |
| 4 | **Fresh-history public repo + AGPLv3 + README/quickstart + SECURITY.md**; rotate historical key first | M | release-only cost |
| 5 | **Single-user demo seed + empty-state first-run** (generator reused by CR027D; empty states = CR042 T7) | S–M | **no-regret** |
| 6 | **De-personalization/IA pass** (PS behind "migrate from", institution behaviors as settings, CR043 N9 magic accounts) | M | partially CR027 §5 scope |
| 7 | **Migration runner** (= CR043 Phase 1.1, pulled from CR027A) | M | **no-regret** |
| 8 | **Launch collateral**: 3-min scenario-compare demo video + screenshots; Show HN / r/selfhosted post centered on the forecasting engine | S | release-only cost |

## Owner decisions

1. **The gate (settled 2026-07-11): remain personal (Option A).** Moves 4/6/8 (fresh-history repo, de-personalization pass, launch collateral) are dropped; moves 2/3/5/7 (pluggable LLM, SimpleFIN, demo seed, migration runner) stay as no-regret backlog items.
2. Name/license/support model: moot unless the gate is reopened.

## Out of scope

Auth/multi-tenancy/hosted operation (CR027 B–E); pricing/monetization design (Option B assumes ≈$0); the forecast-engine-as-library extraction (Option E — revisit only if B ships and the engine draws interest).
