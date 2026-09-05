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
 * `openai` in the request's `routing` block returns 409 `routing_unsatisfiable`.
 *
 * ⚠️ `--pin-mid` is now a BULK-RUN-ONLY escape hatch, and there is no bulk run.
 * ocr-llm asked for the pin when this was 56 documents — 21 tasks lead with
 * `ollama_heavy`, Ollama serialises per model, and a 50-row statement can hold
 * that tier ~180s, long enough to blow the 85s chain deadline on health's
 * `year_in_review_narration` (whose Claude fallback is then skipped as
 * unaffordable, so it fails rather than degrades). At the real volume — ~4
 * documents a quarter — four calls queue nobody, and they RETRACTED the pin on
 * 2026-09-04 after measuring it on identical input:
 *
 *     ollama_heavy (default)   17.0s   37.9 tok/s   subtotals tie 3/3
 *     ollama_mid   (--pin-mid) 28.4s   20.2 tok/s   subtotals tie 3/3
 *
 * Heavy is 1.7× faster, the gap widens with prompt length (93.9s on a 9.7k-char
 * prompt), and heavy is the path they validated before shipping. Quality was
 * never the difference. So: TAKE THE DEFAULT. Put the pin back only for a
 * genuine bulk run, and remember their throughput canary cannot see contention —
 * it computes tok/s from Ollama's `eval_duration`, which excludes queue wait, so
 * a saturated tier still reports healthy.
 *
 * `--sample N` remains the way to compare tiers on a few statements first.
 *
 * Requests are sequential on purpose — parallel calls queue inside Ollama
 * anyway, so concurrency buys nothing and only widens the window.
 *
 * READ-ONLY. Prints; writes nothing. Feeding the results into fin is the
 * ingest's job (Scripts/ingest-statement-positions.js).
 *
 * Usage:
 *   node Scripts/extract-statements-llm.js --sample 3
 *   node Scripts/extract-statements-llm.js                      # all failing
 *   node Scripts/extract-statements-llm.js --pin-mid            # bulk run only
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
const EMIT = (() => { const i = args.indexOf('--emit'); return i >= 0 ? args[i + 1] : null; })();

/**
 * ⚠️ The section vocabulary is DICTATED, not requested.
 *
 * Asked to "use the section heading exactly as it appears", the model instead
 * used the generic names for them: `Stock Funds` came back as `Mutual Funds`,
 * `Common Stock` as `Stocks`, and `Equity ETPs` + `Fixed Income ETPs` were
 * merged under their own aggregate heading `Exchange Traded Products`. Every sum
 * was exact to the cent — the rows were right and only the labels moved — but
 * the gate looks sections up BY NAME, so each one read 0 against its printed
 * subtotal and reported the whole subtotal as missing. 8 of 24 sections "failed"
 * without a single wrong figure.
 *
 * Passing the statement's actual headings is not leading the answer: it supplies
 * the vocabulary, never a value, so the arithmetic check stays independent.
 * Matching the model's labels to ours BY VALUE would have been the cheating fix —
 * it chooses whichever mapping makes the totals tie, and a gate that fits itself
 * to the answer proves nothing.
 */
function instructionFor(checks) {
  const names = checks.map((c) => c.section);
  return [
    'Extract the holdings table from this Fidelity account statement.',
    'Return every position exactly as printed — do not compute, round or infer any value.',
    'Do NOT emit section subtotal lines or the account total as positions.',
    `Every position MUST carry one of these EXACT section values: ${names.map((n) => `"${n}"`).join(', ')}.`,
    'Use them verbatim. Do not substitute a synonym, do not merge two of them under a broader heading,',
    'and do not invent a section outside this list.',
    'A figure the statement declines to state ("not applicable", "unavailable", "-") is null, never 0.',
  ].join(' ');
}

// The client abort must sit ABOVE any server-side deadline, not below it, or it
// wins the race and a typed `504 deadline_exceeded` never arrives — the caller
// is left inferring a hang from a bare `fetch failed`, which is the failure this
// timeout was added for in the first place. 240s was a guess and it was too low
// twice over: it is beneath the worst-case heavy→mid chain on the largest block
// in the corpus (17,622 chars ⇒ heavy ~100s + mid ~170s), so it would abort a
// slow-but-working statement, and it would pre-empt the 420s deadline offered to
// ocr-llm on 2026-09-04. 480s clears both and stays under their 600s default.
async function extractOne(text, checks, timeoutMs = 480000) {
  const body = {
    task: 'finance_statement_extract',
    prompt: `${instructionFor(checks)}\n\n${text}`,
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
  /**
   * ⚠️ An AGGREGATE section is not a section anyone should emit rows for.
   *
   * FA_2025_12 prints `Corporate Bonds` 309,149.26 and then `Bonds` 309,149.26 —
   * the second is a heading TOTALLING the first, not a second holding of the same
   * money. The deterministic parser already knows this and removes such a section
   * when its printed total equals the sum of a suffix of the leaves just parsed;
   * it kept this one only because its OWN read of Corporate Bonds came to
   * 4,266.62, so nothing summed. The model read that section correctly, and was
   * then marked down for not also filing the same $309,149.26 a second time
   * under the aggregate.
   *
   * Same structural rule, same gate: a check whose printed total equals the sum
   * of a suffix of the checks before it is a heading, and is excluded rather
   * than failed. Determined from the PRINTED totals alone, so it does not depend
   * on what any extractor returned.
   */
  const isAggregate = checks.map((c, i) => {
    for (let k = 1; k <= i; k += 1) {
      const tail = checks.slice(i - k, i).reduce((a, b) => a + b.printed, 0);
      if (Math.abs(tail - c.printed) < 0.02) return true;
    }
    return false;
  });

  const rows = checks.map((c, i) => {
    const sum = bySection.get(c.section) ?? 0;
    if (isAggregate[i] && !bySection.has(c.section)) {
      return { section: c.section, printed: c.printed, parsed: null, delta: 0, ok: true, aggregate: true };
    }
    return {
      section: c.section,
      printed: c.printed,
      parsed: Number(sum.toFixed(2)),
      delta: Number((sum - c.printed).toFixed(2)),
      ok: Math.abs(sum - c.printed) < 0.02,
      // ⚠️ A section the model never used is NOT a section it got wrong. Both
      // read `0` against the printed subtotal, and the delta is then the whole
      // subtotal — a number that looks exactly like "the model dropped $159,651"
      // when the rows may be present under a different label. Distinguish them,
      // or this reports a fabricated loss the same way a dropped
      // Loaned/Collateralized section once reported a fabricated +$74,895 drift.
      absent: !bySection.has(c.section),
    };
  });
  // Labels the model emitted that no check asked about — the other half of a
  // mismatch, and the only way to tell a rename from a genuine omission.
  const expected = new Set(checks.map((c) => c.section));
  const unmatched = [...bySection.entries()]
    .filter(([k]) => !expected.has(k))
    .map(([section, sum]) => ({ section, sum: Number(sum.toFixed(2)) }))
    .sort((a, b) => b.sum - a.sum);
  return { rows, unmatched };
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

  const emitted = [];
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
        out = await extractOne(text, acct.checks);
      } catch (e) {
        refused += 1;
        console.log(`${label.padEnd(18)} ${acct.account_number}  🔴 ${e.message}`);
        continue;
      }
      const { rows: secs, unmatched } = checkAgainstPrinted(out.positions, acct.checks);
      const ok = secs.filter((s) => s.ok).length;
      const step = out.routing?.attempts?.[0];
      if (EMIT && ok === secs.length) {
        // ⚠️ The snapshot total is the sum of the statement's own PRINTED leaf
        // subtotals, not of the model's rows. They are equal here — every leaf
        // tied, which is the condition for emitting at all — but taking the
        // custodian's arithmetic keeps the stored total independent of the
        // extractor that produced the rows. Aggregates are excluded or the money
        // under them is counted twice.
        const total = secs.filter((x) => !x.aggregate).reduce((a, b) => a + b.printed, 0);
        const rowSum = out.positions.reduce((a, b) => a + (Number(b.market_value) || 0), 0);
        if (Math.abs(rowSum - total) >= 0.02) {
          console.log(`      🔴 refusing to emit: rows sum ${rowSum.toFixed(2)} vs printed leaves ${total.toFixed(2)}`);
        } else {
          emitted.push({
            file: label,
            account_number: acct.account_number,
            as_of: acct.as_of,
            total_market_value: Number(total.toFixed(2)),
            positions: out.positions,
            extractor: {
              provider: step?.provider ?? null,
              model: step?.model ?? null,
              schema_level: out.routing?.schema_level ?? null,
              sections_tied: `${ok}/${secs.length}`,
              extracted_at: new Date().toISOString(),
            },
          });
        }
      }
      tiedSections += ok;
      totalSections += secs.length;
      const aggs = secs.filter((x) => x.aggregate).length;
      console.log(`${label.padEnd(18)} ${acct.account_number}  ${String(out.positions.length).padStart(3)} positions  `
        + `${ok}/${secs.length} sections tie${aggs ? ` (${aggs} aggregate)` : ''}  ${((Date.now() - started) / 1000).toFixed(1)}s  `
        + `${step ? `${step.provider}:${step.model}` : ''} ${out.routing?.schema_level || ''}`);
      for (const s of secs.filter((x) => !x.ok)) {
        console.log(`      ${s.absent ? '❔' : '🔴'} ${s.section.padEnd(26)} printed ${String(s.printed).padStart(13)}`
          + `  llm ${String(s.absent ? 'NO SUCH SECTION' : s.parsed).padStart(15)}`
          + (s.absent ? '' : `  Δ ${s.delta}`));
      }
      if (unmatched.length) {
        console.log(`      ↳ labels the model used that no check expects:`);
        for (const u of unmatched) console.log(`         ${u.section.padEnd(30)} ${String(u.sum).padStart(13)}`);
      }
    }
  }

  console.log(`\nsections tied: ${tiedSections}/${totalSections}`
    + (totalSections ? ` (${(100 * tiedSections / totalSections).toFixed(0)}%)` : '')
    + ` · refusals: ${refused} · ${((Date.now() - t0) / 1000).toFixed(0)}s total`);
  if (EMIT) {
    fs.writeFileSync(EMIT, `${JSON.stringify(emitted, null, 2)}\n`);
    const n = emitted.reduce((a, e) => a + e.positions.length, 0);
    console.log(`\nwrote ${emitted.length} account-statement(s) / ${n} positions to ${EMIT}`);
    console.log('Only account-statements whose EVERY section tied are emitted — the gate is the');
    console.log('condition for writing, not a note attached afterwards.');
  }
  if (SAMPLE) {
    console.log('\nSample run. ocr-llm validated extraction on HEAVY, not mid — compare this tie rate');
    console.log('against a heavy run before committing the corpus to a pinned tier.');
  }
}

main().catch((e) => { console.error(e.message); process.exit(2); });
