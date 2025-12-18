/******************************************************************************************************
 * Balance Sheet Fetcher
 * Chris Biedermann
 * V1.0
 * November 2025
 * Purpose: Fetch balance sheet data for accounts as of a given date.
 *
 * (1) Build balance sheet report using COA structure and fetched balances
 *    - buildBalanceSheetReport(coaPath, accountNamesPath, asOfDate, outputToFile)
 * (2) Get the balance of a specific account as of a given date
 *   - getAccountBalanceAsOf(accountName, asOfDate)
 * (3) Get the account record with the highest ID for a given account filter
 *  - getAccountRecordWithHighestId(accountFilter)
 * (4) Resolve account names from various input formats
 *  - resolveAccountNames(accountData)
 *
 *
 * Dependencies:
 * - PSdata Mongoose model
 *
 * Exports:
 * - BalanceSheetFetcher class
 * Methods:
 *  - fetchAccountBalances(accountData, asOfDate)
 *  - buildBalanceSheetReport(coaPath, accountNamesPath, asOfDate)
 *  - getAccountBalanceAsOf(accountName, asOfDate)
 * - getAccountRecordWithHighestId(accountFilter)
 * - resolveAccountNames(accountData)
 * Helper Functions:
 * - buildBalanceSheetNode(name, value, accountBalances)
 * - getUsdBalance(accountName, accountBalances)
 * *****************************************************************************************************
 * Change Log:
 * November 2025: Initial version created.
 * *****************************************************************************************************/

const fs = require("fs");
const path = require("path");
const frankfurterExchangeRates = require("../../utils/frankfurterExchangeRates");
const getPsDataModel = () =>
  require("../../../../components/models/PSdata");
const { dataPaths, resolveDataPath } = require("../../utils/dataPaths");

const PROJECT_ROOT = path.resolve(__dirname, "../../../..");
const resolveFromRoot = (value, fallbackRelative) => {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (normalized) {
    return path.isAbsolute(normalized)
      ? normalized
      : path.join(PROJECT_ROOT, normalized);
  }
  return path.join(PROJECT_ROOT, fallbackRelative);
};
const DEFAULT_ACCOUNT_NAMES_PATH = dataPaths.accountNames;
const DEFAULT_COA_PATH = dataPaths.coa;

console.log("Using COA Path:", process.env.ACCOUNT_NAMES_PATH);

/**
 * Fetches balance sheet data for accounts as of a given date.
 */
class BalanceSheetFetcher {
  constructor({
    psDataModel,
    exchangeRateProvider,
    accountNamesPath,
    coaPath,
  } = {}) {
    this.psDataModel = psDataModel || getPsDataModel();
    this.exchangeRateProvider =
      exchangeRateProvider || frankfurterExchangeRates;
    this.accountNamesPath = accountNamesPath
      ? resolveDataPath(accountNamesPath, "account_names.json")
      : DEFAULT_ACCOUNT_NAMES_PATH;
    this.coaPath = coaPath
      ? resolveDataPath(coaPath, "coa.json")
      : DEFAULT_COA_PATH;
  }

  // Fetch account balances for given file with account data as of a specific date
  async fetchAccountBalances(accountData, asOfDate) {
    const accountNames = await this.resolveAccountNames(accountData);
    if (!accountNames.length) {
      return {};
    }

    const accountBalances = await Promise.all(
      accountNames.map((accountName) =>
        this.getAccountBalanceAsOf(accountName, asOfDate)
      )
    );
    return accountBalances.reduce(
      (acc, balance) => Object.assign(acc, balance),
      {}
    );
  }

  // Build balance sheet report using COA structure and fetched balances
  async buildBalanceSheetReport(asOfDate, outputToFile = false) {
    const accountBalances = await this.fetchAccountBalances(
      this.accountNamesPath,
      asOfDate
    );

    if (!accountBalances || typeof accountBalances !== "object") {
      return {};
    }

    const coaData = JSON.parse(fs.readFileSync(this.coaPath, "utf8"));
    //const coaData = readJson(this.coaPath);
    const balanceSheetEntry =
      Array.isArray(coaData) &&
      coaData.find(
        (entry) =>
          entry &&
          typeof entry === "object" &&
          Object.prototype.hasOwnProperty.call(entry, "Balance Sheet Accounts")
      );

    if (!balanceSheetEntry) {
      return {};
    }

    const structure = balanceSheetEntry["Balance Sheet Accounts"];
    const nodes = [];
    for (let i = 0; i < structure.length; i += 1) {
      const item = structure[i];
      if (!item || typeof item !== "object") {
        continue;
      }

      for (const [name, value] of Object.entries(item)) {
        const node = buildBalanceSheetNode(name, value, accountBalances);
        if (node) {
          nodes.push(node);
        }
      }
    }

    const report = { "Balance Sheet Accounts": nodes };

    if (outputToFile) {
      const reportPath = path.join(
        resolveFromRoot(
          process.env.BALANCE_SHEET_REPORT_PATH,
          "components/reports/balance_sheet_report.json"
        )
      );
      try {
        await fs.promises.mkdir(path.dirname(reportPath), { recursive: true });
        await fs.promises.writeFile(
          reportPath,
          JSON.stringify(report, null, 2),
          "utf8"
        );
      } catch (err) {
        console.warn("Failed to write balance sheet report:", err);
      }
    }

    return report;
  }

  // Get the balance of a specific account as of a given date
  async getAccountBalanceAsOf(accountName, asOfDate) {
    const record = await this.getAccountRecordWithHighestId({
      Account: accountName,
      Date: asOfDate,
    });

    if (!record) {
      return { [accountName]: [null, 0, null, 0] };
    }

    const currency =
      typeof record.Currency === "string" && record.Currency.trim()
        ? record.Currency.trim().toUpperCase()
        : "USD";
    const balance = Number(record.ClosingBalance) || 0;

    let exchangeRate =
      currency === "USD"
        ? 1
        : await this.exchangeRateProvider.getExchangeRate(
            "USD",
            currency,
            asOfDate
          );
    if (typeof exchangeRate !== "number" || exchangeRate <= 0) {
      exchangeRate = 1;
    }

    const balanceInUSD = balance / exchangeRate;

    return {
      [accountName]: [currency, balance, exchangeRate, balanceInUSD],
    };
  }

  // Get the account record with the highest ID for a given account filter
  async getAccountRecordWithHighestId(accountFilter) {
    const accountName =
      typeof accountFilter === "string"
        ? accountFilter.trim()
        : accountFilter && typeof accountFilter.Account === "string"
        ? accountFilter.Account.trim()
        : "";

    if (!accountName) {
      throw new Error(
        "Account is required to find the record with the highest ID."
      );
    }

    const rawDate =
      accountFilter &&
      typeof accountFilter === "object" &&
      (accountFilter.Date ||
        accountFilter.date ||
        accountFilter.AsOfDate ||
        accountFilter.asOfDate);
    let asOfDate = null;
    if (rawDate) {
      asOfDate = rawDate instanceof Date ? rawDate : new Date(rawDate);
      if (Number.isNaN(asOfDate.getTime())) {
        throw new Error("Invalid date provided.");
      }
    } else {
      asOfDate = new Date();
    }

    const matchStage = { Account: accountName };
    if (asOfDate) {
      matchStage.Date = { $lte: asOfDate };
    }

    const record = await this.psDataModel
      .findOne(matchStage)
      .sort({ Date: -1, _id: -1 })
      .lean()
      .exec();

    return record || null;
  }

  // Resolve account names from various input formats
  async resolveAccountNames(accountData) {
    if (typeof accountData === "string") {
      try {
        const stats = await fs.promises.stat(accountData);
        if (stats.isFile()) {
          accountData = await fs.promises.readFile(accountData, "utf8");
        }
      } catch (err) {
        // swallow error and treat data as JSON payload
      }
    }

    if (Array.isArray(accountData)) {
      return accountData;
    }

    if (typeof accountData === "string") {
      const parsedAccounts = JSON.parse(accountData);
      return Array.isArray(parsedAccounts)
        ? parsedAccounts
        : Object.keys(parsedAccounts);
    }

    if (accountData && typeof accountData === "object") {
      return Object.keys(accountData);
    }

    return [];
  }
}

// Extract balance details for a specific account from account balances
function getAccountBalanceEntry(accountName, accountBalances) {
  if (!accountName || !accountBalances) {
    return null;
  }

  const entry = accountBalances[accountName];
  if (!Array.isArray(entry)) {
    return null;
  }

  const [currency, balance, exchangeRate, balanceInUSD] = entry;
  const parsedBalance = Number(balance);
  const parsedUsd = Number(balanceInUSD);

  return {
    currency: typeof currency === "string" ? currency : null,
    balance: Number.isFinite(parsedBalance) ? parsedBalance : 0,
    exchangeRate: Number.isFinite(Number(exchangeRate))
      ? Number(exchangeRate)
      : null,
    balanceInUSD: Number.isFinite(parsedUsd) ? parsedUsd : 0,
  };
}

// Build a balance sheet node recursively
function buildBalanceSheetNode(name, value, accountBalances) {
  if (!name) {
    return null;
  }

  if (!Array.isArray(value)) {
    const accountName =
      typeof value === "string" && value.trim().length > 0
        ? value.trim()
        : name;
    const balanceEntry = getAccountBalanceEntry(accountName, accountBalances);
    const totalUSD = balanceEntry ? balanceEntry.balanceInUSD : 0;
    const node = { name, totalUSD };
    if (balanceEntry) {
      node.currency = balanceEntry.currency;
      node.total = balanceEntry.balance;
    }
    return node;
  }

  const children = [];
  let totalUSD = 0;
  for (let i = 0; i < value.length; i += 1) {
    const entry = value[i];
    if (typeof entry === "string") {
      const accountName = entry.trim();
      if (!accountName) {
        continue;
      }
      const balanceEntry = getAccountBalanceEntry(accountName, accountBalances);
      const childBalance = balanceEntry ? balanceEntry.balanceInUSD : 0;
      const childNode = { name: accountName, totalUSD: childBalance };
      if (balanceEntry) {
        childNode.currency = balanceEntry.currency;
        childNode.total = balanceEntry.balance;
      }
      children.push(childNode);
      totalUSD += childBalance;
      continue;
    }

    if (entry && typeof entry === "object") {
      for (const [childName, childValue] of Object.entries(entry)) {
        const childNode = buildBalanceSheetNode(
          childName,
          childValue,
          accountBalances
        );
        if (childNode) {
          children.push(childNode);
          totalUSD += childNode.totalUSD || 0;
        }
      }
    }
  }

  return { name, totalUSD, children };
}

// Get USD balance for a specific account from account balances
function getUsdBalance(accountName, accountBalances) {
  if (!accountName || !accountBalances) {
    return 0;
  }

  const entry = accountBalances[accountName];
  if (!entry || typeof entry[3] !== "number") {
    return 0;
  }

  return entry[3];
}

module.exports = BalanceSheetFetcher;
