/**
 * Forecast Routes Module
 *
 * This module provides RESTful API endpoints for managing forecast data,
 * including forecast modules, assumptions, scenarios, and related metadata.
 *
 * =============================================================================
 * ROUTES SUMMARY
 * =============================================================================
 *
 * FORECAST MODULES (Database-backed via FCModule model)
 * -----------------------------------------------------------------------------
 * GET    /modules                     - Retrieve all forecast modules
 * GET    /modules/unmatched           - Get unmatched accounts for a scenario
 *                                       Query: ?scenario=<scenario_name>
 * POST   /modules                     - Create new forecast module(s)
 *                                       Accepts single object, array, or wrapped formats
 * PUT    /modules/:id                 - Update a specific forecast module by ID
 * DELETE /modules/:id                 - Delete a specific forecast module by ID
 *
 * FORECAST ASSUMPTIONS (File-backed via FCAssump.json)
 * -----------------------------------------------------------------------------
 * GET    /assumptions                 - Retrieve entire FCAssump.json file
 * GET    /assumptions/sections/:sections
 *                                     - Get specific sections (comma-separated)
 *                                       Example: /assumptions/sections/revenue,expenses
 * PUT    /assumptions                 - Replace entire FCAssump.json file
 * POST   /assumptions/:section        - Append new entry to an array section
 * PUT    /assumptions/:section/:index - Update specific entry in array section
 * DELETE /assumptions/:section/:index - Delete specific entry from array section
 *
 * FORECAST SCENARIOS (Database-backed via FCEntries model)
 * -----------------------------------------------------------------------------
 * GET    /scenarios                   - List all distinct scenarios
 * GET    /scenarios/years/:scenario   - Get distinct years for a scenario
 * GET    /scenarios/accounts/:scenario - Get distinct accounts for a scenario
 * GET    /scenarios/modules/:scenario - Get distinct modules for a scenario
 *
 * =============================================================================
 */

const express = require("express");
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const { COMPONENTS_DATA_DIR } = require("../utils/dataPaths");
const FCModule = require("../../../components/models/FCModule");
const FCEntries = require("../../../components/models/FCEntries");

const router = express.Router();
const {
  getUnmatchedAccounts,
} = require("../services/forecast/fcbuilder-unmatched");

// =============================================================================
// FORECAST MODULE ROUTES (Database Operations)
// =============================================================================

/**
 * GET /modules
 *
 * Retrieves all forecast modules from the database.
 *
 * @returns {Array} Array of forecast module objects
 * @throws {500} If database query fails
 */
router.get("/modules", async (req, res) => {
  try {
    const entries = await FCModule.find({}).lean().exec();
    res.json(entries);
  } catch (error) {
    console.error("Failed to load forecast entries:", error);
    res.status(500).json({ error: "Failed to load forecast entries" });
  }
});

/**
 * GET /modules/unmatched
 *
 * Retrieves accounts that are not matched to any forecast modules
 * for a specific scenario.
 *
 * @query {string} scenario - The scenario name to check for unmatched accounts
 * @returns {Array} Array of unmatched account objects
 * @throws {500} If query fails or service encounters an error
 */
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

/**
 * Normalizes various input formats into a consistent array of modules.
 *
 * Handles multiple input formats:
 * - Direct array: [module1, module2]
 * - Wrapped in 'modules' property: { modules: [...] }
 * - Wrapped in 'items' property: { items: [...] }
 * - Single object: { ...module }
 *
 * @param {*} raw - Raw input data in various possible formats
 * @returns {Array} Normalized array of module objects
 */
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
  // Treat single object as array with one element
  return [raw];
};

/**
 * POST /modules
 *
 * Creates one or more new forecast modules. Accepts multiple payload formats
 * and normalizes them before insertion. Sets default values for financial fields.
 *
 * Accepts formats:
 * - Single object: { ...module fields }
 * - Array: [{ ...module1 }, { ...module2 }]
 * - Wrapped: { modules: [...] } or { items: [...] }
 *
 * @body {Object|Array} Module data in any supported format
 * @returns {Object} { insertedCount: number } - Count of successfully inserted modules
 * @throws {400} If no valid modules provided in payload
 * @throws {500} If database insertion fails
 */
router.post("/modules", async (req, res) => {
  // Normalize input and ensure all required fields have default values
  const modules = normalizeModules(req.body)
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      ...entry,
      BaseValue: entry.BaseValue ?? 0,
      BaseValueUSD: entry.BaseValueUSD ?? 0,
      MarketValue: entry.MarketValue ?? 0,
      MarketValueUSD: entry.MarketValueUSD ?? 0,
    }));

  if (!modules.length) {
    return res.status(400).json({ error: "No valid module payload provided" });
  }

  try {
    // Use ordered: false to continue inserting even if some documents fail
    const inserted = await FCModule.insertMany(modules, { ordered: false });
    return res
      .status(201)
      .json({ insertedCount: Array.isArray(inserted) ? inserted.length : 0 });
  } catch (error) {
    console.error("Failed to add forecast modules:", error);
    return res.status(500).json({ error: "Failed to add forecast modules" });
  }
});

/**
 * PUT /modules/:id
 *
 * Updates an existing forecast module with new field values.
 * Runs Mongoose validators to ensure data integrity.
 *
 * @param {string} id - MongoDB ObjectId of the module to update
 * @body {Object} Fields to update (partial update supported)
 * @returns {Object} { module: updatedModuleObject }
 * @throws {400} If module ID is invalid or no fields provided
 * @throws {404} If module with given ID not found
 * @throws {500} If database update fails
 */
router.put("/modules/:id", async (req, res) => {
  const { id } = req.params;

  // Validate MongoDB ObjectId format
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: "Invalid module identifier" });
  }

  if (!req.body || typeof req.body !== "object") {
    return res.status(400).json({ error: "No module fields provided" });
  }

  try {
    const updated = await FCModule.findByIdAndUpdate(id, req.body, {
      new: true, // Return the modified document
      runValidators: true, // Enforce schema validation
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

/**
 * DELETE /modules/:id
 *
 * Deletes a forecast module from the database.
 *
 * @param {string} id - MongoDB ObjectId of the module to delete
 * @returns {Object} { deleted: true }
 * @throws {400} If module ID is invalid
 * @throws {404} If module with given ID not found
 * @throws {500} If database deletion fails
 */
router.delete("/modules/:id", async (req, res) => {
  const { id } = req.params;

  // Validate MongoDB ObjectId format
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

// =============================================================================
// FORECAST ASSUMPTIONS ROUTES (File Operations)
// =============================================================================

// Path to the FCAssump.json file in the components data directory
const FC_ASSUMP_PATH = path.join(COMPONENTS_DATA_DIR, "FCAssump.json");

/**
 * Reads and parses the FCAssump.json file.
 *
 * @returns {Object|null} Parsed JSON object, empty object if file is empty, or null if file doesn't exist
 * @throws {Error} If JSON parsing fails
 */
const readFCAssump = () => {
  if (!fs.existsSync(FC_ASSUMP_PATH)) {
    return null;
  }
  const raw = fs.readFileSync(FC_ASSUMP_PATH, "utf8");
  return raw.trim() ? JSON.parse(raw) : {};
};

/**
 * Writes data to the FCAssump.json file with pretty formatting.
 * Creates the directory structure if it doesn't exist.
 *
 * @param {Object} payload - Data to write to the file
 * @throws {Error} If file write operation fails
 */
const writeFCAssump = (payload) => {
  fs.mkdirSync(path.dirname(FC_ASSUMP_PATH), { recursive: true });
  fs.writeFileSync(FC_ASSUMP_PATH, JSON.stringify(payload, null, 2));
};

/**
 * GET /assumptions
 *
 * Retrieves the entire FCAssump.json file contents.
 *
 * @returns {Object} Complete assumptions data
 * @throws {404} If FCAssump.json file doesn't exist
 * @throws {500} If file read or JSON parse fails
 */
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

/**
 * GET /assumptions/sections/:sections
 *
 * Retrieves specific sections from FCAssump.json.
 * Multiple sections can be requested using comma-separated values.
 *
 * Example: /assumptions/sections/revenue,expenses,growth
 *
 * @param {string} sections - Comma-separated list of section names
 * @returns {Object} Object containing only the requested sections
 * @throws {400} If no sections specified
 * @throws {404} If FCAssump.json not found or none of the requested sections exist
 * @throws {500} If file read fails
 */
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

    // Build result object with only requested sections that exist
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

/**
 * PUT /assumptions
 *
 * Replaces the entire FCAssump.json file with new data.
 * This is a destructive operation that overwrites all existing assumptions.
 *
 * @body {Object} Complete assumptions object to replace existing file
 * @returns {Object} { replaced: true }
 * @throws {400} If payload is not a valid JSON object
 * @throws {500} If file write fails
 */
router.put("/assumptions", (req, res) => {
  const payload = req.body;

  // Validate payload is a plain object (not array or null)
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

/**
 * POST /assumptions/:section
 *
 * Appends a new entry to an array section in FCAssump.json.
 * Creates the section as an array if it doesn't exist.
 *
 * Example: POST /assumptions/scenarios with body { name: "Q1 2024", ... }
 *
 * @param {string} section - Name of the section (must be or become an array)
 * @body {Object} Entry data to append to the section array
 * @returns {Object} { section: string, index: number } - Section name and index of new entry
 * @throws {400} If section name missing, payload invalid, or section exists but is not an array
 * @throws {500} If file operations fail
 */
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

    // Ensure section is an array or doesn't exist yet
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

/**
 * PUT /assumptions/:section/:index
 *
 * Updates a specific entry in an array section of FCAssump.json.
 *
 * Example: PUT /assumptions/scenarios/2 with body { name: "Updated Q3", ... }
 *
 * @param {string} section - Name of the array section
 * @param {number} index - Zero-based index of the entry to update
 * @body {Object} New data to replace the entry at the specified index
 * @returns {Object} { updated: true, section: string, index: number }
 * @throws {400} If index is invalid or section is not an array
 * @throws {404} If FCAssump.json not found or index out of range
 * @throws {500} If file operations fail
 */
router.put("/assumptions/:section/:index", (req, res) => {
  const { section } = req.params;
  const index = Number.parseInt(req.params.index, 10);
  const payload = req.body;

  // Validate index is a non-negative integer
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

/**
 * DELETE /assumptions/:section/:index
 *
 * Deletes a specific entry from an array section in FCAssump.json.
 *
 * Example: DELETE /assumptions/scenarios/2
 *
 * @param {string} section - Name of the array section
 * @param {number} index - Zero-based index of the entry to delete
 * @returns {Object} { deleted: true, removed: object } - Confirmation and removed entry
 * @throws {400} If index is invalid or section is not an array
 * @throws {404} If FCAssump.json not found or index out of range
 * @throws {500} If file operations fail
 */
router.delete("/assumptions/:section/:index", (req, res) => {
  const { section } = req.params;
  const index = Number.parseInt(req.params.index, 10);

  // Validate index is a non-negative integer
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

    // Remove the entry and capture it to return in response
    const [removed] = data[section].splice(index, 1);
    writeFCAssump(data);

    return res.json({ deleted: true, removed });
  } catch (error) {
    console.error("Failed to delete FCAssump entry:", error);
    return res.status(500).json({ error: "Failed to delete FCAssump entry" });
  }
});

// =============================================================================
// FORECAST SCENARIOS METADATA ROUTES
// =============================================================================

/**
 * GET /secnarios (NOTE: Contains typo - should be "scenarios")
 *
 * Retrieves all distinct scenario names from forecast entries.
 *
 * @returns {Object} { scenarios: Array<string> } - List of unique scenario names
 * @throws {500} If database query fails
 */
router.get("/scenarios", async (req, res) => {
  try {
    const scenarios = await FCEntries.distinct("Scenario").exec();
    return res.json({ scenarios });
  } catch (error) {
    console.error("Failed to load forecast scenarios:", error);
    return res.status(500).json({ error: "Failed to load forecast scenarios" });
  }
});

/**
 * GET /scenarios/years/:scenario
 *
 * Retrieves all distinct years for a specific scenario.
 *
 * @param {string} scenario - The scenario name to filter by
 * @returns {Object} { years: Array } - List of unique years for the scenario
 * @throws {400} If scenario parameter is missing or empty
 * @throws {500} If database query fails
 */
router.get("/scenarios/years/:scenario", async (req, res) => {
  const scenario = req.params.scenario?.trim();

  if (!scenario) {
    return res.status(400).json({ error: "Scenario name is required" });
  }

  try {
    const years = await FCEntries.distinct("Year", {
      Scenario: scenario,
    }).exec();
    return res.json({ years });
  } catch (error) {
    console.error("Failed to load forecast years:", error);
    return res.status(500).json({ error: "Failed to load forecast years" });
  }
});

/**
 * GET /entries
 *
 * Retrieves forecast entries, optionally filtered by scenario.
 *
 * @query {string} scenario - (optional) Scenario name to filter by
 * @returns {Object} { entries: Array<Object> } - List of forecast entries
 * @throws {500} If database query fails
 */
router.get("/entries", async (req, res) => {
  const scenario = req.query.scenario?.trim();
  const filter = scenario ? { Scenario: scenario } : {};

  try {
    const entries = await FCEntries.find(filter).lean().exec();
    return res.json({ entries });
  } catch (error) {
    console.error("Failed to load forecast entries:", error);
    return res.status(500).json({ error: "Failed to load forecast entries" });
  }
});

/**
 * GET /scenarios/accounts/:scenario
 *
 * Retrieves all distinct account names for a specific scenario.
 *
 * @param {string} scenario - The scenario name to filter by
 * @returns {Object} { accounts: Array<string> } - List of unique account names
 * @throws {400} If scenario parameter is missing or empty
 * @throws {500} If database query fails
 */
router.get("/scenarios/accounts/:scenario", async (req, res) => {
  const scenario = req.params.scenario?.trim();

  if (!scenario) {
    return res.status(400).json({ error: "Scenario name is required" });
  }

  try {
    const accounts = await FCEntries.distinct("Account", {
      Scenario: scenario,
    }).exec();
    return res.json({ accounts });
  } catch (error) {
    console.error("Failed to load forecast accounts:", error);
    return res.status(500).json({ error: "Failed to load forecast accounts" });
  }
});

/**
 * GET /scenarios/modules/:scenario
 *
 * Retrieves all distinct module names for a specific scenario.
 *
 * @param {string} scenario - The scenario name to filter by
 * @returns {Object} { modules: Array<string> } - List of unique module names
 * @throws {400} If scenario parameter is missing or empty
 * @throws {500} If database query fails
 */
router.get("/scenarios/modules/:scenario", async (req, res) => {
  const scenario = req.params.scenario?.trim();

  if (!scenario) {
    return res.status(400).json({ error: "Scenario name is required" });
  }

  try {
    const modules = await FCEntries.distinct("Module", {
      Scenario: scenario,
    }).exec();
    return res.json({ modules });
  } catch (error) {
    console.error("Failed to load forecast modules:", error);
    return res.status(500).json({ error: "Failed to load forecast modules" });
  }
});

module.exports = router;
