const express = require("express");
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const { COMPONENTS_DATA_DIR } = require("../utils/dataPaths");
const FCModule = require("../../../components/models/FCModule");

const router = express.Router();
const { getUnmatchedAccounts } = require("../services/forecast/fcbuilder-unmatched");

router.get("/modules", async (req, res) => {
  try {
    const entries = await FCModule.find({}).lean().exec();
    res.json(entries);
  } catch (error) {
    console.error("Failed to load forecast entries:", error);
    res.status(500).json({ error: "Failed to load forecast entries" });
  }
});

router.get("/modules/unmatched", async (req, res) => {
  const scenario = req.query.scenario;
  try {
    const unmatched = await getUnmatchedAccounts(scenario);
    return res.json(unmatched);
  } catch (error) {
    console.error("Failed to load unmatched modules:", error);
    return res.status(500).json({ error: "Failed to load unmatched modules" });
  }
});

const normalizeModules = (raw) => {
  if (!raw) {
    return [];
  }
  if (Array.isArray(raw)) {
    return raw;
  }
  if (Array.isArray(raw.modules)) {
    return raw.modules;
  }
  if (Array.isArray(raw.items)) {
    return raw.items;
  }
  return [raw];
};

router.post("/modules", async (req, res) => {
  const modules = normalizeModules(req.body).filter(
    (entry) => entry && typeof entry === "object"
  );

  if (!modules.length) {
    return res.status(400).json({ error: "No valid module payload provided" });
  }

  try {
    const inserted = await FCModule.insertMany(modules, { ordered: false });
    return res
      .status(201)
      .json({ insertedCount: Array.isArray(inserted) ? inserted.length : 0 });
  } catch (error) {
    console.error("Failed to add forecast modules:", error);
    return res.status(500).json({ error: "Failed to add forecast modules" });
  }
});

router.put("/modules/:id", async (req, res) => {
  const { id } = req.params;

  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: "Invalid module identifier" });
  }

  if (!req.body || typeof req.body !== "object") {
    return res.status(400).json({ error: "No module fields provided" });
  }

  try {
    const updated = await FCModule.findByIdAndUpdate(id, req.body, {
      new: true,
      runValidators: true,
    })
      .lean()
      .exec();

    if (!updated) {
      return res.status(404).json({ error: "Forecast module not found" });
    }
    return res.json({ module: updated });
  } catch (error) {
    console.error("Failed to update forecast module:", error);
    return res.status(500).json({ error: "Failed to update forecast module" });
  }
});

router.delete("/modules/:id", async (req, res) => {
  const { id } = req.params;
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: "Invalid module identifier" });
  }

  try {
    const deleted = await FCModule.findByIdAndDelete(id).lean().exec();
    if (!deleted) {
      return res.status(404).json({ error: "Forecast module not found" });
    }
    return res.json({ deleted: true });
  } catch (error) {
    console.error("Failed to delete forecast module:", error);
    return res.status(500).json({ error: "Failed to delete forecast module" });
  }
});

// FCAssump.json handlers
const FC_ASSUMP_PATH = path.join(COMPONENTS_DATA_DIR, "FCAssump.json");

const readFCAssump = () => {
  if (!fs.existsSync(FC_ASSUMP_PATH)) {
    return null;
  }
  const raw = fs.readFileSync(FC_ASSUMP_PATH, "utf8");
  return raw.trim() ? JSON.parse(raw) : {};
};

const writeFCAssump = (payload) => {
  fs.mkdirSync(path.dirname(FC_ASSUMP_PATH), { recursive: true });
  fs.writeFileSync(FC_ASSUMP_PATH, JSON.stringify(payload, null, 2));
};

router.get("/assumptions", (req, res) => {
  try {
    const data = readFCAssump();
    if (data === null) {
      return res.status(404).json({ error: "FCAssump.json not found" });
    }
    return res.json(data);
  } catch (error) {
    console.error("Failed to read FCAssump.json:", error);
    return res.status(500).json({ error: "Failed to read FCAssump.json" });
  }
});

router.get("/assumptions/sections/:sections", (req, res) => {
  const sectionsParam = req.params.sections ?? "";
  const sections = sectionsParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!sections.length) {
    return res.status(400).json({ error: "At least one section is required" });
  }

  try {
    const data = readFCAssump();
    if (data === null) {
      return res.status(404).json({ error: "FCAssump.json not found" });
    }

    const result = {};
    for (const section of sections) {
      if (Object.prototype.hasOwnProperty.call(data, section)) {
        result[section] = data[section];
      }
    }

    if (!Object.keys(result).length) {
      return res
        .status(404)
        .json({ error: "Requested section(s) not found in FCAssump.json" });
    }

    return res.json(result);
  } catch (error) {
    console.error("Failed to read FCAssump section(s):", error);
    return res
      .status(500)
      .json({ error: "Failed to read FCAssump section(s)" });
  }
});

router.put("/assumptions", (req, res) => {
  const payload = req.body;

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return res
      .status(400)
      .json({ error: "A valid JSON object payload is required" });
  }

  try {
    writeFCAssump(payload);
    return res.json({ replaced: true });
  } catch (error) {
    console.error("Failed to replace FCAssump.json:", error);
    return res.status(500).json({ error: "Failed to replace FCAssump.json" });
  }
});

router.post("/assumptions/:section", (req, res) => {
  const { section } = req.params;
  const payload = req.body;

  if (!section || typeof section !== "string") {
    return res.status(400).json({ error: "A section is required" });
  }

  if (!payload || typeof payload !== "object") {
    return res.status(400).json({ error: "A valid payload is required" });
  }

  try {
    const data = readFCAssump() ?? {};

    if (data[section] && !Array.isArray(data[section])) {
      return res
        .status(400)
        .json({ error: `Section '${section}' is not an array` });
    }

    const sectionData = Array.isArray(data[section]) ? data[section] : [];
    sectionData.push(payload);
    data[section] = sectionData;

    writeFCAssump(data);

    return res.status(201).json({
      section,
      index: sectionData.length - 1,
    });
  } catch (error) {
    console.error("Failed to append FCAssump entry:", error);
    return res.status(500).json({ error: "Failed to append FCAssump entry" });
  }
});

router.put("/assumptions/:section/:index", (req, res) => {
  const { section } = req.params;
  const index = Number.parseInt(req.params.index, 10);
  const payload = req.body;

  if (!Number.isInteger(index) || index < 0) {
    return res.status(400).json({ error: "Invalid index" });
  }

  if (!payload || typeof payload !== "object") {
    return res.status(400).json({ error: "A valid payload is required" });
  }

  try {
    const data = readFCAssump();
    if (data === null) {
      return res.status(404).json({ error: "FCAssump.json not found" });
    }

    if (!Array.isArray(data[section])) {
      return res
        .status(400)
        .json({ error: `Section '${section}' is not an array` });
    }

    if (index >= data[section].length) {
      return res.status(404).json({ error: "Index out of range" });
    }

    data[section][index] = payload;
    writeFCAssump(data);

    return res.json({ updated: true, section, index });
  } catch (error) {
    console.error("Failed to update FCAssump entry:", error);
    return res.status(500).json({ error: "Failed to update FCAssump entry" });
  }
});

router.delete("/assumptions/:section/:index", (req, res) => {
  const { section } = req.params;
  const index = Number.parseInt(req.params.index, 10);

  if (!Number.isInteger(index) || index < 0) {
    return res.status(400).json({ error: "Invalid index" });
  }

  try {
    const data = readFCAssump();
    if (data === null) {
      return res.status(404).json({ error: "FCAssump.json not found" });
    }

    if (!Array.isArray(data[section])) {
      return res
        .status(400)
        .json({ error: `Section '${section}' is not an array` });
    }

    if (index >= data[section].length) {
      return res.status(404).json({ error: "Index out of range" });
    }

    const [removed] = data[section].splice(index, 1);
    writeFCAssump(data);

    return res.json({ deleted: true, removed });
  } catch (error) {
    console.error("Failed to delete FCAssump entry:", error);
    return res.status(500).json({ error: "Failed to delete FCAssump entry" });
  }
});

module.exports = router;
