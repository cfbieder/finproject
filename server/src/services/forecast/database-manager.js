/**
 * Forecast Database Manager
 *
 * Handles all database operations for forecast generation:
 * - Connection management
 * - Module and entry queries
 * - Bulk operations
 * - Category aggregations
 */

const mongoose = require("../../../../components/node_modules/mongoose");
const FCModule = require("../../../../components/models/FCModule");
const FCEntries = require("../../../../components/models/FCEntries");
const FCIncExp = require("../../../../components/models/FCIncExp");
const { DEFAULTS } = require("./constants");

class ForecastDatabaseManager {
  /**
   * Creates a new database manager instance
   *
   * @param {string} mongoUri - MongoDB connection URI
   */
  constructor(mongoUri) {
    this.mongoUri = mongoUri || process.env.MONGO_URI || DEFAULTS.MONGO_URI;
  }

  /**
   * Ensures MongoDB connection is established
   *
   * @returns {Promise<void>}
   * @throws {Error} If connection fails
   */
  async ensureConnection() {
    if (mongoose.connection.readyState === 0 && this.mongoUri) {
      await mongoose.connect(this.mongoUri, {
        serverSelectionTimeoutMS: 1000,
      });
    }
  }

  /**
   * Loads all unique expense categories, income categories, and account names
   * for a given scenario from the FCModule collection
   *
   * @param {string} scenarioName - Scenario name
   * @returns {Promise<{expenseCategories: string[], incomeCategories: string[], accountNames: string[]}>}
   */
  async loadCategoriesForScenario(scenarioName) {
    if (!scenarioName || !this.mongoUri) {
      return {
        expenseCategories: [],
        incomeCategories: [],
        accountNames: [],
      };
    }

    await this.ensureConnection();

    const [result] =
      (await FCModule.aggregate([
        { $match: { Scenario: scenarioName } },
        {
          $group: {
            _id: null,
            expenseCategories: { $addToSet: "$ExpCategory" },
            incomeCategories: { $addToSet: "$IncomeCategory" },
            accountNames: { $addToSet: "$Account" },
          },
        },
      ])) || [];

    return {
      expenseCategories: result?.expenseCategories?.filter(Boolean) ?? [],
      incomeCategories: result?.incomeCategories?.filter(Boolean) ?? [],
      accountNames: result?.accountNames?.filter(Boolean) ?? [],
    };
  }

  /**
   * Loads all unique income/expense categories for a given scenario from FCIncExp
   *
   * @param {string} scenarioName - Scenario name
   * @returns {Promise<{incexpCategories: string[]}>}
   */
  async loadIncExpCategoriesForScenario(scenarioName) {
    if (!scenarioName || !this.mongoUri) {
      return { incexpCategories: [] };
    }

    await this.ensureConnection();

    const [result] =
      (await FCIncExp.aggregate([
        { $match: { Scenario: scenarioName } },
        {
          $group: {
            _id: null,
            incexpCategories: { $addToSet: "$Account" },
          },
        },
      ])) || [];

    return {
      incexpCategories: result?.incexpCategories?.filter(Boolean) ?? [],
    };
  }

  /**
   * Loads all forecast modules for a given scenario from the database
   *
   * @param {string} scenarioName - Scenario name
   * @returns {Promise<Array>} Array of FCModule documents
   */
  async loadModulesForScenario(scenarioName) {
    if (!scenarioName || !this.mongoUri) {
      return [];
    }

    await this.ensureConnection();

    return FCModule.find({ Scenario: scenarioName }).lean().exec();
  }

  /**
   * Loads all income/expense modules for a given scenario from the database
   *
   * @param {string} scenarioName - Scenario name
   * @returns {Promise<Array>} Array of FCIncExp documents
   */
  async loadIncExpModulesForScenario(scenarioName) {
    if (!scenarioName || !this.mongoUri) {
      return [];
    }

    await this.ensureConnection();

    return FCIncExp.find({ Scenario: scenarioName }).lean().exec();
  }

  /**
   * Clears all existing forecast entries for a given scenario
   * This ensures a clean slate before regenerating forecasts
   *
   * @param {string} scenarioName - Scenario name
   * @returns {Promise<number>} Number of deleted entries
   */
  async clearEntriesForScenario(scenarioName) {
    console.log(
      `[DB-MANAGER] Clearing existing entries for scenario ${scenarioName}...`
    );

    if (!scenarioName || !this.mongoUri) {
      return 0;
    }

    await this.ensureConnection();

    const { deletedCount = 0 } =
      (await FCEntries.deleteMany({ Scenario: scenarioName })) || {};

    if (deletedCount) {
      console.log(
        `[DB-MANAGER] Deleted ${deletedCount} entries for scenario ${scenarioName}`
      );
    }

    return deletedCount;
  }

  /**
   * Inserts multiple forecast entries into the database
   *
   * @param {Array<Object>} entries - Array of entry objects to insert
   * @returns {Promise<Array>} Array of inserted documents
   */
  async insertEntries(entries) {
    if (!entries || entries.length === 0) {
      return [];
    }

    await this.ensureConnection();

    return FCEntries.insertMany(entries, { ordered: false });
  }
}

module.exports = ForecastDatabaseManager;
