#!/usr/bin/env node
/**
 * extract-statements-llm.js — CR061 P2, the hybrid's second half.
 *
 * For the statements the deterministic parser cannot reconcile, extract the
 * holdings table with the ocr-llm gateway's `finance_statement_extract` task and
 * check the result against exactly the same gate: the statement's own printed
 * section subtotals. A model's rows are believed no more readily than a regex's.
 *
 * ⚠️ LOCAL-ONLY BY CONSTRUCTION. The task's route is
 * `ollama_heavy → ollama_mid` with no cloud step, so a holdings table — every
 * position, quantity and cost basis in a real portfolio — cannot leave the
 * Tailnet. ocr-llm verified this rather than asserting it: naming `claude` or
 * `openai` in `routing.prefer` returns 409 `routing_unsatisfiable`.
 *
 * ⚠️ `--pin-mid` moves the run to `ollama_mid` (Machine A GPU 1). Use it for the
 * BULK RUN and nowhere else: 21 tasks lead with `ollama_heavy`, Ollama serialises
 * per model, and a 50-row statement can hold that tier ~180s — long enough to
 * blow the 85s chain deadline on health's `year_in_review_narration`, whose
 * Claude fallback is then skipped as unaffordable so it fails rather than
 * degrades. ocr-llm also warned their throughput canary cannot see this: it
 * computes tok/s from Ollama's `eval_duration`, which excludes queue wait, so a
 * saturated tier still reports healthy.
 *
 * ⚠️ Extraction was validated by ocr-llm on HEAVY, not on mid. Their advice, and
 * this script's default posture: run a few statements pinned to mid and compare
 * the tie rate before committing the whole corpus. `--sample N` does that.
 *
 * Requests are sequential on purpose — parallel calls queue inside Ollama
 * anyway, so concurrency buys nothing and only widens the window.
 *
 * READ-ONLY. Prints; writes nothing. Feeding the results into fin is the
 * ingest's job (Scripts/ingest-statement-positions.js).
 *
 * Usage:
 *   node Scripts/extract-statements-llm.js --sample 3 --pin-mid
 *   node Scripts/extract-statements-llm.js --pin-mid            # all failing
 */

const path = require('node:path');
const fs = require('node:fs');

for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const { extractText, parseFile } = require('../server/src/v2/scripts/parse-fidelity-holdings');

const BASE = (process.env.LLM_GATEWAY_URL || 'http://192.168.1.61:8080').replace(/\/+$/, '');
const KEY = process.env.OCR_LLM_CLIENT_KEY;
const args = process.argv.slice(2);
const PIN_MID = args.includes('--pin-mid');
const SAMPLE = (() => { const i = args.indexOf('--sample'); return i >= 0 ? parseInt(args[i + 1], 10) : 0; })();
const files = args.filter((a) => !a.startsWith('--') && a.endsWith('.pdf'));

const INSTRUCTION = [
  'Extract the holdings table from this Fidelity account statement.',
  'Return every position exactly as printed — do not compute, round or infer any value.',
  'Do NOT emit section subtotal lines or the account total as positions.',
  'Use the section heading exactly as it appears (e.g. "Common Stock", "Equity ETPs", "Core Account").',
  'A figure the statement declines to state ("not applicable", "unavailable", "-") is null, never 0.',
].join(' ');

async function extractOne(text, timeoutMs = 240000) {
  const body = {
    task: 'finance_statement_extract',
    prompt: `${INSTRUCTION}\n\n${text}`,
  };
  // BACKFILL ONLY — see the header. Omitted for any normal call.
  if (PIN_MID) body.routing = { provider: 'ollama_mid' };

  // An explicit timeout, because node's fetch has none: the first run reported
  // a bare `fetch failed` after ~300s with nothing to act on.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${BASE}/task`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Id': 'finance',
        'X-Client-Key': KEY,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    throw new Error(err.name === 'AbortError' ? `timed out after ${timeoutMs / 1000}s` : `transport: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 413) throw new Error('prompt_too_long — split per section');
  if (!res.ok) throw new Error(`gateway ${res.status}: ${(await res.text()).slice(0, 160)}`);

  const { response, routing } = await res.json();
  // ocr-llm: a violation still returns 200 with the best-effort body, flagged.
  // Treating it as a refusal is the whole reason this is safe to run at all.
  const violated = (routing?.degradations || []).some((d) => String(d).startsWith('schema_violation'));
  if (violated) throw new Error('schema_violation — refused');

  // `response` is a JSON *string*, not an object.
  const parsed = JSON.parse(response);
  return { positions: parsed.positions || [], routing };
}

/**
 * The same gate the deterministic parser answers to: rows must sum to the
 * subtotal the statement itself printed for their section.
 */
function checkAgainstPrinted(positions, checks) {
  const bySection = new Map();
  for (const p of positions) {
    const k = String(p.section || '').trim();
    bySection.set(k, (bySection.get(k) || 0) + (Number(p.market_value) || 0));
  }
  return checks.map((c) => {
    const sum = bySection.get(c.section) ?? 0;
    return {
      section: c.section,
      printed: c.printed,
      parsed: Number(sum.toFixed(2)),
      delta: Number((sum - c.printed).toFixed(2)),
      ok: Math.abs(sum - c.printed) < 0.02,
    };
  });
}

async function main() {
  if (!KEY) throw new Error('OCR_LLM_CLIENT_KEY is not set');

  let targets = files;
  if (!targets.length) {
    // Default target set: exactly the statements the parser cannot reconcile.
    const dir = path.join(__dirname, '..', 'Samples', 'Fidelity');
    targets = [];
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.pdf'))) {
      const full = path.join('Samples', 'Fidelity', f);
      try {
        const r = parseFile(full);
        if (r.accounts.some((a) => !a.reconciles)) targets.push(full);
      } catch { targets.push(full); }
    }
  }
  if (SAMPLE) targets = targets.slice(0, SAMPLE);

  console.log(`${targets.length} statement(s) · tier: ${PIN_MID ? 'ollama_mid (PINNED — bulk run)' : 'task default (ollama_heavy first)'}\n`);

  let tiedSections = 0;
  let totalSections = 0;
  let refused = 0;
  const t0 = Date.now();

  for (const f of targets) {
    const label = path.basename(f);
    let det;
    try { det = parseFile(f); } catch (e) { console.log(`${label.padEnd(18)} 🔴 parse: ${e.message}`); continue; }

    for (const acct of det.accounts) {
      if (acct.reconciles) continue;   // the parser already has this one
      // Send THIS ACCOUNT'S holdings pages, not the whole document. A statement
      // is ~52k characters of which the tables are a fraction; the rest is
      // activity, summaries and disclosures. ocr-llm's own advice for an
      // oversized prompt is to split, and the gate is already per-section.
      const text = acct.holdings_text || extractText(f);
      let out;
      const started = Date.now();
      try {
        out = await extractOne(text);
      } catch (e) {
        refused += 1;
        console.log(`${label.padEnd(18)} ${acct.account_number}  🔴 ${e.message}`);
        continue;
      }
      const secs = checkAgainstPrinted(out.positions, acct.checks);
      const ok = secs.filter((s) => s.ok).length;
      tiedSections += ok;
      totalSections += secs.length;
      const step = out.routing?.attempts?.[0];
      console.log(`${label.padEnd(18)} ${acct.account_number}  ${String(out.positions.length).padStart(3)} positions  `
        + `${ok}/${secs.length} sections tie  ${((Date.now() - started) / 1000).toFixed(1)}s  `
        + `${step ? `${step.provider}:${step.model}` : ''} ${out.routing?.schema_level || ''}`);
      for (const s of secs.filter((x) => !x.ok)) {
        console.log(`      🔴 ${s.section.padEnd(26)} printed ${String(s.printed).padStart(13)}  llm ${String(s.parsed).padStart(13)}  Δ ${s.delta}`);
      }
    }
  }

  console.log(`\nsections tied: ${tiedSections}/${totalSections}`
    + (totalSections ? ` (${(100 * tiedSections / totalSections).toFixed(0)}%)` : '')
    + ` · refusals: ${refused} · ${((Date.now() - t0) / 1000).toFixed(0)}s total`);
  if (SAMPLE) {
    console.log('\nSample run. ocr-llm validated extraction on HEAVY, not mid — compare this tie rate');
    console.log('against a heavy run before committing the corpus to a pinned tier.');
  }
}

main().catch((e) => { console.error(e.message); process.exit(2); });
