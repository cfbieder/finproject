const apiBase = import.meta.env.VITE_APP_API ?? "";

// Default ceiling for any single request. Normal reads resolve in well under a
// second; this only fires when a request would otherwise hang forever (a
// stale/broken service worker intercepting /api, a dead proxy), converting an
// infinite spinner into a surfaced error the UI can show and retry. Callers
// with a legitimately long request pass { timeoutMs } (0 disables the timeout).
const DEFAULT_TIMEOUT_MS = 30000;

/**
 * A lightweight REST helper that wraps fetch() for JSON endpoints.
 */
export default class Rest {
  static buildUrl(path) {
    return `${apiBase}${path}`;
  }

  /**
   * fetch() with a timeout so a hung request can't spin forever. Honors a
   * caller-supplied AbortSignal (external cancel) in addition to the timeout,
   * and rethrows a caller-initiated abort as-is (only the timeout is remapped
   * to a readable Error).
   */
  static async fetchWithTimeout(url, options = {}) {
    const {
      timeoutMs = DEFAULT_TIMEOUT_MS,
      signal: externalSignal,
      ...rest
    } = options;

    if (!timeoutMs || timeoutMs <= 0) {
      return fetch(url, externalSignal ? { ...rest, signal: externalSignal } : rest);
    }

    const controller = new AbortController();
    const onExternalAbort = () => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort();
      else externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(url, { ...rest, signal: controller.signal });
    } catch (err) {
      // Only remap OUR timeout; a caller-initiated cancel rethrows untouched.
      if (err.name === "AbortError" && !(externalSignal && externalSignal.aborted)) {
        throw new Error(
          `Request timed out after ${Math.round(timeoutMs / 1000)}s — the server or network did not respond.`
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
      if (externalSignal) externalSignal.removeEventListener("abort", onExternalAbort);
    }
  }

  static async handleResponse(response) {
    const contentType = response.headers.get("content-type") ?? "";
    const isJson = contentType.toLowerCase().includes("application/json");

    if (!response.ok) {
      const payload = isJson ? await response.json().catch(() => null) : null;

      let message = payload?.error || response.statusText;

      if (!message && !isJson) {
        const bodyText = await response.text().catch(() => "");
        message = bodyText || "Unable to fetch data from the API";
      }

      // CR087 P0c — carry the HTTP status and any server `code` onto the error.
      // Without them every failure is an opaque string, so a 409 (the figures
      // moved between preview and apply — NOTHING was written) is
      // indistinguishable from a 400, and the UI can only report both as
      // "reconcile failed". Additive: nothing read these before.
      const err = new Error(message || "Unable to fetch data from the API");
      err.status = response.status;
      if (payload?.code) err.code = payload.code;
      if (payload?.current) err.current = payload.current;
      throw err;
    }

    // 204 No Content is a valid success response with no body — don't treat
    // it as a JSON-parse failure. Returns null so callers can `await` without
    // unwrapping anything.
    if (response.status === 204) return null;

    if (!isJson) {
      const bodyText = await response.text().catch(() => "");
      throw new Error(
        bodyText
          ? `Unexpected response: ${bodyText.slice(0, 256)}`
          : "API did not return JSON"
      );
    }

    return response.json();
  }

  static async fetchJson(path, options = {}) {
    const response = await Rest.fetchWithTimeout(Rest.buildUrl(path), options);
    return Rest.handleResponse(response);
  }

  /**
   * Returns the payload whether the endpoint envelopes it (`{data: …}`) or returns it bare.
   *
   * The v2 API grew two conventions: 63 handlers return `{data}`, ~27 return the value
   * directly (CR043 N8). Callers therefore had to KNOW which — and getting it wrong fails
   * silently, because `undefined.map` never runs and the page just renders empty. That is
   * exactly how the Modify Transfer modal broke: `GET /forecast/modules` returns a bare
   * array while its sibling `GET /forecast/modules/:id` returns `{data}`, so the modal read
   * transfers off the wrong shape and displayed "no transfers" forever.
   *
   * This tolerates both, so the server side can be unified endpoint-by-endpoint with no
   * flag day: a caller routed through here works before AND after its endpoint is changed.
   *
   * `{data}` is only unwrapped when it is the envelope — a plain object that carries `data`
   * as its ONLY meaningful key. A payload that happens to have its own `data` field
   * alongside others is returned untouched.
   */
  static unwrap(payload) {
    if (
      payload &&
      typeof payload === "object" &&
      !Array.isArray(payload) &&
      "data" in payload
    ) {
      const keys = Object.keys(payload).filter(
        (k) => k !== "data" && k !== "success" && k !== "meta"
      );
      if (keys.length === 0) return payload.data;
    }
    return payload;
  }

  /**
   * Unwrap to an ARRAY, or an empty one. Never anything else.
   *
   * `unwrap` deliberately returns the whole payload when `data` sits alongside other keys, so a
   * caller that wants the siblings can have them. Both FC-line totals routes echo their argument
   * — `{data, year}` and `{data, budgetYear}` — so `unwrap` handed back the OBJECT and every
   * `for (const r of rows)` threw `is not iterable`. The v3.16.0 reference block was dead from the
   * day it shipped for exactly this reason, and it looked fine in every check that stopped at the
   * endpoint instead of the render.
   *
   * A list helper must therefore return a list or nothing — never a shape the caller has to guess.
   */
  static rows(payload) {
    const unwrapped = Rest.unwrap(payload);
    if (Array.isArray(unwrapped)) return unwrapped;
    if (Array.isArray(unwrapped?.data)) return unwrapped.data;
    return [];
  }

  static async post(path, body, options = {}) {
    return Rest.fetchJson(`/api/v2${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      ...options,
    });
  }

  static async patch(path, body) {
    return Rest.fetchJson(`/api/v2${path}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  static async get(path) {
    return Rest.fetchJson(`/api/v2${path}`);
  }

  static async put(path, body) {
    return Rest.fetchJson(`/api/v2${path}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  static async del(path) {
    return Rest.fetchJson(`/api/v2${path}`, { method: "DELETE" });
  }

  /**
   * CR088 P2 — the LE summed over the same period as the other two columns.
   *
   * Returns `{ nodes, le }`, not a bare tree: the caller needs the LE's cut date
   * to say whether the selected period reaches past it, and a period that does
   * not is one where the LE is the actual by construction.
   */
  static async fetchLeCashFlowReport({ leId, fromDate, toDate, transfers } = {}) {
    if (!leId) return null;
    const params = new URLSearchParams();
    if (fromDate) params.set("fromDate", fromDate);
    if (toDate) params.set("toDate", toDate);
    if (transfers) params.set("transfers", transfers);

    const query = params.toString();
    const path = `/api/v2/budget/le/${encodeURIComponent(leId)}/cash-flow${query ? `?${query}` : ""}`;
    // Enveloped, unlike the two cash-flow calls above it — see the note on the
    // route. `unwrap` handles both shapes, so this stays correct either way.
    const report = Rest.unwrap(await Rest.fetchJson(path));
    return {
      nodes: report?.["Profit & Loss Accounts"] ?? null,
      le: report?.le ?? null,
    };
  }

  /** CR088 P2 — the LEs for a budget year, newest first (see budgetLe.findAll). */
  static async fetchBudgetLeList(budgetYear) {
    const query = budgetYear ? `?budgetYear=${encodeURIComponent(budgetYear)}` : "";
    const payload = await Rest.fetchJson(`/api/v2/budget/le${query}`);
    const rows = Rest.unwrap(payload);
    return Array.isArray(rows) ? rows : [];
  }

  static async fetchBudgetCashFlowReport({
    fromDate,
    toDate,
    transfers,
    includeUnrealizedGL,
  } = {}) {
    const params = new URLSearchParams();
    if (fromDate) params.set("fromDate", fromDate);
    if (toDate) params.set("toDate", toDate);
    if (transfers) params.set("transfers", transfers);
    if (typeof includeUnrealizedGL === "boolean") {
      params.set("includeUnrealizedGL", includeUnrealizedGL);
    }

    const query = params.toString();
    // Using v2 API (PostgreSQL)
    const path = `/api/v2/budget/cash-flow${query ? `?${query}` : ""}`;
    const report = await Rest.fetchJson(path);
    return report?.["Profit & Loss Accounts"] ?? null;
  }

  static async fetchCashFlowTransactions({
    categories,
    accounts,
    fromDate,
    toDate,
    limit,
  } = {}) {
    const params = new URLSearchParams();
    const categoryList = Array.isArray(categories)
      ? categories
      : categories
      ? [categories]
      : [];
    for (const category of categoryList) {
      if (category) {
        params.append("category", category);
      }
    }
    if (Array.isArray(accounts)) {
      for (const account of accounts) {
        if (account) params.append("accounts", account);
      }
    }
    if (fromDate) params.set("fromDate", fromDate);
    if (toDate) params.set("toDate", toDate);
    if (limit) params.set("limit", limit);
    const query = params.toString();
    // Using v2 API (PostgreSQL)
    const path = `/api/v2/reports/cash-flow/transactions${query ? `?${query}` : ""}`;
    return Rest.fetchJson(path);
  }

  static async fetchPsDataOptions() {
    // Using v2 API (wraps v1)
    return Rest.fetchJson("/api/v2/ingest-ps/psdata/options");
  }

  static async fetchCoaSections() {
    // Using v2 API
    const [balanceSheet, cashFlow] = await Promise.all([
      Rest.fetchJson("/api/v2/util/coa/BalanceSheet"),
      Rest.fetchJson("/api/v2/util/coa/CashFlow"),
    ]);

    return [
      { "Balance Sheet Accounts": balanceSheet ?? [] },
      { "Profit & Loss Accounts": cashFlow ?? [] },
    ];
  }

  /**
   * CR063 — set the order of one parent's children. Sends the WHOLE ordered list
   * of sibling ids, so the server can reject a stale client (409) instead of
   * writing a partial order. `parent` is `{ parentId }` or `{ parentName }` — the
   * top-level rows know their parent only by name, because the API strips the
   * section root and fetchCoaSections re-adds it as a bare label.
   */
  static async reorderCoaChildren(parent, orderedIds) {
    return Rest.fetchJson("/api/v2/util/coa/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...parent, orderedIds }),
    });
  }

  static async fetchCoaTraits() {
    // Using v2 API. Account numbers come back MASKED (CR082 P0a) — the full
    // value is one call per account, below.
    return Rest.fetchJson("/api/v2/util/coa-traits");
  }

  /**
   * One account's full number, for the COA edit form. Deliberately NOT part of
   * the traits payload: that one is fetched on every COA page load, and a bulk
   * dump is the thing that leaks (CR082 §7.1).
   */
  static async fetchCoaAccountNumber(accountId) {
    return Rest.fetchJson(`/api/v2/util/coa/${accountId}/account-number`);
  }

  static async fetchBudgetActualEntries({
    actualYear,
    month,
    fromMonth,
    toMonth,
    categories,
    accounts,
    limit,
  } = {}) {
    const params = new URLSearchParams();
    if (actualYear !== undefined && actualYear !== null) {
      params.set("actualYear", Number(actualYear));
    }
    if (month !== undefined && month !== null) {
      params.set("month", Number(month));
    }
    if (fromMonth) params.set("fromMonth", fromMonth);
    if (toMonth) params.set("toMonth", toMonth);
    if (Array.isArray(categories) && categories.length) {
      for (const category of categories) {
        if (category) {
          params.append("category", category);
        }
      }
    } else if (categories) {
      params.set("category", categories);
    }
    if (Array.isArray(accounts) && accounts.length) {
      for (const account of accounts) {
        if (account) {
          params.append("accounts", account);
        }
      }
    } else if (accounts) {
      params.set("accounts", accounts);
    }
    if (limit !== undefined && limit !== null) {
      params.set("limit", Number(limit));
    }

    const query = params.toString();
    // Using v2 API (PostgreSQL)
    const path = `/api/v2/budget/actual-entries${query ? `?${query}` : ""}`;
    return Rest.fetchJson(path);
  }

  // ============================================================================
  // V2 API Methods (PostgreSQL)
  // ============================================================================

  /**
   * Fetch transactions from v2 API (PostgreSQL)
   */
  static async fetchTransactionsV2({
    year,
    month,
    accountId,
    categoryId,
    currency,
    description,
    minAmount,
    maxAmount,
    limit,
    offset,
  } = {}) {
    const params = new URLSearchParams();
    if (year !== undefined && year !== null) {
      params.set("year", Number(year));
    }
    if (month !== undefined && month !== null) {
      params.set("month", Number(month));
    }
    if (accountId !== undefined && accountId !== null) {
      params.set("accountId", Number(accountId));
    }
    if (categoryId !== undefined && categoryId !== null) {
      params.set("categoryId", Number(categoryId));
    }
    if (currency) {
      params.set("currency", currency);
    }
    if (description) {
      params.set("description", description);
    }
    if (minAmount !== undefined && minAmount !== null) {
      params.set("minAmount", Number(minAmount));
    }
    if (maxAmount !== undefined && maxAmount !== null) {
      params.set("maxAmount", Number(maxAmount));
    }
    if (limit !== undefined && limit !== null) {
      params.set("limit", Number(limit));
    }
    if (offset !== undefined && offset !== null) {
      params.set("offset", Number(offset));
    }

    const query = params.toString();
    const path = `/api/v2/transactions${query ? `?${query}` : ""}`;
    const response = await Rest.fetchJson(path);
    return response?.data ?? [];
  }

  /**
   * Fetch account tree as nested { name, children } structure from v2 API
   */
  static async fetchAccountTreeV2({ section } = {}) {
    const params = new URLSearchParams();
    if (section) params.set("section", section);
    params.set("format", "nested");
    const query = params.toString();
    const path = `/api/v2/accounts/tree${query ? `?${query}` : ""}`;
    const response = await Rest.fetchJson(path);
    return response?.data ?? [];
  }

  /**
   * Fetch account traits map from v2 API (replaces coa_traits.json)
   */
  static async fetchAccountTraitsV2() {
    return Rest.fetchJson("/api/v2/accounts/traits");
  }

  /**
   * Fetch accounts from v2 API (PostgreSQL)
   */
  static async fetchAccountsV2({ section, type, accountType, activeOnly = true, leafOnly = false } = {}) {
    const params = new URLSearchParams();
    if (section) params.set("section", section);
    const acctType = accountType || type;
    if (acctType) params.set("accountType", acctType);
    if (activeOnly !== undefined) params.set("activeOnly", String(activeOnly));
    if (leafOnly) params.set("leafOnly", "true");

    const query = params.toString();
    const path = `/api/v2/accounts${query ? `?${query}` : ""}`;
    const response = await Rest.fetchJson(path);
    return response?.data ?? [];
  }

  /**
   * Fetch categories from v2 API (PostgreSQL)
   */
  static async fetchCategoriesV2({ activeOnly = true } = {}) {
    const params = new URLSearchParams();
    if (activeOnly !== undefined) params.set("activeOnly", String(activeOnly));

    const query = params.toString();
    const path = `/api/v2/categories${query ? `?${query}` : ""}`;
    const response = await Rest.fetchJson(path);
    return response?.data ?? [];
  }

  /**
   * Look up a category by name (returns category with mappings)
   */
  static async fetchCategoryByName(name) {
    const response = await Rest.fetchJson(
      `/api/v2/categories/lookup?name=${encodeURIComponent(name)}`
    );
    return response?.data ?? null;
  }

  /**
   * Fetch source mappings for a category
   */
  static async fetchCategoryMappings(categoryId) {
    const response = await Rest.fetchJson(
      `/api/v2/categories/${categoryId}/mappings`
    );
    return response?.data ?? [];
  }

  /**
   * Save a category source mapping
   */
  static async saveCategoryMapping(categoryId, source, externalName) {
    return Rest.fetchJson(`/api/v2/categories/${categoryId}/mappings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, external_name: externalName }),
    });
  }

  /**
   * Look up an account by name (returns account with mappings)
   */
  static async fetchAccountByName(name) {
    const response = await Rest.fetchJson(
      `/api/v2/accounts/lookup?name=${encodeURIComponent(name)}`
    );
    return response?.data ?? null;
  }

  /**
   * Save an account source mapping
   */
  static async saveAccountMapping(accountId, source, externalName) {
    return Rest.fetchJson(`/api/v2/accounts/${accountId}/mappings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, external_name: externalName }),
    });
  }

  /**
   * Fetch forecast scenarios from v2 API
   */
  static async fetchForecastScenariosV2({ activeOnly = true } = {}) {
    const params = new URLSearchParams();
    if (activeOnly !== undefined) params.set("activeOnly", String(activeOnly));

    const query = params.toString();
    const path = `/api/v2/forecast/scenarios${query ? `?${query}` : ""}`;
    const response = await Rest.fetchJson(path);
    return response?.data ?? [];
  }

  /**
   * Update a transaction via v2 API
   */
  static async updateTransactionV2(id, data) {
    const response = await Rest.fetchWithTimeout(Rest.buildUrl(`/api/v2/transactions/${id}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return Rest.handleResponse(response);
  }

  /**
   * Delete a transaction via v2 API
   */
  static async deleteTransactionV2(id) {
    const response = await Rest.fetchWithTimeout(Rest.buildUrl(`/api/v2/transactions/${id}`), {
      method: "DELETE",
    });
    if (!response.ok) {
      throw new Error(`Failed to delete transaction: ${response.statusText}`);
    }
    return true;
  }

  /**
   * Fetch balance sheet report from v2 API (PostgreSQL)
   */
  static async fetchBalanceReportV2(asOfDate) {
    const encodedDate = encodeURIComponent(asOfDate ?? "");
    const report = await Rest.fetchJson(`/api/v2/reports/balance?asOfDate=${encodedDate}`);
    return report?.["Balance Sheet Accounts"] ?? null;
  }

  /**
   * CR070 P6 — actual spend per FC line for a year.
   *
   * A FLOW module's prior-year comparison. It cannot use `fetchBalanceReportV2`: every account
   * feeding an expense line is `profit_loss`, so a balance-sheet lookup returns nothing — and the
   * module's `account_id` names one of the several accounts that feed its line anyway.
   */
  static async fetchFcLineActualTotals(year) {
    const res = await Rest.fetchJson(`/api/v2/fc-lines/actual-totals?year=${encodeURIComponent(year)}`);
    return Rest.rows(res);
  }

  /**
   * Budgeted total per FC line for a year — the sibling of the above, over `budget_entries`.
   * The route already existed; nothing on the Modules form had asked it for a line before.
   */
  /**
   * CR072 QA — which P&L accounts make up one line's actual. `Property Costs` is 35 of them,
   * and the parts sum to the whole because the route reuses the total's own CTE and just stops
   * grouping.
   */
  // CR074 — which cash-health warnings the owner has accepted, per scenario. Returned as
  // `{ [warningId]: fingerprint }`; the panel suppresses a warning only while its fingerprint
  // still matches, so a changed warning comes back on its own.
  static async fetchWarningDismissals(scenario) {
    const res = await Rest.fetchJson(
      `/api/v2/forecast/warnings/dismissals?scenario=${encodeURIComponent(scenario)}`
    );
    return Rest.unwrap(res) || {};
  }

  /** One item or twenty — "Dismiss all" is one request, not N racing writes. */
  static async dismissWarnings(scenario, items) {
    return Rest.fetchJson('/api/v2/forecast/warnings/dismissals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario, items }),
    });
  }

  /** With no warningId, restores every dismissal in the scenario. */
  static async restoreWarnings(scenario, warningId = null) {
    const qs = new URLSearchParams({ scenario });
    if (warningId) qs.set('warningId', warningId);
    return Rest.fetchJson(`/api/v2/forecast/warnings/dismissals?${qs.toString()}`, {
      method: 'DELETE',
    });
  }

  static async fetchFcLineActualBreakdown(year, fcLineId) {
    const res = await Rest.fetchJson(
      `/api/v2/fc-lines/actual-breakdown?year=${encodeURIComponent(year)}&fcLineId=${encodeURIComponent(fcLineId)}`
    );
    return Rest.rows(res);
  }

  /** The budget sibling of the above, so both reference rows drill. */
  static async fetchFcLineBudgetBreakdown(year, fcLineId) {
    const res = await Rest.fetchJson(
      `/api/v2/fc-lines/budget-breakdown?budgetYear=${encodeURIComponent(year)}&fcLineId=${encodeURIComponent(fcLineId)}`
    );
    return Rest.rows(res);
  }

  static async fetchFcLineBudgetTotals(year) {
    const res = await Rest.fetchJson(`/api/v2/fc-lines/budget-totals?budgetYear=${encodeURIComponent(year)}`);
    return Rest.rows(res);
  }

  /**
   * Fetch cash flow report from v2 API (PostgreSQL)
   */
  static async fetchCashFlowReportV2({
    fromDate,
    toDate,
    transfers,
    includeUnrealizedGL,
  } = {}) {
    const params = new URLSearchParams();
    if (fromDate) params.set("fromDate", fromDate);
    if (toDate) params.set("toDate", toDate);
    if (transfers) params.set("transfers", transfers);
    if (typeof includeUnrealizedGL === "boolean") {
      params.set("includeUnrealizedGL", includeUnrealizedGL);
    }

    const query = params.toString();
    const path = `/api/v2/reports/cash-flow${query ? `?${query}` : ""}`;
    const report = await Rest.fetchJson(path);
    return report?.["Profit & Loss Accounts"] ?? null;
  }

  /**
   * Cash flow report filtered by category/account, in USD or original currency
   * (CR054 "By Account" tab). Returns { report, meta } — meta.currencies lists
   * the distinct transaction currencies so the caller can warn on a mixed
   * original-currency total.
   */
  static async fetchCashFlowByAccountV2({
    fromDate,
    toDate,
    transfers,
    includeUnrealizedGL,
    categories,
    accounts,
    currency,
  } = {}) {
    const params = new URLSearchParams();
    if (fromDate) params.set("fromDate", fromDate);
    if (toDate) params.set("toDate", toDate);
    if (transfers) params.set("transfers", transfers);
    if (typeof includeUnrealizedGL === "boolean") {
      params.set("includeUnrealizedGL", includeUnrealizedGL);
    }
    if (currency) params.set("currency", currency);
    if (Array.isArray(categories)) {
      for (const category of categories) {
        if (category) params.append("category", category);
      }
    }
    if (Array.isArray(accounts)) {
      for (const account of accounts) {
        if (account) params.append("accounts", account);
      }
    }

    const query = params.toString();
    const path = `/api/v2/reports/cash-flow${query ? `?${query}` : ""}`;
    const report = await Rest.fetchJson(path);
    return {
      report: report?.["Profit & Loss Accounts"] ?? null,
      meta: report?.meta ?? null,
    };
  }

  /**
   * Fetch the CR056 Investment Returns report.
   *
   * Deliberately NOT via `Rest.unwrap` — that returns `payload.data` when the
   * only siblings are `success`/`meta`, which would silently discard the
   * coverage / cadence / chain-break banners and render a report with all its
   * caveats stripped off. Follows the CR054 precedent of returning both halves.
   */
  static async fetchInvestmentReturnsV2({
    account,
    fromDate,
    toDate,
    interval = "month",
    currency = "usd",
  } = {}) {
    const params = new URLSearchParams({
      account: String(account),
      fromDate,
      toDate,
      interval,
      currency,
    });
    const payload = await Rest.fetchJson(
      `/api/v2/reports/investment-returns?${params.toString()}`
    );
    return { data: payload?.data ?? null, meta: payload?.meta ?? null };
  }

  /**
   * Fetch budget summary (actual vs budget by month) from v2 API
   */
  static async fetchBudgetBalancesV2({
    fromMonth,
    toMonth,
    actualYear,
    budgetYear,
    categories,
    accounts,
  } = {}) {
    const params = new URLSearchParams();
    if (fromMonth) params.set("fromMonth", fromMonth);
    if (toMonth) params.set("toMonth", toMonth);
    if (actualYear !== undefined && actualYear !== null) {
      params.set("actualYear", Number(actualYear));
    }
    if (budgetYear !== undefined && budgetYear !== null) {
      params.set("budgetYear", Number(budgetYear));
    }
    if (Array.isArray(categories) && categories.length) {
      for (const category of categories) {
        if (category) params.append("category", category);
      }
    }
    if (Array.isArray(accounts) && accounts.length) {
      for (const account of accounts) {
        if (account) params.append("accounts", account);
      }
    }

    const query = params.toString();
    const path = `/api/v2/budget/summary${query ? `?${query}` : ""}`;
    return Rest.fetchJson(path);
  }

  /**
   * Fetch category groups (Income/Expense) from v2 API
   */
  static async fetchCategoryGroupsV2() {
    return Rest.fetchJson("/api/v2/budget/category-groups");
  }

  /**
   * Fetch currency options from v2 API
   */
  static async fetchCurrencyOptionsV2() {
    return Rest.fetchJson("/api/v2/util/currencies");
  }

  /**
   * Fetch app data from v2 API
   */
  static async fetchAppDataV2() {
    return Rest.fetchJson("/api/v2/util/appdata");
  }

  /**
   * Create budget entry via v2 API
   */
  static async createBudgetEntryV2(data) {
    const response = await Rest.fetchWithTimeout(Rest.buildUrl("/api/v2/budget/entries"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return Rest.handleResponse(response);
  }

  /**
   * Update budget entry via v2 API
   */
  static async updateBudgetEntryV2(id, data) {
    const response = await Rest.fetchWithTimeout(Rest.buildUrl(`/api/v2/budget/entries/${id}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return Rest.handleResponse(response);
  }

  /**
   * Fetch category trend report (actual vs budget by month for selected categories)
   */
  static async fetchCategoryTrend({ startDate, endDate, categories } = {}) {
    const params = new URLSearchParams();
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    if (Array.isArray(categories)) {
      for (const cat of categories) {
        if (cat) params.append("category", cat);
      }
    }
    const query = params.toString();
    return Rest.fetchJson(`/api/v2/reports/category-trend${query ? `?${query}` : ""}`);
  }

  /**
   * Delete budget entry via v2 API
   */
  static async deleteBudgetEntryV2(id) {
    const response = await Rest.fetchWithTimeout(Rest.buildUrl(`/api/v2/budget/entries/${id}`), {
      method: "DELETE",
    });
    if (!response.ok) {
      throw new Error(`Failed to delete budget entry: ${response.statusText}`);
    }
    return true;
  }

}
