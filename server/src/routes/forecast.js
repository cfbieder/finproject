const express = require("express");
const mongoose = require("mongoose");
const FCModule = require("../../../components/models/FCModule");

const router = express.Router();

router.get("/modules", async (req, res) => {
  try {
    const entries = await FCModule.find({}).lean().exec();
    res.json(entries);
  } catch (error) {
    console.error("Failed to load forecast entries:", error);
    res.status(500).json({ error: "Failed to load forecast entries" });
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

router.patch("/modules/:id", async (req, res) => {
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

module.exports = router;
