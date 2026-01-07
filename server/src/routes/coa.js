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

const deleteCoaEntry = (data, pathParts, targetName) => {
  if (!Array.isArray(data) || !Array.isArray(pathParts) || pathParts.length === 0) {
    return false;
  }

  const parentPath = pathParts.slice(0, -1);
  const nameToDelete = targetName || pathParts[pathParts.length - 1];

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

  const idxString = current.findIndex((item) => item === nameToDelete);
  if (idxString !== -1) {
    current.splice(idxString, 1);
    return true;
  }

  const idxObject = current.findIndex(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      Object.prototype.hasOwnProperty.call(entry, nameToDelete)
  );
  if (idxObject !== -1) {
    current.splice(idxObject, 1);
    return true;
  }

  return false;
};

const addCoaEntry = (data, pathParts, entry) => {
  if (!Array.isArray(data) || !Array.isArray(pathParts) || pathParts.length === 0) {
    return { ok: false, reason: "invalid" };
  }
  const name = entry?.name;
  if (!name) {
    return { ok: false, reason: "invalid" };
  }

  let current = data;
  for (const key of pathParts) {
    const match = current.find(
      (item) =>
        item &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        Object.prototype.hasOwnProperty.call(item, key)
    );
    if (!match) return { ok: false, reason: "not_found" };
    current = match[key];
    if (!Array.isArray(current)) return { ok: false, reason: "not_found" };
  }

  const exists = current.some((item) => {
    if (typeof item === "string") return item === name;
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return Object.prototype.hasOwnProperty.call(item, name);
    }
    return false;
  });
  if (exists) {
    return { ok: false, reason: "exists" };
  }

  if (entry.isCategory) {
    current.push({ [name]: [] });
  } else {
    current.push(name);
  }

  return { ok: true };
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

router.post("/delete", async (req, res) => {
  try {
    const { path: pathParts, name } = req.body || {};
    if (!Array.isArray(pathParts) || pathParts.length === 0) {
      return res.status(400).json({ error: "Invalid path" });
    }
    const targetName = String(name || pathParts[pathParts.length - 1] || "");
    if (!targetName) {
      return res.status(400).json({ error: "Missing account name" });
    }

    const coaData = await loadJson(dataPaths.coa);
    const deleted = deleteCoaEntry(coaData, pathParts, targetName);
    if (!deleted) {
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
    if (traits[targetName]) {
      delete traits[targetName];
      await saveJson(COA_TRAITS_PATH, traits);
    }

    return res.json({ success: true, deleted: true, name: targetName });
  } catch (error) {
    console.error("[COA] Failed to delete entry:", error);
    return res.status(500).json({ error: "Failed to delete COA entry" });
  }
});

router.post("/add", async (req, res) => {
  try {
    const { path: pathParts, name, type, currency, accountNumber, isCategory } =
      req.body || {};
    if (!Array.isArray(pathParts) || pathParts.length === 0) {
      return res.status(400).json({ error: "Invalid path" });
    }
    const trimmedName = String(name || "").trim();
    if (!trimmedName) {
      return res.status(400).json({ error: "Missing account name" });
    }

    const coaData = await loadJson(dataPaths.coa);
    const result = addCoaEntry(coaData, pathParts, {
      name: trimmedName,
      isCategory: Boolean(isCategory),
    });
    if (!result.ok) {
      if (result.reason === "exists") {
        return res.status(409).json({ error: "COA entry already exists." });
      }
      if (result.reason === "not_found") {
        return res
          .status(404)
          .json({ error: "COA entry not found for the provided path." });
      }
      return res.status(400).json({ error: "Invalid request" });
    }
    await saveJson(dataPaths.coa, coaData);
    cachedCoa = null;

    if (!isCategory) {
      let traits = {};
      try {
        traits = await loadJson(COA_TRAITS_PATH);
      } catch (error) {
        traits = {};
      }
      traits[trimmedName] = {
        Type: type || "",
        Currency: currency || "",
        AccountNumber: accountNumber || "",
      };
      await saveJson(COA_TRAITS_PATH, traits);
    }

    return res.json({
      success: true,
      added: true,
      name: trimmedName,
    });
  } catch (error) {
    console.error("[COA] Failed to add entry:", error);
    return res.status(500).json({ error: "Failed to add COA entry" });
  }
});

module.exports = router;
