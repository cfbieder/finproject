import { describe, expect, test } from "vitest";
import {
  accountLabel,
  accountsByConnection,
  findReconnectDuplicates,
  unmappedAccounts,
} from "./feedMappings.js";

// Shapes are GET /api/v2/bank-feed/account-mappings rows; values are the live
// Wise specimen (CR091 U3): the reconnect of 2026-09-04 attached USD (1446)
// under a new id while the original stayed mapped.
const wiseUsd = {
  external_id: "6521708934254164984",
  name: "Christopher Biedermann (USD) (1446)",
  institution: "Wise",
  currency: "USD",
  mapped_account_id: 301,
  mapped_account_name: "Wise - USD",
  ignored: false,
  status: "mapped",
};
const specimen = {
  external_id: "acc_01M1R5KNQZJQ9DSMSP4J0ETFV9",
  name: "Christopher Biedermann (USD) (1446)",
  institution: "Wise",
  currency: "USD",
  mapped_account_id: null,
  mapped_account_name: null,
  ignored: false,
  status: "pending",
};
const wisePln = {
  external_id: "3020755806482258456",
  name: "Christopher Biedermann (PLN) (5413)",
  institution: "Wise",
  currency: "PLN",
  mapped_account_id: 302,
  mapped_account_name: "WISE - PLN",
  ignored: false,
  status: "mapped",
};

describe("findReconnectDuplicates", () => {
  test("flags an unmapped feed account with the same name and currency as a mapped one", () => {
    const d = findReconnectDuplicates([wiseUsd, specimen, wisePln]);
    expect(d).toHaveLength(1);
    expect(d[0].pending.external_id).toBe(specimen.external_id);
    expect(d[0].mapped.mapped_account_name).toBe("Wise - USD");
  });

  test("an IGNORED duplicate is resolved — prod's mapping 708 must not be flagged", () => {
    expect(findReconnectDuplicates([wiseUsd, { ...specimen, ignored: true, status: "ignored" }])).toEqual([]);
  });

  test("same name in another currency is a different account", () => {
    expect(findReconnectDuplicates([wiseUsd, { ...specimen, currency: "EUR" }])).toEqual([]);
  });

  test("case and surrounding whitespace do not hide a duplicate", () => {
    const d = findReconnectDuplicates([wiseUsd, { ...specimen, name: "  christopher biedermann (usd) (1446) " }]);
    expect(d).toHaveLength(1);
  });

  test("a match against an IGNORED row is not a duplicate of anything fed", () => {
    const ignoredOriginal = { ...wiseUsd, ignored: true, status: "ignored" };
    expect(findReconnectDuplicates([ignoredOriginal, specimen])).toEqual([]);
  });

  test("no mappings, no findings", () => {
    expect(findReconnectDuplicates(null)).toEqual([]);
    expect(findReconnectDuplicates([])).toEqual([]);
  });
});

describe("unmappedAccounts", () => {
  test("neither mapped nor ignored", () => {
    const ignored = { ...specimen, external_id: "x", ignored: true };
    expect(unmappedAccounts([wiseUsd, specimen, ignored]).map((m) => m.external_id)).toEqual([specimen.external_id]);
  });
});

describe("accountsByConnection + accountLabel (U1)", () => {
  test("groups accounts under their upstream connection and labels them the way the owner reads them", () => {
    const health = {
      [wiseUsd.external_id]: { connection_id: "conn_nordigen_533862072105943922" },
      [wisePln.external_id]: { connection_id: "conn_nordigen_6344798154455049865" },
      [specimen.external_id]: { connection_id: "conn_nordigen_6344798154455049865" },
    };
    const byConn = accountsByConnection([wiseUsd, wisePln, { ...specimen, ignored: true }], health);
    expect(byConn.get("conn_nordigen_533862072105943922").map(accountLabel)).toEqual(["Wise - USD (USD)"]);
    expect(byConn.get("conn_nordigen_6344798154455049865").map(accountLabel)).toEqual([
      "WISE - PLN (PLN)",
      "ignored: Christopher Biedermann (USD) (1446) (USD)",
    ]);
  });

  test("an unmapped account names itself; an account with no health entry is left out", () => {
    expect(accountLabel(specimen)).toBe("unmapped: Christopher Biedermann (USD) (1446) (USD)");
    expect(accountsByConnection([specimen], {}).size).toBe(0);
    expect(accountsByConnection([specimen], null).size).toBe(0);
  });
});
