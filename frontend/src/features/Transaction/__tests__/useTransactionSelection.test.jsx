import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTransactionSelection } from "../hooks/useTransactionSelection.js";

/**
 * Stale selections across a data reload (v3.6.2, owner-found).
 *
 * The selection Map persisted untouched when `transactions` changed, so a row
 * selected before a filter/period/account change stayed COUNTED while rendering
 * nowhere. The bar read "2 selected" with one row ticked, `isAllSelected` flipped
 * true (size === rows.length) so the header ticked itself, and any action gated on
 * a single selection — CR057's "Book at source" — silently vanished.
 *
 * Latent since the hook was written; v3.6.0 made it routine by turning the Ledger
 * category filter into a server-side refetch.
 */

const row = (id, date) => ({ _id: id, id, Date: date, Amount: 1, Category: "X" });

const A = row("a", "2025-09-24");
const B = row("b", "2026-05-26");
const C = row("c", "2026-06-01");

describe("useTransactionSelection — selections do not survive a reload", () => {
  it("drops a selection whose row is no longer in the list", () => {
    const { result, rerender } = renderHook(({ txns }) => useTransactionSelection(txns), {
      initialProps: { txns: [A, B] },
    });

    act(() => result.current.toggleRowSelection("a", A));
    expect(result.current.selectedRows.size).toBe(1);

    // The list is replaced (a refetch after changing the category filter). Row "a"
    // is gone; only "c" remains.
    rerender({ txns: [C] });
    expect(result.current.selectedRows.size).toBe(0);
  });

  it("reports exactly 1 when one visible row is picked after a reload", () => {
    const { result, rerender } = renderHook(({ txns }) => useTransactionSelection(txns), {
      initialProps: { txns: [A, C] },
    });

    act(() => result.current.toggleRowSelection("c", C));
    rerender({ txns: [A, B] });          // reload; "c" is gone, its selection stale
    act(() => result.current.toggleRowSelection("b", B));

    // The bug: 2 — the stale "c" plus the freshly picked "b", so a single-row
    // action stays hidden even though the user picked exactly one row.
    expect(result.current.selectedRows.size).toBe(1);
    expect([...result.current.selectedRows.keys()]).toEqual(["b"]);
  });

  it("does not tick select-all when only one of two rows is picked", () => {
    const { result, rerender } = renderHook(({ txns }) => useTransactionSelection(txns), {
      initialProps: { txns: [C] },
    });

    act(() => result.current.toggleRowSelection("c", C));
    rerender({ txns: [A, B] });          // "c" stale; 2 rows visible, none picked
    act(() => result.current.toggleRowSelection("a", A));

    // The bug: size 2 === rows 2 made isAllSelected true, ticking the header while
    // only one row was actually checked.
    expect(result.current.isAllSelected).toBe(false);
  });

  it("keeps a selection whose row is still present", () => {
    const { result, rerender } = renderHook(({ txns }) => useTransactionSelection(txns), {
      initialProps: { txns: [A, B] },
    });

    act(() => result.current.toggleRowSelection("a", A));
    rerender({ txns: [A, C] });          // "a" survives the reload
    expect(result.current.selectedRows.size).toBe(1);
    expect(result.current.selectedRows.has("a")).toBe(true);
  });

  it("still marks rows selected and supports select-all / clear", () => {
    const { result } = renderHook(() => useTransactionSelection([A, B]));

    act(() => result.current.handleSelectAllToggle());
    expect(result.current.selectedRows.size).toBe(2);
    expect(result.current.isAllSelected).toBe(true);
    expect(result.current.sortedTransactions.every((r) => r.isSelected)).toBe(true);

    act(() => result.current.clearSelection());
    expect(result.current.selectedRows.size).toBe(0);
  });
});
