/** CR105 S2 — the header period's provider; the hooks and helpers are in headerPeriod.js. */
import { useMemo, useState } from "react";
import { HeaderPeriodContext, KEY, describePeriod, pad, readStored } from "./headerPeriod.js";

export function HeaderPeriodProvider({ children }) {
  const [ym, setYm] = useState(readStored);

  const value = useMemo(() => {
    const setPeriod = (year, month) => {
      try {
        sessionStorage.setItem(KEY, `${year}-${pad(month)}`);
      } catch {
        /* storage blocked — the choice lasts for this page view */
      }
      setYm({ year, month });
    };
    return { ...describePeriod(ym.year, ym.month), setPeriod };
  }, [ym]);

  return <HeaderPeriodContext.Provider value={value}>{children}</HeaderPeriodContext.Provider>;
}
