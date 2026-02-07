const express = require("express");
const fs = require("fs");
const path = require("path");
const {
  COMPONENTS_DATA_DIR,
  TEMP_DIR,
  dataPaths,
  tempFiles,
  ensureComponentsDataDir,
  ensureTempDir,
} = require("../utils/dataPaths");
const { getExchangeRate } = require("../utils/frankfurterExchangeRates");

const router = express.Router();

const FC_SETUP_PATH = path.join(COMPONENTS_DATA_DIR, "fc_setup.json");
const COA_TRAITS_PATH = path.join(COMPONENTS_DATA_DIR, "coa_traits.json");

const loadCoaTraits = () => {
  const raw = fs.readFileSync(COA_TRAITS_PATH, "utf8");
  return JSON.parse(raw);
};

const buildDataPathsSummary = () => {
  ensureComponentsDataDir();
  ensureTempDir();
  return {
    dataDirectory: COMPONENTS_DATA_DIR,
    tempDirectory: TEMP_DIR,
    dataPaths,
    tempFiles,
  };
};

router.get("/", (req, res) => {
  try {
    return res.json({
      status: "util-service",
      timestamp: new Date().toISOString(),
      paths: buildDataPathsSummary(),
    });
  } catch (error) {
    console.error("[UTIL] Failed to build summary response:", error);
    return res.status(500).json({
      error: "Unable to build utility metadata",
    });
  }
});

router.get("/coa-traits", (req, res) => {
  try {
    const traits = loadCoaTraits();

    if (!traits || typeof traits !== "object") {
      return res.status(404).json({
        error: "COA traits data not found",
      });
    }

    return res.json(traits);
  } catch (error) {
    console.error("[UTIL] Failed to load COA traits:", error);
    return res.status(500).json({
      error: "Failed to load COA traits",
    });
  }
});

router.get("/paths", (req, res) => {
  try {
    return res.json(buildDataPathsSummary());
  } catch (error) {
    console.error("[UTIL] Failed to resolve paths:", error);
    return res.status(500).json({
      error: "Unable to resolve data and temp paths",
    });
  }
});

router.post("/ensure-data-dir", (req, res) => {
  try {
    const path = ensureComponentsDataDir();
    return res.json({
      ensured: true,
      path,
    });
  } catch (error) {
    console.error("[UTIL] Failed to ensure data directory:", error);
    return res.status(500).json({
      error: "Failed to ensure components data directory",
    });
  }
});

router.post("/ensure-temp-dir", (req, res) => {
  try {
    const path = ensureTempDir();
    return res.json({
      ensured: true,
      path,
    });
  } catch (error) {
    console.error("[UTIL] Failed to ensure temp directory:", error);
    return res.status(500).json({
      error: "Failed to ensure temporary directory",
    });
  }
});

router.post("/fc-setup/periods", (req, res) => {
  const requestedPeriods = Array.isArray(req.body?.periods)
    ? req.body.periods
    : [];

  const normalized = requestedPeriods
    .map((period) => {
      if (!period || typeof period !== "object") {
        return null;
      }
      const key =
        typeof period.key === "string" && period.key.trim().length > 0
          ? period.key.trim()
          : null;
      if (!key) {
        return null;
      }

      const rawType =
        typeof period.type === "string" ? period.type.trim().toUpperCase() : "";
      const type = ["B", "F", "A"].includes(rawType) ? rawType : "";

      return { [key]: type };
    })
    .filter(Boolean);

  if (!normalized.length) {
    return res.status(400).json({
      error: "No valid periods provided to save",
    });
  }

  try {
    ensureComponentsDataDir();

    let fcSetup = {};
    if (fs.existsSync(FC_SETUP_PATH)) {
      try {
        const existing = fs.readFileSync(FC_SETUP_PATH, "utf8");
        fcSetup = JSON.parse(existing);
      } catch (error) {
        console.warn(
          "[FC-SETUP] Failed to parse existing fc_setup.json, rebuilding",
          error
        );
        fcSetup = {};
      }
    }

    fcSetup.periods_used = normalized;

    fs.writeFileSync(FC_SETUP_PATH, JSON.stringify(fcSetup, null, 2));

    return res.json({
      periodsUpdated: normalized.length,
      path: FC_SETUP_PATH,
    });
  } catch (error) {
    console.error("[FC-SETUP] Failed to persist periods:", error);
    return res.status(500).json({
      error: "Unable to save period changes",
    });
  }
});

router.get("/exchange-rate", async (req, res) => {
  const { currency, date } = req.query ?? {};

  if (!currency || typeof currency !== "string") {
    return res.status(400).json({
      error: "Missing or invalid required query parameter 'currency'",
    });
  }

  const quoteCurrency = currency.trim().toUpperCase();

  if (!quoteCurrency) {
    return res.status(400).json({
      error: "Currency cannot be empty",
    });
  }

  let parsedDate = null;
  if (date) {
    parsedDate = new Date(date);
    if (Number.isNaN(parsedDate.getTime())) {
      return res.status(400).json({
        error: "Invalid 'date'; expected ISO date string (YYYY-MM-DD)",
      });
    }
  }

  try {
    const rate = await getExchangeRate(
      "USD",
      quoteCurrency,
      parsedDate || undefined
    );

    if (rate === null) {
      return res.status(502).json({
        error: "Unable to fetch exchange rate for the requested currency/date",
      });
    }

    const asOf = (parsedDate || new Date()).toISOString().slice(0, 10);

    return res.json({
      baseCurrency: "USD",
      quoteCurrency,
      asOfDate: asOf,
      rate,
    });
  } catch (error) {
    console.error("Failed to fetch USD exchange rate:", error);
    return res.status(500).json({
      error: "Failed to fetch USD exchange rate",
    });
  }
});

module.exports = router;
