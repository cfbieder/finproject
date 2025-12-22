const express = require("express");
const fs = require("fs");
const { dataPaths } = require("../utils/dataPaths");

const router = express.Router();

let cachedCoa = null;

const loadCoa = () => {
  if (!cachedCoa) {
    const raw = fs.readFileSync(dataPaths.coa, "utf8");
    cachedCoa = JSON.parse(raw);
  }

  return cachedCoa;
};

const getSection = (sectionKey) => {
  const data = loadCoa();
  if (!Array.isArray(data)) {
    return null;
  }

  const entry = data.find(
    (item) => item && Object.prototype.hasOwnProperty.call(item, sectionKey)
  );
  return entry ? entry[sectionKey] : null;
};

router.get("/BalanceSheet", (req, res) => {
  try {
    const balanceSheet = getSection("Balance Sheet Accounts");
    if (!balanceSheet) {
      return res.status(404).json({
        error: "Balance Sheet Accounts not found in coa.json",
      });
    }

    return res.json(balanceSheet);
  } catch (error) {
    console.error("[COA] Failed to load Balance Sheet accounts:", error);
    return res.status(500).json({
      error: "Failed to load Balance Sheet accounts",
    });
  }
});

router.get("/CashFlow", (req, res) => {
  try {
    const profitAndLoss = getSection("Profit & Loss Accounts");
    if (!profitAndLoss) {
      return res.status(404).json({
        error: "Profit & Loss Accounts not found in coa.json",
      });
    }

    return res.json(profitAndLoss);
  } catch (error) {
    console.error("[COA] Failed to load Profit & Loss accounts:", error);
    return res.status(500).json({
      error: "Failed to load Profit & Loss accounts",
    });
  }
});

module.exports = router;
