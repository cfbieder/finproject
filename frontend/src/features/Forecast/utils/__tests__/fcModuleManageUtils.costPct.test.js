import { describe, it, expect } from "vitest";
import { formatTransferForm, normalizeTransfers } from "../fcModuleManageUtils.js";

/**
 * CR078 — a disposal's selling cost must survive a LOAD → SAVE round-trip.
 *
 * `formatTransferForm` rebuilt each row from Date/Amount/Value/Flag/DateEnd and dropped
 * `CostPct`, so the editor rendered the field blank and the next save wrote NULL. That is
 * how `2026 Base` lost the 2% business selling cost on two modules on 2026-08-16 while
 * every variant kept it. `normalizeTransfers` (the save side) was already correct, which is
 * why a save-only test never saw it.
 */
describe("formatTransferForm → normalizeTransfers keeps CostPct", () => {
  const roundTrip = (rows) => normalizeTransfers(formatTransferForm(rows));

  it("keeps a set selling cost", () => {
    const [row] = roundTrip([{ Date: "2036-07-01", Amount: 0, Flag: "Full", CostPct: 2 }]);
    expect(row.CostPct).toBe(2);
  });

  it("keeps a typed 0 — 'considered, and free' is not 'not modelled'", () => {
    const [row] = roundTrip([{ Date: "2036-07-01", Amount: 0, Flag: "Full", CostPct: 0 }]);
    expect(row.CostPct).toBe(0);
  });

  it("leaves an unset cost absent rather than inventing one", () => {
    const [row] = roundTrip([{ Date: "2036-07-01", Amount: 0, Flag: "Full", CostPct: null }]);
    expect("CostPct" in row).toBe(false);
  });
});
