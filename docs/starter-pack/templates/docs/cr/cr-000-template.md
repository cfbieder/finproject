# CR-NNN — <title>

> Copy to `cr-NNN-<topic>.md`; add the index row in [README](README.md) (status lives
> there, not in this filename). A CR captures motivation, scope, decisions, and outcome —
> enough that a future session can reconstruct *why*, not just *what*.

**Status:** proposed · **Created:** YYYY-MM-DD · **Depends on:** <CRs / none>

## Motivation
<what problem this solves and why now — link brief/roadmap/issue>

## Scope
**In:** <bullets> · **Out:** <explicit non-goals for this CR>

## Design & decisions
<the substance. For each significant decision: options considered, choice, rationale —
/question session outputs land here. Schema changes list their migrations; flags list
their names and the dormant-OFF guarantee.>

## Impact checklist
- [ ] Migrations → cross-env matrix updated
- [ ] New scheduled job → job registry (+ how success is observed)
- [ ] New secret → secrets inventory + `.env.example` + fail-loud in compose
- [ ] New service/DB/host → monitoring rosters (observability baseline)
- [ ] Tests: tier-2 for money/data/auth logic in this CR; guards extended if a new
      mechanically-checkable convention emerged
- [ ] Docs: status / project-description / roadmap touched as needed

## Outcome
<filled at shipping: what actually landed, deviations from the design, follow-ups spawned.
Ship date/version go in the INDEX, not here.>
