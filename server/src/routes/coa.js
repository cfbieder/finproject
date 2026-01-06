const express = require("express");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { dataPaths, COMPONENTS_DATA_DIR } = require("../utils/dataPaths");

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

const COA_TRAITS_PATH = path.join(COMPONENTS_DATA_DIR, "coa_traits.json");

const updateCoaEntryName = (data, pathParts, oldName, newName) => {
  if (!Array.isArray(data) || !Array.isArray(pathParts) || pathParts.length === 0)
    return false;

  const targetName = pathParts[pathParts.length - 1];
  const parentPath = pathParts.slice(0, -1);

  let current = data;
  for (const key of parentPath) {
    const match = current.find(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        !Array.isArray(entry) &&
        Object.prototype.hasOwnProperty.call(entry, key)
    );
    if (!match) return false;
    current = match[key];
    if (!Array.isArray(current)) return false;
  }

  const idxString = current.findIndex((item) => item === targetName);
  if (idxString !== -1) {
    current[idxString] = newName;
    return true;
  }

  for (let i = 0; i < current.length; i += 1) {
    const entry = current[i];
    if (
      entry &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      Object.prototype.hasOwnProperty.call(entry, targetName)
    ) {
      const value = entry[targetName];
      current[i] = { [newName]: value };
      return true;
    }
  }

  return false;
};

const loadJson = async (filePath) => {
  const raw = await fsp.readFile(filePath, "utf8");
  return JSON.parse(raw);
};

const saveJson = async (filePath, data) => {
  await fsp.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
};

router.post("/update", async (req, res) => {
  try {
    const { path: pathParts, oldName, name, type, currency, accountNumber } =
      req.body || {};
    if (!Array.isArray(pathParts) || pathParts.length === 0) {
      return res.status(400).json({ error: "Invalid path" });
    }
    if (!oldName || !name) {
      return res.status(400).json({ error: "Missing account name" });
    }

    const coaData = await loadJson(dataPaths.coa);
    const updated = updateCoaEntryName(
      coaData,
      pathParts,
      String(oldName),
      String(name)
    );
    if (!updated) {
      return res
        .status(404)
        .json({ error: "COA entry not found for the provided path/name." });
    }
    await saveJson(dataPaths.coa, coaData);
    cachedCoa = null;

    let traits = {};
    try {
      traits = await loadJson(COA_TRAITS_PATH);
    } catch (error) {
      traits = {};
    }
    const existingTraits = traits[oldName] || {};
    delete traits[oldName];
    traits[name] = {
      ...existingTraits,
      Type: type || existingTraits.Type || "",
      Currency: currency || existingTraits.Currency || "",
      AccountNumber: accountNumber || existingTraits.AccountNumber || "",
    };
    await saveJson(COA_TRAITS_PATH, traits);

    return res.json({
      success: true,
      updated: {
        name,
        type: traits[name].Type,
        currency: traits[name].Currency,
        accountNumber: traits[name].AccountNumber,
      },
    });
  } catch (error) {
    console.error("[COA] Failed to update entry:", error);
    return res.status(500).json({ error: "Failed to update COA entry" });
  }
});

module.exports = router;
