const https = require("https");

const API_BASE = "https://api.frankfurter.dev/v1";

function toIsoDate(dateInput) {
  const date =
    dateInput instanceof Date ? new Date(dateInput) : dateInput ? new Date(dateInput) : new Date();
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid date provided.");
  }
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildUrl(baseCurrency, quoteCurrency, asOfDate) {
  const datePath = asOfDate ? toIsoDate(asOfDate) : "latest";
  const params = new URLSearchParams({
    from: baseCurrency.toUpperCase(),
    to: quoteCurrency.toUpperCase(),
  });
  return `${API_BASE}/${datePath}?${params.toString()}`;
}

function fetchJson(url, maxRedirects = 3) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && maxRedirects > 0) {
          res.resume();
          return resolve(fetchJson(res.headers.location, maxRedirects - 1));
        }

        if (!res || res.statusCode >= 400) {
          reject(new Error(`Frankfurter API error: ${res?.statusCode || "unknown"}`));
          res?.resume?.();
          return;
        }

        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(raw));
          } catch (err) {
            reject(err);
          }
        });
      })
      .on("error", reject);
  });
}

async function getExchangeRate(baseCurrency, quoteCurrency, asOfDate) {
  try {
    if (!baseCurrency || !quoteCurrency) {
      throw new Error("Both baseCurrency and quoteCurrency are required.");
    }

    const base = baseCurrency.toUpperCase();
    const quote = quoteCurrency.toUpperCase();
    if (base === quote) {
      return 1;
    }

    const url = buildUrl(base, quote, asOfDate);
    const data = await fetchJson(url);
    const rate = data?.rates?.[quote];
    return typeof rate === "number" ? rate : null;
  } catch (error) {
    console.warn("Failed to fetch Frankfurter exchange rate:", error);
    return null;
  }
}

module.exports = {
  getExchangeRate,
};
