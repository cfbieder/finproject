'use strict';
/**
 * netWorthNarration.js — CR092 P1. Prose over the net-worth bridge.
 *
 * NARRATION-ONLY, and that is the whole design. `netWorthBridge.js` computes
 * every figure exactly — the live 12-month window ties to 1.2e-10 — so the
 * model is handed finished arithmetic and asked for English. It never
 * calculates, and the page renders the exact figures directly beside its prose,
 * which is what makes a drift visible instead of plausible.
 *
 * Routed through the ocr-llm gateway (POST /task, task=finance_networth_narration).
 * The chain is LOCAL-ONLY by construction on their side — `ollama_heavy` →
 * `ollama_mid`, with no cloud provider declared, so there is no cloud step to
 * reach even if a caller asked for one. That fence is the reason this task
 * exists rather than reusing an existing narration task: the prompt is the
 * owner's balance sheet by named account, which is strictly more revealing than
 * the holdings table already fenced for `finance_statement_extract`.
 *
 * The five guardrails (GIVEN figures only, no invented causes, offsetting
 * drivers are not losses, no percentages, no advice) are enforced SERVER-SIDE
 * by ocr-llm and are deliberately NOT restated here — a second copy in this
 * prompt would drift from theirs the first time either side edited one.
 * See docs/guides/ocr-llm-integration.md and their 2026-09-05 handoff.
 *
 * This is an ENHANCEMENT, never a dependency: every failure path returns null
 * and the caller keeps `data.summary`, the deterministic lead that ships in the
 * bridge payload itself.
 */

const GATEWAY_TASK = 'finance_networth_narration';

// Measured 2026-09-05 against the live gateway with the owner's real figures:
// heavy 7.1-16.4 s over five probes, mid 10.5-10.6 s over two, both at
// fallback_depth 0 — so ~27 s is the OBSERVED worst-case chain, not a scaled
// one. 120 s bounds it with a wide margin.
//
// This number is a CONTRACT TERM, not a local constant, which is why it was
// sent to ocr-llm rather than just chosen. The layering only works one way
// round, and each bound must be looser than the one it wraps:
//
//     chain ~27 s  <  their deadline_ms 90 s  <  this abort 120 s  <  browser 150 s
//
// ⚠️ This abort does NOT free the GPU, and that is why their deadline matters
// more than ours. ocr-llm measured on 2026-09-04 that uvicorn does not cancel a
// handler on client disconnect, so an abandoned request keeps its tier pinned
// until THEIR deadline fires. The abort bounds what the owner waits for; only
// `deadline_ms` bounds what the tier holds. They registered 90 000 on
// 2026-09-05 (their handoff), replacing the 600 s global default that was the
// only bound before it.
//
// ⚠️ We cannot verify that 90 000 from here — neither `GET /task/routes` nor
// `TASK_CATALOG.md` exposes a deadline for ANY task, so the assurance is a
// sentence in `HANDOFFS.md`. Filed with them as its own thread
// (`finance-deadline-not-introspectable`). If this constant is ever changed,
// re-read that thread first: raising it above their deadline is harmless, but
// lowering their deadline below the chain would silently delete the fallback
// step.
const ABORT_MS = 120_000;

// Grouped, because the model echoes the format it is handed and the page prints
// $96,705 two inches below the prose. An unseparated 96705.06 in the sentence
// looked like a different, more technical claim about the same figure — the
// same reason `buildSummary` writes its dates out in words.
const num = (n) =>
  Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * The facts, as text. `context` is validated and rendered by the gateway, but
 * the prose the model narrates from is the PROMPT — their caller note — so
 * every figure is inlined here as well as carried structurally.
 *
 * Only `change` and `drivers` (with their contributors) are sent. `periods` and
 * `movers` are declared optional by the task and are deliberately withheld:
 * they would multiply the token count for a 120–150 word answer, and the tables
 * beneath the prose already carry that detail. What is narrated is what sits
 * immediately beside it.
 */
function buildPrompt(data) {
  // 🔴 The direction is stated, and the drivers are ORDERED by it. Neither
  // fact is spelled out per-driver, and that is the point.
  //
  // Two defects, one after the other, both found by rendering:
  //
  //  1. Without any direction, the prose opened "Net worth decreased by
  //     96,705.06 USD" and then led with "Money earned increased net worth by
  //     368,590.90 USD" — accurate, and the wrong story, because drivers arrive
  //     ordered by ABSOLUTE size and the largest one on a YTD window moved the
  //     other way. This is the same defect `buildSummary` already paid for.
  //
  //  2. The obvious fix — tagging each line "(with the change)" /
  //     "(against the change)" — was worse. The model reported the TAGS back as
  //     the notes themselves: the modal rendered "Money spent — with the
  //     change" and "Money earned — against the change", six lines carrying no
  //     figure and no information. Vocabulary handed to a narrator is
  //     vocabulary it will narrate.
  //
  // So the ordering carries it instead. Drivers that moved WITH the change come
  // first, largest first; those that moved against it follow; offsetting
  // drivers — which went both ways and caused neither — come last. The model
  // narrates in the order it is given, and there is nothing new to echo.
  const fell = data.change < 0;
  const rank = (d) => {
    if (d.offsetting) return 2;
    return Math.sign(d.amount) === Math.sign(data.change) ? 0 : 1;
  };
  const ordered = [...data.drivers].sort(
    (a, b) => rank(a) - rank(b) || Math.abs(b.amount) - Math.abs(a.amount)
  );

  const lines = [
    'Narrate this net-worth bridge. Every figure below is exact and is displayed beside your text.',
    '',
    `Net worth ${fell ? 'FELL' : 'ROSE'} by ${num(Math.abs(data.change))} USD between ` +
      `${data.from.date} and ${data.to.date}.`,
    '',
    'DRIVERS, in the order they should be discussed — the ones that moved net worth ' +
      `${fell ? 'down' : 'up'} come first:`,
  ];

  for (const d of ordered) {
    let line = `- ${d.label}: ${num(d.amount)} USD.`;
    // Stated in words as well as in the `offsetting` flag. This is the single
    // most misreadable line on the page: transfers net to -23,621 out of
    // 1,746,678 of gross movement, and both "you lost $23,621" and "you moved
    // $1.7M" are wrong readings of it.
    if (d.offsetting) {
      line += ` This driver is OFFSETTING: ${num(d.gross)} USD of gross movement that cancelled out.`;
    }
    if (d.contributors && d.contributors.length) {
      const items = d.contributors.map((c) => `${c.label} ${num(c.amount)} USD`).join('; ');
      line += ` Largest items: ${items}.`;
    }
    lines.push(line);
  }

  return lines.join('\n');
}

/** The structural twin of the prompt — the same facts, validated by the task. */
function buildContext(data) {
  return {
    change: data.change,
    from: data.from.date,
    to: data.to.date,
    drivers: data.drivers.map((d) => ({
      key: d.key,
      label: d.label,
      amount: d.amount,
      ...(d.offsetting ? { offsetting: true, gross: d.gross } : {}),
      contributors: (d.contributors || []).map((c) => ({ label: c.label, amount: c.amount })),
    })),
  };
}

/**
 * Shape-check what came back. The task is schema-enforced, but `schema_level`
 * can degrade to a shape that came from the prompt alone — ocr-llm's own
 * instruction is to validate defensively rather than trust the declaration —
 * and a half-formed object rendered as prose is worse than no prose.
 */
function parseNarration(raw) {
  let body = raw;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return null;
    }
  }
  if (!body || typeof body !== 'object') return null;

  const headline = typeof body.headline === 'string' ? body.headline.trim() : '';
  if (!headline) return null;

  // A note must carry a FIGURE. This narration's whole job is to speak the
  // numbers the table shows, so a note with no digit in it is not a short
  // explanation — it is the model reporting something other than the data.
  //
  // 🔴 The run this exists for: an earlier prompt tagged each driver
  // "(with the change)" / "(against the change)" to fix the leading-driver
  // order, and the model returned those tags AS the notes — the modal rendered
  // six lines reading "Money spent — with the change". The prompt no longer
  // hands over that vocabulary, and this is the second lock: any future phrase
  // that leaks the same way is dropped rather than rendered.
  const why = (Array.isArray(body.why) ? body.why : [])
    .filter((w) => w && typeof w.note === 'string' && w.note.trim() && /\d/.test(w.note))
    .map((w) => ({
      driver: typeof w.driver === 'string' ? w.driver.trim() : '',
      note: w.note.trim(),
    }));
  if (!why.length) return null;

  // De-duplicated against `why`: a watch-out that restates a driver is not a
  // watch-out, and rendering the same sentence twice is worse than not
  // rendering it at all.
  //
  // 🔴 Found by RENDERING the report, not by a test: on the live YTD window
  // every `watch_outs` entry was a verbatim copy of a `why` note, so the page
  // printed the same six sentences twice — once as prose and again as a bullet
  // list headed like a caution. Measured, not suspected: 2/2 exact matches on
  // one run, 6/6 on another.
  //
  // ✅ ocr-llm FIXED IT AT THE PREFIX the same day (their rule 6, 2026-09-05):
  // `why` explains a driver that moved, `watch_outs` flags something a reader
  // could misread, and an empty array is correct where a duplicate is not.
  // Re-verified against the raw gateway, bypassing this parser — 3 runs, 0
  // verbatim duplicates, and the watch-out now carries the contributor that
  // exceeds its own driver, which is the most misreadable fact on the page.
  //
  // This stays anyway, as defence in depth rather than distrust: their fix is a
  // PROMPT rule and so probabilistic, this is a structural check that one
  // response field is not a copy of another. The two fail independently and
  // this one costs four lines.
  const notes = new Set(why.map((w) => w.note.toLowerCase()));
  const watchOuts = (Array.isArray(body.watch_outs) ? body.watch_outs : [])
    .filter((s) => typeof s === 'string' && s.trim())
    .map((s) => s.trim())
    .filter((s) => !notes.has(s.toLowerCase()));

  return { headline, why, watchOuts };
}

/**
 * Narrate a built bridge payload. Returns `{ narration, meta }`; `narration` is
 * null whenever the prose could not be trusted, and the caller falls back to
 * `data.summary`. Never throws for a gateway failure — a missing narration is
 * not a failed report.
 */
async function narrateNetWorthBridge(data, { meta: bridgeMeta } = {}) {
  // Nothing to narrate, and two of these are correctness guards rather than
  // conveniences:
  //  - `tieOk === false` means the drivers do NOT reconstruct the change. The
  //    page already says so in a warning; prose asserting the same figures as
  //    an explanation would contradict that warning in the reader's favour.
  //  - an EMPTY `drivers` array is rejected by the task as `missing_required_context`
  //    (measured 2026-09-05 — the check is truthiness, not presence), so a flat
  //    window would spend a round trip to earn a 422.
  if (!data || !Array.isArray(data.drivers) || !data.drivers.length) {
    return { narration: null, meta: { available: false, reason: 'no-drivers' } };
  }
  if (bridgeMeta && bridgeMeta.tieOk === false) {
    return { narration: null, meta: { available: false, reason: 'tie-failed' } };
  }

  const gatewayUrl = process.env.LLM_GATEWAY_URL || 'http://192.168.1.61:8080';

  // The pair or nothing — an id sent without a matching key is discarded, and
  // `CLIENT_AUTH_MODE=enforce` has been live since 2026-08-31. Fail on the
  // configuration here rather than reading a 401 back as "narration
  // unavailable", which would hide a missing compose mapping forever.
  const clientKey = (process.env.OCR_LLM_CLIENT_KEY || '').trim();
  if (!clientKey) {
    console.warn(
      '[nw-narration] OCR_LLM_CLIENT_KEY is not set, so the ocr-llm gateway would reject this ' +
      'with 401 client_unidentified. Set it in .env AND map it in this stack\'s compose ' +
      '`environment:` block — a value in .env alone never reaches the container.'
    );
    return { narration: null, meta: { available: false, reason: 'not-configured' } };
  }

  const started = Date.now();
  try {
    const response = await fetch(`${gatewayUrl}/task`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Id': 'finance',
        'X-Client-Key': clientKey,
      },
      body: JSON.stringify({
        task: GATEWAY_TASK,
        prompt: buildPrompt(data),
        context: buildContext(data),
      }),
      signal: AbortSignal.timeout(ABORT_MS),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.error(`[nw-narration] gateway ${response.status}: ${errText.slice(0, 500)}`);
      return {
        narration: null,
        meta: { available: false, reason: `gateway-${response.status}` },
      };
    }

    const payload = await response.json();
    const routing = payload.routing || {};
    const degradations = routing.degradations || [];
    console.log(
      `[nw-narration] served by ${payload.provider || '?'}:${payload.model || '?'} ` +
      `depth=${routing.fallback_depth ?? '?'} schema=${routing.schema_level ?? 'none'} ` +
      `latency=${payload.usage?.provider_latency_ms ?? '?'}ms ` +
      `degradations=${degradations.length ? degradations.join(',') : 'none'}`
    );

    // `schema_violation` means nothing in the chain produced conforming output.
    // Dropped rather than rendered: this is the one degradation ocr-llm asks
    // callers to alert on, and the deterministic summary is right there.
    if (degradations.includes('schema_violation')) {
      console.error('[nw-narration] gateway reported schema_violation — dropping to the deterministic summary');
      return { narration: null, meta: { available: false, reason: 'schema-violation' } };
    }

    const narration = parseNarration(payload.response);
    if (!narration) {
      console.error('[nw-narration] response did not parse into a usable narration — dropping');
      return { narration: null, meta: { available: false, reason: 'unparseable' } };
    }

    return {
      // The disclaimer is the GATEWAY's, echoed rather than reworded here. It
      // is registry config on their side ("Informational only — not financial
      // advice."), so a copy in this repo would be the version that goes stale.
      narration: { ...narration, disclaimer: payload.disclaimer || null },
      meta: {
        available: true,
        provider: payload.provider || null,
        model: payload.model || null,
        schemaLevel: routing.schema_level ?? null,
        fallbackDepth: routing.fallback_depth ?? null,
        elapsedMs: Date.now() - started,
      },
    };
  } catch (error) {
    const timedOut = error.name === 'TimeoutError' || error.name === 'AbortError';
    console.error(`[nw-narration] ${timedOut ? `timed out after ${ABORT_MS}ms` : 'failed'}: ${error.message}`);
    return {
      narration: null,
      meta: { available: false, reason: timedOut ? 'timeout' : 'gateway-unreachable' },
    };
  }
}

module.exports = {
  narrateNetWorthBridge,
  // Pure, and exported for their own tests: the prompt is the contract with a
  // service this repo cannot run in CI, and the parser is the only thing
  // standing between a degraded response and rendered prose.
  buildPrompt,
  buildContext,
  parseNarration,
  GATEWAY_TASK,
  ABORT_MS,
};
