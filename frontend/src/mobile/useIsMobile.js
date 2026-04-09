/**
 * useIsMobile — detects when the mobile shell should be shown.
 *
 * Returns true when EITHER of:
 *   - The page is running as an installed PWA (display-mode: standalone), OR
 *   - The viewport is <= MOBILE_BREAKPOINT pixels wide.
 *
 * Honored escape hatch: if localStorage["forceDesktop"] === "true", always
 * returns false so desktop users on a small window can opt back into the
 * full experience.
 */

import { useEffect, useState } from "react";

export const MOBILE_BREAKPOINT = 640;
const FORCE_DESKTOP_KEY = "forceDesktop";

function detect() {
  if (typeof window === "undefined") return false;
  try {
    if (window.localStorage.getItem(FORCE_DESKTOP_KEY) === "true") return false;
  } catch {
    // localStorage may be unavailable (private mode) — fall through
  }
  const standalone =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(display-mode: standalone)").matches;
  const narrow = window.innerWidth <= MOBILE_BREAKPOINT;
  return standalone || narrow;
}

export default function useIsMobile() {
  const [isMobile, setIsMobile] = useState(detect);

  useEffect(() => {
    const update = () => setIsMobile(detect());
    window.addEventListener("resize", update);

    const mq =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(display-mode: standalone)")
        : null;
    if (mq?.addEventListener) mq.addEventListener("change", update);

    const onStorage = (e) => {
      if (e.key === FORCE_DESKTOP_KEY) update();
    };
    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("storage", onStorage);
      if (mq?.removeEventListener) mq.removeEventListener("change", update);
    };
  }, []);

  return isMobile;
}

export function setForceDesktop(value) {
  try {
    if (value) {
      window.localStorage.setItem(FORCE_DESKTOP_KEY, "true");
    } else {
      window.localStorage.removeItem(FORCE_DESKTOP_KEY);
    }
    // Notify same-tab listeners (storage event only fires cross-tab)
    window.dispatchEvent(new StorageEvent("storage", { key: FORCE_DESKTOP_KEY }));
  } catch {
    // ignore
  }
}

export function isForceDesktop() {
  try {
    return window.localStorage.getItem(FORCE_DESKTOP_KEY) === "true";
  } catch {
    return false;
  }
}
