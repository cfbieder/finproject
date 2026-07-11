# ocr-llm integration (local LLM gateway for AI Review)

> Moved out of `CLAUDE.md` 2026-07-11 (starter-pack adoption). The gateway is a separate
> repo/system — never modify it while working in Fin, except appending handoff entries as
> described below.

- **First-read primer:** `~/Programs/fin/ocr-llm/Documentation/Guides/AI_IMPLEMENTATION_GUIDE.md`
- **Pinned contract version:** v1
- **Base URL:** `http://100.66.213.40:8080` (Tailscale)

## Before non-trivial gateway API work

1. `(cd ~/Programs/fin/ocr-llm && git pull --ff-only)`
2. Read the tail of `~/Programs/fin/ocr-llm/HANDOFFS.md` for `[ocr-llm → Finance]` or
   `[ocr-llm → *]` entries.
3. Fetch the live spec: `curl -s http://100.66.213.40:8080/contracts/v1/gateway`.

## When Fin needs the gateway to change

Append an entry to `~/Programs/fin/ocr-llm/HANDOFFS.md`:

```
## YYYY-MM-DD [Finance → ocr-llm] subject
```

## Where it's used in Fin

AI Review (CR006) and the CR040 compare narrative: `server/src/v2/` aiReview services call
the gateway via `LLM_GATEWAY_URL` (see `.env.example`); reviews are stored in `ai_reviews`
(migrations 014/035).
