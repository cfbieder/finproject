import { describe, it, expect, beforeEach, vi } from "vitest";
import { useState } from "react";
import { act, renderHook } from "@testing-library/react";
import { HeaderPeriodProvider } from "./HeaderPeriodContext.jsx";
import {
  describePeriod,
  useHeaderPeriod,
  useHeaderPeriodReload,
  useOnHeaderPeriodChange,
} from "./headerPeriod.js";

/** CR105 S2 — the Workbench header period. */
const wrapper = ({ children }) => <HeaderPeriodProvider>{children}</HeaderPeriodProvider>;

describe("describePeriod", () => {
  const today = { year: 2026, month: 11, day: 18 };

  it("reads the current month as of today, never its future month-end", () => {
    const p = describePeriod(2026, 11, today);
    expect(p.isCurrent).toBe(true);
    expect(p.asOf).toBe("2026-11-18");
    expect(p.monthEnd).toBe("2026-11-30");
  });

  it("reads a past month as of its last day", () => {
    const p = describePeriod(2024, 2, today);
    expect(p.asOf).toBe("2024-02-29");
    expect(p.monthStart).toBe("2024-02-01");
    expect(p.yearStart).toBe("2024-01-01");
    expect(p.mm).toBe("02");
    expect(p.key).toBe("2024-02");
  });
});

describe("HeaderPeriodProvider", () => {
  beforeEach(() => sessionStorage.clear());

  it("is absent outside the Workbench layout", () => {
    const { result } = renderHook(() => useHeaderPeriod());
    expect(result.current).toBeNull();
  });

  it("ignores a stored month in the future", () => {
    sessionStorage.setItem("wbPeriod", "2999-01");
    const { result } = renderHook(() => useHeaderPeriod(), { wrapper });
    expect(result.current.isCurrent).toBe(true);
  });

  it("calls the change hook on a change, not on mount", () => {
    const cb = vi.fn();
    const { result } = renderHook(
      () => {
        useOnHeaderPeriodChange(cb);
        return useHeaderPeriod();
      },
      { wrapper }
    );
    expect(cb).not.toHaveBeenCalled();
    act(() => result.current.setPeriod(2025, 3));
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0].key).toBe("2025-03");
    expect(sessionStorage.getItem("wbPeriod")).toBe("2025-03");
  });

  it("reloads once, with the state that apply() set — not the previous render's", () => {
    const seen = [];
    const { result } = renderHook(
      () => {
        const hp = useHeaderPeriod();
        const [date, setDate] = useState("2026-01-31");
        useHeaderPeriodReload((p) => setDate(p.asOf), () => seen.push(date));
        return hp;
      },
      { wrapper }
    );
    expect(seen).toEqual([]);
    act(() => result.current.setPeriod(2025, 3));
    expect(seen).toEqual(["2025-03-31"]);
  });
});
