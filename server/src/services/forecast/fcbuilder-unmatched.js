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
      if (section && typeof section === "object" && section["Balance Sheet Accounts"]) {
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
  const stack = Array.isArray(balanceSheetSection)
    ? balanceSheetSection.slice()
    : [balanceSheetSection];

  while (stack.length) {
    const current = stack.pop();
    if (typeof current === "string") {
      accounts.push(current);
    } else if (Array.isArray(current)) {
      for (let i = 0; i < current.length; i++) {
        stack.push(current[i]);
      }
    } else if (current && typeof current === "object") {
      for (const key in current) {
        stack.push(current[key]);
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
    if (!matchedNames.has(account)) {
      unmatched.push(account);
    }
  }

  return unmatched;
}

module.exports = { getUnmatchedAccounts };
