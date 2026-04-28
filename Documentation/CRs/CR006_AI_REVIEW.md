**Status:** COMPLETED — [Plan](../NEXT_STEPS.md#cr006)

# CR006 — AI Review of FC Plan

Conversational AI review of forecast plans with auto-apply for `update_module`, `update_incexp`, `update_scenario` action blocks. Migrated from the Anthropic API to the local `ocr-llm` gateway so personal financial detail never leaves LAN/Tailnet. Async with polling, browser notifications, and an unread indicator.

## Outcome

- Tables: `fc_ai_reviews`, `fc_ai_messages` (migration 014); `status` + `error_message` columns added later (migration 020 for async).
- Backend service: `server/src/v2/services/aiReview.js` — context builder with 6 data sources, posts to `${LLM_GATEWAY_URL}/task` (task `finance_plan_review`).
- Routes: `server/src/v2/routes/aiReview.js` — create, follow-up, list, get, delete, status, auto-apply.
- Local-only fallback chain: `ollama_heavy:qwen3.6:35b-a3b-q4_K_M → ollama_mid:qwen3:32b`.
- Async flow: POST returns 202 immediately; gateway call runs in a background worker; frontend polls `GET /:id/status` every 8s.
- Frontend: `FCAIReviewDrawer.jsx` slide-out drawer with conversation history, message bubbles, inline Apply buttons, confirmation modal, "Generating…" / "Failed" status badges, per-review delete buttons.
- Browser notifications via Web Notifications API when tab is hidden; pulsing red dot on toolbar button when a review completes with the drawer closed.
- AI System Prompt configurable in FC Settings.
- nginx `proxy_read_timeout` raised to 360s on `/api/v2/ai-review/`.
- Context restructured to prevent flow-vs-balance misreads (annual P&L flows separate from year-end MV; cash sweep activity isolated).

## Key references

- Migrations: `014_ai_reviews.sql`, `020_ai_review_async.sql`
- Service: `server/src/v2/services/aiReview.js`
- Routes: `server/src/v2/routes/aiReview.js`
- Frontend: `frontend/src/features/Forecast/FCAIReviewDrawer.jsx`
- Cross-repo coordination via `~/Programs/fin/ocr-llm/HANDOFFS.md` (Finance ↔ ocr-llm).
