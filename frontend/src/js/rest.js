const apiBase = import.meta.env.VITE_APP_API ?? "";

/**
 * A lightweight REST helper that wraps fetch() for JSON endpoints.
 */
export default class Rest {
  static buildUrl(path) {
    return `${apiBase}${path}`;
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

      throw new Error(message || "Unable to fetch data from the API");
    }

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
    const response = await fetch(Rest.buildUrl(path), options);
    return Rest.handleResponse(response);
  }

  static async fetchBalanceReport(asOfDate) {
    const encodedDate = encodeURIComponent(asOfDate ?? "");
    const report = await Rest.fetchJson(`/api/balance?asOfDate=${encodedDate}`);
    return report?.["Balance Sheet Accounts"] ?? null;
  }

  static async fetchCashFlowReport({
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
    const path = `/api/cash-flow${query ? `?${query}` : ""}`;
    const report = await Rest.fetchJson(path);
    return report?.["Profit & Loss Accounts"] ?? null;
  }

  static async fetchCashFlowTransactions({
    categories,
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
    if (fromDate) params.set("fromDate", fromDate);
    if (toDate) params.set("toDate", toDate);
    if (limit) params.set("limit", limit);
    const query = params.toString();
    const path = `/api/cash-flow/transactions${query ? `?${query}` : ""}`;
    return Rest.fetchJson(path);
  }

  static async fetchPsDataOptions() {
    return Rest.fetchJson("/api/psdata/options");
  }
}
