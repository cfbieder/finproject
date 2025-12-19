const fs = require("fs");
const path = require("path");
const mongoose = require("../../../../components/node_modules/mongoose");
const FCModule = require("../../../../components/models/FCModule");

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27018/fin";
const coaPath = path.join(__dirname, "../../../../components/data/coa.json");

const allAccounts = (() => {
  const raw = fs.readFileSync(coaPath, "utf8");
  const data = JSON.parse(raw);
  let balanceSheetSection = null;

  if (Array.isArray(data)) {
    for (let i = 0; i < data.length; i++) {
      const section = data[i];
      if (
        section &&
        typeof section === "object" &&
        section["Balance Sheet Accounts"]
      ) {
        balanceSheetSection = section["Balance Sheet Accounts"];
        break;
      }
    }
  } else if (data && typeof data === "object") {
    balanceSheetSection = data["Balance Sheet Accounts"];
  }

  if (!balanceSheetSection) {
    return [];
  }

  const accounts = [];
  const stack = [
    {
      node: Array.isArray(balanceSheetSection)
        ? balanceSheetSection.slice()
        : balanceSheetSection,
      category: null,
    },
  ];

  while (stack.length) {
    const { node, category } = stack.pop();

    if (typeof node === "string") {
      const isBankAccount =
        typeof category === "string" &&
        category.toLowerCase().includes("bank account");

      accounts.push({ name: node, category, isBankAccount });
      continue;
    }

    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        stack.push({ node: node[i], category });
      }
      continue;
    }

    if (node && typeof node === "object") {
      for (const key in node) {
        stack.push({ node: node[key], category: key });
      }
    }
  }

  return accounts;
})();

const matchedCache = new Map();

async function loadMatchedNames(scenarioName) {
  if (!scenarioName) {
    return new Set();
  }

  const cached = matchedCache.get(scenarioName);
  if (cached) {
    return cached;
  }

  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 1000 });
  }

  const modules = await FCModule.find(
    { Scenario: scenarioName, Matched: true },
    "Name"
  )
    .lean()
    .exec();

  const names = new Set();
  for (let i = 0; i < modules.length; i++) {
    const name = modules[i].Name;
    if (name) {
      names.add(name);
    }
  }

  matchedCache.set(scenarioName, names);
  return names;
}

async function getUnmatchedAccounts(scenarioName) {
  const matchedNames = await loadMatchedNames(scenarioName);
  const unmatched = [];

  for (let i = 0; i < allAccounts.length; i++) {
    const account = allAccounts[i];
    if (account.isBankAccount) {
      continue;
    }

    if (!matchedNames.has(account.name)) {
      unmatched.push(account);
    }
  }

  return unmatched;
}

module.exports = { getUnmatchedAccounts };
