/**
 * useIsMobile — detects when the mobile shell should be shown.
 *
 * Returns true when ANY of:
 *   - The page is running as an installed PWA (display-mode: standalone), OR
 *   - The viewport is <= MOBILE_BREAKPOINT pixels wide, OR
 *   - The device has a coarse (touch) pointer AND the viewport is
 *     <= TOUCH_BREAKPOINT wide.
 *
 * The touch clause closes the 641–900px "dead band": above 640px a phone in
 * landscape (or a small touch tablet) used to fall through to the desktop
 * sidebar, which CSS renders as an icon-only rail whose sub-navigation only
 * opens on hover/focus — unreachable by a finger. TOUCH_BREAKPOINT matches the
 * Sidebar.css auto-rail breakpoint so any touch device that would otherwise see
 * that rail gets the working bottom-tab shell instead. Narrow *mouse* windows
 * (fine pointer) stay on the desktop layout, as before.
 *
 * Honored escape hatch: if localStorage["forceDesktop"] === "true", always
 * returns false so desktop users on a small window can opt back into the
 * full experience.
 */

import { useEffect, useState } from "react";

export const MOBILE_BREAKPOINT = 640;
// Keep in sync with the auto-rail @media breakpoint in components/Sidebar/Sidebar.css.
export const TOUCH_BREAKPOINT = 900;
const FORCE_DESKTOP_KEY = "forceDesktop";

function detect() {
  if (typeof window === "undefined") return false;
  try {
    if (window.localStorage.getItem(FORCE_DESKTOP_KEY) === "true") return false;
  } catch {
    // localStorage may be unavailable (private mode) — fall through
  }
  const hasMM = typeof window.matchMedia === "function";
  const standalone = hasMM && window.matchMedia("(display-mode: standalone)").matches;
  const coarse = hasMM && window.matchMedia("(pointer: coarse)").matches;
  const narrow = window.innerWidth <= MOBILE_BREAKPOINT;
  const touchRail = coarse && window.innerWidth <= TOUCH_BREAKPOINT;
  return Boolean(standalone || narrow || touchRail);
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
