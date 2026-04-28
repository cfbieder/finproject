/**
 * AI Review Service — Gathers forecast context and calls the local LLM gateway
 *
 * Builds structured text from all 6 data sources:
 * 1. Scenario metadata (periods, tax rate, sweep band)
 * 2. FC Review table data (entries by year)
 * 3. BS Modules (assets, liabilities with growth/yield/disposal)
 * 4. Income/Expense items
 * 5. FX assumptions
 * 6. Base year actuals
 *
 * Routes through the ocr-llm gateway (POST /task, task=finance_plan_review).
 * Local-only fallback chain: ollama_heavy:qwen3.6:35b → ollama_mid:qwen3:32b.
 * No public-cloud LLM in the path — financial detail stays on LAN/Tailnet.
 */

const db = require("../db");
const forecastRepo = require("../repositories").forecast;
const psdataRepo = require("../repositories").psdata;

const DEFAULT_SYSTEM_PROMPT = `You are an experienced financial advisor reviewing a long-term retirement financial plan. The user's goal is to have sufficient funds so that they and their spouse can maintain a similar standard of living until they pass away, with minimal savings remaining at end of life.

Review the plan and provide structured feedback:

## Strong Points
What aspects of the plan are well-structured

## Concerns
Issues that could threaten the plan's viability

## Recommendations
Specific, actionable changes to improve the plan

## Key Risks
External risks the plan doesn't adequately address

## Questions
Clarifying questions you need answered to refine your advice

When you recommend specific numeric changes to the plan, include machine-readable action blocks so the user can auto-apply them. Format each as a JSON block on its own line, wrapped in triple backticks with the language tag "action":

\`\`\`action
{"type": "update_module", "module_id": 5, "field": "growth_rate", "current_value": 7, "proposed_value": 5, "reason": "Conservative growth assumption for retirement planning"}
\`\`\`

Supported action types and fields:
- update_module: growth_rate, income_amount, expense_amount, tax_rate_override
- update_incexp: base_value, growth_rate
- update_scenario: cash_sweep_low, cash_sweep_high

Always include current_value and proposed_value so the user can see the before/after.`;

/**
 * Gathers all forecast context for a scenario and formats as structured text
 */
async function buildForecastContext(scenarioName) {
  // 1. Scenario metadata
  const scenarioResult = await db.query(
    "SELECT * FROM forecast_scenarios WHERE name = $1",
    [scenarioName]
  );
  const scenario = scenarioResult.rows[0];
  if (!scenario) throw new Error(`Scenario "${scenarioName}" not found`);

  // Load assumptions
  const { loadScenarioConfig } = require("../../services/forecast/fcbuilder-setup");
  let config;
  try {
    config = loadScenarioConfig(scenarioName);
  } catch (e) {
    config = null;
  }

  // 2. Modules with nested data
  const modules = await forecastRepo.findModulesByScenario(scenario.id);
  for (const mod of modules) {
    const [incomePct, investments, disposals] = await Promise.all([
      db.query("SELECT * FROM forecast_module_income_pct WHERE module_id = $1 ORDER BY effective_date", [mod.id]),
      db.query("SELECT * FROM forecast_module_investments WHERE module_id = $1 ORDER BY investment_date", [mod.id]),
      db.query("SELECT * FROM forecast_module_disposals WHERE module_id = $1 ORDER BY disposal_date", [mod.id]),
    ]);
    mod.income_pct = incomePct.rows;
    mod.investments = investments.rows;
    mod.disposals = disposals.rows;
  }

  // 3. Income/Expense items
  const incexp = await forecastRepo.findIncExpByScenario(scenario.id);

  // 4. Forecast entries (generated output)
  const entriesResult = await db.query(`
    SELECT forecast_year, account, SUM(amount)::numeric as amount
    FROM forecast_entries
    WHERE scenario_id = $1
    GROUP BY forecast_year, account
    ORDER BY forecast_year, account
  `, [scenario.id]);

  // 5. Base year values
  const baseYearResult = await db.query(`
    SELECT exp_line.name as fc_line, 'expense' as type,
      SUM(CASE WHEN a.account_type = 'liability' THEN -m.expense_amount ELSE 0 END) as amount
    FROM forecast_modules m
    LEFT JOIN accounts a ON m.account_id = a.id
    LEFT JOIN fc_lines exp_line ON m.expense_fc_line_id = exp_line.id
    WHERE m.scenario_id = $1 AND COALESCE(m.setup_status, 'new') NOT IN ('new', 'exclude')
      AND m.expense_fc_line_id IS NOT NULL
    GROUP BY exp_line.name
    UNION ALL
    SELECT inc_line.name, 'income',
      SUM(COALESCE(m.income_amount, 0))
    FROM forecast_modules m
    LEFT JOIN fc_lines inc_line ON m.income_fc_line_id = inc_line.id
    WHERE m.scenario_id = $1 AND COALESCE(m.setup_status, 'new') NOT IN ('new', 'exclude')
      AND m.income_fc_line_id IS NOT NULL
    GROUP BY inc_line.name
    UNION ALL
    SELECT fl.name, CASE WHEN ie.base_value >= 0 THEN 'income' ELSE 'expense' END as type, ie.base_value
    FROM forecast_income_expense ie
    LEFT JOIN fc_lines fl ON ie.fc_line_id = fl.id
    WHERE ie.scenario_id = $1 AND COALESCE(ie.setup_status, 'new') NOT IN ('new', 'exclude')
  `, [scenario.id]);

  // 6. App data (birth year etc)
  const appData = await psdataRepo.getAllAppData();
  const birthYear = appData?.birthYear || null;

  // Format as structured text
  const lines = [];

  lines.push("# FORECAST PLAN REVIEW DATA\n");

  // Scenario
  lines.push("## Scenario");
  lines.push(`Name: ${scenario.name}`);
  if (config?.scenario) {
    lines.push(`Period: ${config.scenario.PeriodStart} to ${config.scenario.PeriodEnd}`);
    lines.push(`Tax Rate: ${config.scenario.TaxRate}%`);
  }
  lines.push(`Cash Sweep Band: ${scenario.cash_sweep_low ?? 'not set'} (low) – ${scenario.cash_sweep_high ?? 'not set'} (high)`);
  if (birthYear) lines.push(`Birth Year: ${birthYear} (current age: ${new Date().getFullYear() - birthYear})`);
  lines.push("");

  // Modules
  lines.push("## Balance Sheet Modules");
  for (const mod of modules) {
    lines.push(`\n### ${mod.name} (ID: ${mod.id})`);
    lines.push(`  Account: ${mod.account_name || 'N/A'}, Type: ${mod.module_type || 'N/A'}, Currency: ${mod.currency}`);
    lines.push(`  Base Date: ${mod.base_date}, Cost Basis: ${fmt(mod.base_value)}, Market Value: ${fmt(mod.market_value)}`);
    lines.push(`  Cost Basis (USD): ${fmt(mod.base_value_usd)}, Market Value (USD): ${fmt(mod.market_value_usd)}`);
    lines.push(`  Growth Rate: ${mod.growth_rate}% (×inflation), Expense Amount: ${fmt(mod.expense_amount)}, Income Amount: ${fmt(mod.income_amount)}`);
    lines.push(`  Expense Growth: ${mod.expense_growth_method || 'inflation'}, Tax Override: ${mod.tax_rate_override ?? 'default'}`);
    lines.push(`  Status: ${mod.setup_status}, Cash Sweep Target: ${mod.cash_sweep_target ? 'YES' : 'no'}`);
    if (mod.income_pct?.length) {
      lines.push(`  Yield Schedule: ${mod.income_pct.map(p => `${new Date(p.effective_date).getFullYear()}: ${p.value}%`).join(", ")}`);
    }
    if (mod.disposals?.length) {
      lines.push(`  Disposals: ${mod.disposals.map(d => `${d.disposal_date} ${d.flag || ''} ${fmt(d.amount)}`).join(", ")}`);
    }
    if (mod.investments?.length) {
      lines.push(`  Investments: ${mod.investments.map(i => `${i.investment_date} ${fmt(i.amount)}`).join(", ")}`);
    }
  }
  lines.push("");

  // Income/Expense items
  lines.push("## Income & Expense Forecast Items");
  for (const ie of incexp) {
    lines.push(`  ${ie.name} (ID: ${ie.id}): Base Value ${fmt(ie.base_value)}, Growth ${ie.growth_rate}%, Currency: ${ie.currency}, Status: ${ie.setup_status}`);
  }
  lines.push("");

  // FX Assumptions
  if (config?.scenario) {
    lines.push("## FX & Inflation Assumptions");
    const inf = config.inflationRates || [];
    const years = config.years || [];
    if (years.length > 0 && inf.length > 0) {
      lines.push(`  Inflation: ${inf[0]}% (applied from ${years[0]})`);
    }
    const plnRates = config.fxratesPLN || [];
    const eurRates = config.fxratesEUR || [];
    if (plnRates.length > 0) lines.push(`  PLN/USD: ${plnRates[0]}`);
    if (eurRates.length > 0) lines.push(`  EUR/USD: ${eurRates[0]}`);
    lines.push("");
  }

  // Base year budget
  lines.push("## Base Year Budget (annual P&L)");
  for (const row of baseYearResult.rows) {
    if (row.fc_line && row.amount) lines.push(`  ${row.fc_line}: ${fmt(row.amount)}`);
  }
  lines.push("");

  // Generated forecast summary (key rows by year)
  lines.push("## Generated Forecast Output (by year)");
  const entryMap = {};
  for (const row of entriesResult.rows) {
    const yr = row.forecast_year;
    if (!entryMap[yr]) entryMap[yr] = {};
    entryMap[yr][row.account] = Number(row.amount);
  }
  const forecastYears = Object.keys(entryMap).sort();
  if (forecastYears.length > 0) {
    // Get all account names
    const allAccounts = new Set();
    for (const yr of forecastYears) for (const acc of Object.keys(entryMap[yr])) allAccounts.add(acc);

    lines.push(`\nYears: ${forecastYears.join(", ")}\n`);
    for (const acc of [...allAccounts].sort()) {
      const vals = forecastYears.map(yr => fmt(entryMap[yr]?.[acc] || 0));
      lines.push(`${acc}: ${vals.join(" | ")}`);
    }
  }

  return { context: lines.join("\n"), scenario, modules, incexp };
}

function fmt(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/**
 * Calls the local LLM gateway with the forecast context and conversation history.
 * The /task endpoint is single-turn, so we flatten multi-turn history into a
 * User:/Assistant: transcript and end with an "Assistant:" cue.
 */
async function callGateway({ systemPrompt, messages, forecastContext }) {
  const gatewayUrl = process.env.LLM_GATEWAY_URL || "http://192.168.1.61:8080";

  const lines = ["--- FORECAST DATA ---", forecastContext, "", "--- CONVERSATION ---"];
  for (const m of messages) {
    const speaker = m.role === "user" ? "User" : "Assistant";
    lines.push(`${speaker}: ${m.content}`);
    lines.push("");
  }
  lines.push("Assistant:");
  const prompt = lines.join("\n");

  const response = await fetch(`${gatewayUrl}/task`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      task: "finance_plan_review",
      prompt,
      system: systemPrompt,
      max_tokens: 4096,
    }),
    signal: AbortSignal.timeout(300_000),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`LLM gateway ${response.status}: ${errText.slice(0, 500)}`);
  }

  const data = await response.json();
  const content = data.response || "";

  const actions = [];
  const actionRegex = /```action\s*\n([\s\S]*?)\n```/g;
  let match;
  while ((match = actionRegex.exec(content)) !== null) {
    try {
      actions.push(JSON.parse(match[1].trim()));
    } catch (e) { /* skip malformed actions */ }
  }

  return { content, actions: actions.length > 0 ? actions : null };
}

/**
 * Creates a new AI review session for a scenario
 */
// Treat a review as stuck if it's been pending longer than this (matches the
// gateway-call AbortSignal of 5min, plus a small buffer).
const STALE_PENDING_MS = 6 * 60 * 1000;

/**
 * Background worker — runs the gateway call and writes results to the DB.
 * Never thrown; failures are persisted as status='failed'.
 */
async function processReview(reviewId, scenarioName) {
  try {
    const customPrompt = await psdataRepo.getAppData("ai_review_prompt");
    const systemPrompt = (typeof customPrompt === "string" && customPrompt.trim())
      ? customPrompt : DEFAULT_SYSTEM_PROMPT;

    const { context } = await buildForecastContext(scenarioName);

    const messagesResult = await db.query(
      "SELECT role, content FROM fc_ai_messages WHERE review_id = $1 ORDER BY created_at",
      [reviewId]
    );
    const messages = messagesResult.rows;

    const { content, actions } = await callGateway({
      systemPrompt,
      messages,
      forecastContext: context,
    });

    await db.query(
      "INSERT INTO fc_ai_messages (review_id, role, content, actions) VALUES ($1, 'assistant', $2, $3)",
      [reviewId, content, actions ? JSON.stringify(actions) : null]
    );
    await db.query(
      "UPDATE fc_ai_reviews SET status = 'completed', error_message = NULL, updated_at = NOW() WHERE id = $1",
      [reviewId]
    );
  } catch (err) {
    console.error(`[ai-review] background worker failed for review ${reviewId}:`, err.message);
    await db.query(
      "UPDATE fc_ai_reviews SET status = 'failed', error_message = $2, updated_at = NOW() WHERE id = $1",
      [reviewId, String(err.message || err).slice(0, 1000)]
    ).catch(() => {});
  }
}

/**
 * Creates a new review record + initial user message and fires the gateway
 * call in the background. Returns immediately with status='pending'.
 */
async function createReview(scenarioName) {
  const scenarioResult = await db.query(
    "SELECT id FROM forecast_scenarios WHERE name = $1",
    [scenarioName]
  );
  if (scenarioResult.rows.length === 0) throw new Error(`Scenario "${scenarioName}" not found`);
  const scenarioId = scenarioResult.rows[0].id;

  const reviewResult = await db.query(
    "INSERT INTO fc_ai_reviews (scenario_id, title, status) VALUES ($1, $2, 'pending') RETURNING *",
    [scenarioId, `Review of ${scenarioName}`]
  );
  const review = reviewResult.rows[0];

  const userMessage = "Please review my financial plan and provide your analysis.";
  await db.query(
    "INSERT INTO fc_ai_messages (review_id, role, content) VALUES ($1, 'user', $2)",
    [review.id, userMessage]
  );

  // Fire-and-forget; the worker writes results to the DB. Polled via /:id/status.
  processReview(review.id, scenarioName);

  return { review };
}

/**
 * Inserts the user's follow-up, marks the review pending, and fires the
 * gateway call in the background. Returns immediately.
 */
async function sendMessage(reviewId, userMessage) {
  const reviewResult = await db.query(
    "SELECT r.id, r.status, s.name as scenario_name FROM fc_ai_reviews r JOIN forecast_scenarios s ON r.scenario_id = s.id WHERE r.id = $1",
    [reviewId]
  );
  const review = reviewResult.rows[0];
  if (!review) throw new Error("Review not found");
  if (review.status === "pending") throw new Error("A review is already in progress for this conversation");

  await db.query(
    "INSERT INTO fc_ai_messages (review_id, role, content) VALUES ($1, 'user', $2)",
    [reviewId, userMessage]
  );
  await db.query(
    "UPDATE fc_ai_reviews SET status = 'pending', error_message = NULL, updated_at = NOW() WHERE id = $1",
    [reviewId]
  );

  processReview(reviewId, review.scenario_name);

  return { reviewId, status: "pending" };
}

/**
 * Returns the current status of a review. Marks stale-pending reviews
 * (older than STALE_PENDING_MS) as failed before returning.
 */
async function getReviewStatus(reviewId) {
  await db.query(
    `UPDATE fc_ai_reviews
       SET status = 'failed',
           error_message = COALESCE(error_message, 'Review timed out — server may have restarted while running.'),
           updated_at = NOW()
     WHERE id = $1
       AND status = 'pending'
       AND updated_at < NOW() - INTERVAL '${Math.floor(STALE_PENDING_MS / 1000)} seconds'`,
    [reviewId]
  );

  const result = await db.query(
    `SELECT r.id, r.status, r.error_message, r.updated_at,
            (SELECT COUNT(*)::int FROM fc_ai_messages WHERE review_id = r.id) AS message_count
       FROM fc_ai_reviews r WHERE r.id = $1`,
    [reviewId]
  );
  if (result.rows.length === 0) throw new Error("Review not found");
  return result.rows[0];
}

/**
 * Applies a recommended action (Phase 1: numeric field updates only)
 */
async function applyAction(action) {
  const { type, module_id, field, proposed_value } = action;

  const allowedModuleFields = ["growth_rate", "income_amount", "expense_amount", "tax_rate_override"];
  const allowedIncExpFields = ["base_value", "growth_rate"];
  const allowedScenarioFields = ["cash_sweep_low", "cash_sweep_high"];

  if (type === "update_module") {
    if (!allowedModuleFields.includes(field)) throw new Error(`Field "${field}" not allowed for auto-apply`);
    const updated = await forecastRepo.updateModule(module_id, { [field]: proposed_value });
    if (!updated) throw new Error("Module not found");
    return { success: true, entity: "module", id: module_id, field, value: proposed_value };
  }

  if (type === "update_incexp") {
    if (!allowedIncExpFields.includes(field)) throw new Error(`Field "${field}" not allowed for auto-apply`);
    const updated = await forecastRepo.updateIncExp(action.incexp_id, { [field]: proposed_value });
    if (!updated) throw new Error("Income/expense item not found");
    return { success: true, entity: "incexp", id: action.incexp_id, field, value: proposed_value };
  }

  if (type === "update_scenario") {
    if (!allowedScenarioFields.includes(field)) throw new Error(`Field "${field}" not allowed for auto-apply`);
    const updated = await forecastRepo.updateScenario(action.scenario_id, { [field]: proposed_value });
    if (!updated) throw new Error("Scenario not found");
    return { success: true, entity: "scenario", id: action.scenario_id, field, value: proposed_value };
  }

  throw new Error(`Unknown action type: ${type}`);
}

module.exports = { createReview, sendMessage, getReviewStatus, applyAction, DEFAULT_SYSTEM_PROMPT };
