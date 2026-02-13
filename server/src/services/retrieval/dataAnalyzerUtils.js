/******************************************************************************************************
 * Data Analyzer Utilities
 * Chris Biedermann
 * V1.0
 * November 2025
 * Primaryly calls
 * (1)  for checking integrity between account names and COA files
 *      reportMissingAccounts({filePath for account names}, {filePath for COA}), reportUnknownCoaAccounts({filePath for account names}, {filePath for COA})
 * (2)  for writing unique account names from the psModel to a JSON file
 *      writeAccountNamesFile({psModel}, {outputPath})
 * (3)  helper function for reading and parsing a JSON file from the given path
 *      readJson({filePath})
 * (4)  helper function for getting a USD currency formatter
 *      getUsdCurrencyFormatter()
 *******************************************************************************************************/

const fs = require("fs");
const path = require("path");
const {
  PROJECT_ROOT,
  COMPONENTS_DATA_DIR,
  resolveDataPath,
} = require("../../utils/dataPaths");

const resolveInputPath = (filePath) => {
  const normalized =
    typeof filePath === "string" && filePath.trim().length > 0
      ? filePath.trim()
      : null;
  if (!normalized) {
    throw new Error("A valid file path is required");
  }

  const candidate = path.isAbsolute(normalized)
    ? normalized
    : path.resolve(PROJECT_ROOT, normalized);

  if (fs.existsSync(candidate)) {
    return candidate;
  }

  const componentsCandidate = path.join(
    COMPONENTS_DATA_DIR,
    path.basename(normalized)
  );
  if (fs.existsSync(componentsCandidate)) {
    return componentsCandidate;
  }

  return candidate;
};

// USD Currency Formatter
const usdCurrencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/*********************************************************************
 * DataAnalyzerUtils
 *
 * Utility class for checking integrity between account names and COA files
 *********************************************************************/

// Utility class for checking integrity between account names and COA files
class DataAnalyzerUtils {
  // Writes unique account names from the psModel to a JSON file
  static async writeAccountNamesFile(psModel, outputPath) {
    if (!psModel || typeof psModel.distinct !== "function") {
      throw new TypeError("psModel with a distinct function is required");
    }

    const names = await psModel.distinct("Account").exec();
    console.log("[DA] Count Unique Account Names: %d", names.length);

    const accounts = {};
    for (let i = 0; i < names.length; i += 1) {
      const name = names[i];
      if (typeof name === "string" && name.length > 0) {
        accounts[name] = "";
      }
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(accounts, null, 2) + "\n");
    console.log("[DA] Account names saved to %s", outputPath);
  }
  // Writes unique category names from the psModel to a JSON file
  static async writeCategoryNamesFile(psModel, outputPath) {
    if (!psModel || typeof psModel.distinct !== "function") {
      throw new TypeError("psModel with a distinct function is required");
    }

    const names = await psModel.distinct("Category").exec();
    console.log("[DA] Count Unique Category Names: %d", names.length);

    const categories = {};
    for (let i = 0; i < names.length; i += 1) {
      const name = names[i];
      if (typeof name === "string" && name.length > 0) {
        categories[name] = "";
      }
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(categories, null, 2) + "\n");
    console.log("[DA] Category names saved to %s", outputPath);
  }

  // Reads and parses a JSON file from the given path
  static readJson(filePath) {
    const resolved = resolveInputPath(filePath);
    return JSON.parse(fs.readFileSync(resolved, "utf8"));
  }

  // Helper function that recursively collects unique strings from a nested structure
  static collectCoaStrings(root, includeFn) {
    if (!root) {
      return new Set();
    }

    const shouldInclude =
      typeof includeFn === "function" ? includeFn : () => true;
    const results = new Set();
    const stack = [root];

    while (stack.length) {
      const value = stack.pop();

      if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed && shouldInclude(trimmed)) {
          results.add(trimmed);
        }
        continue;
      }

      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i += 1) {
          stack.push(value[i]);
        }
        continue;
      }

      if (value && typeof value === "object") {
        for (const child of Object.values(value)) {
          stack.push(child);
        }
      }
    }

    return results;
  }

  /************************************************************
   * Integrity Check Functions (PostgreSQL-backed)
   ************************************************************/

  /**
   * Get all active account names from the PostgreSQL accounts table.
   * @param {string} [section] - Optional section filter ('balance_sheet' or 'profit_loss')
   * @param {boolean} [leafOnly=false] - If true, exclude parent accounts (those that have children)
   */
  static async getCoaAccountNames(section, { leafOnly = false } = {}) {
    const db = require("../../v2/db");
    const conditions = ["is_active = TRUE"];
    const params = [];
    let paramIndex = 1;
    if (section) {
      conditions.push(`section = $${paramIndex++}`);
      params.push(section);
    }
    if (leafOnly) {
      conditions.push(
        "id NOT IN (SELECT DISTINCT parent_id FROM accounts WHERE parent_id IS NOT NULL AND is_active = TRUE)"
      );
    }
    const sql = `SELECT name FROM accounts WHERE ${conditions.join(" AND ")} ORDER BY name`;
    const result = await db.query(sql, params);
    return new Set(result.rows.map((r) => r.name));
  }

  // Reports account names that are missing from the COA (accounts table)
  static async reportMissingAccounts(accountNamesPath) {
    const accountNamesFile = resolveDataPath(
      typeof accountNamesPath === "string" && accountNamesPath.trim()
        ? accountNamesPath
        : null,
      "account_names.json"
    );

    const accountNamesData = this.readJson(accountNamesFile);
    const coaAccounts = await this.getCoaAccountNames();

    const missing = [];
    for (const name of Object.keys(accountNamesData)) {
      if (name && !coaAccounts.has(name)) {
        missing.push(name);
      }
    }

    return {
      missingAccounts: missing,
      missingCount: missing.length,
      status: missing.length ? "missing" : "ok",
    };
  }

  // Reports category names that are missing from the COA P&L section
  static async reportMissingCategories(categoryNamesPath) {
    const categoryNamesFile = resolveDataPath(
      typeof categoryNamesPath === "string" && categoryNamesPath.trim()
        ? categoryNamesPath
        : null,
      "category_names.json"
    );

    const categoryNamesData = this.readJson(categoryNamesFile);
    const coaCategories = await this.getCoaAccountNames("profit_loss");

    const missing = [];
    for (const name of Object.keys(categoryNamesData)) {
      if (name && !coaCategories.has(name)) {
        missing.push(name);
      }
    }

    return {
      missingCategories: missing,
      missingCount: missing.length,
      status: missing.length ? "missing" : "ok",
    };
  }

  // Reports COA accounts that are unknown in the account names file
  static async reportUnknownCoaAccounts(accountNamesPath) {
    const accountNamesFile = resolveDataPath(
      typeof accountNamesPath === "string" && accountNamesPath.trim()
        ? accountNamesPath
        : null,
      "account_names.json"
    );
    const accountNamesData = this.readJson(accountNamesFile);
    const knownAccounts = new Set(
      Object.keys(accountNamesData).filter(
        (name) => typeof name === "string" && name.length > 0
      )
    );

    const coaAccounts = await this.getCoaAccountNames("balance_sheet", { leafOnly: true });
    const unknown = [];
    for (const name of coaAccounts) {
      if (!knownAccounts.has(name)) {
        unknown.push(name);
      }
    }

    return {
      status: "ok",
      unknownAccounts: unknown,
      unknownCount: unknown.length,
    };
  }

  // Reports COA categories that are unknown in the category names file
  static async reportUnknownCoaCategories(categoryNamesPath) {
    const categoryNamesFile = resolveDataPath(
      typeof categoryNamesPath === "string" && categoryNamesPath.trim()
        ? categoryNamesPath
        : null,
      "category_names.json"
    );
    const categoryNamesData = this.readJson(categoryNamesFile);
    const knownCategories = new Set(
      Object.keys(categoryNamesData).filter(
        (name) => typeof name === "string" && name.length > 0
      )
    );

    const coaCategories = await this.getCoaAccountNames("profit_loss", { leafOnly: true });
    const unknown = [];
    for (const name of coaCategories) {
      if (!knownCategories.has(name)) {
        unknown.push(name);
      }
    }

    return {
      status: "ok",
      unknownCategories: unknown,
      unknownCount: unknown.length,
    };
  }

  /************************
   * Helper Functions
   ************************/

  static getUsdCurrencyFormatter() {
    return usdCurrencyFormatter;
  }
}

module.exports = DataAnalyzerUtils;
