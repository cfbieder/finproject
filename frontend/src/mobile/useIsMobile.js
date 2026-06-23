/**
 * useIsMobile — detects when the mobile shell should be shown.
 *
 * Returns true when EITHER:
 *   - The viewport is <= MOBILE_BREAKPOINT pixels wide, OR
 *   - The device has a coarse (touch) pointer AND the viewport is
 *     <= TOUCH_BREAKPOINT wide.
 *
 * The mobile shell is driven by viewport WIDTH, not pointer type or display-mode.
 * We learned the hard way that pointer media queries can't be trusted: a
 * touchscreen LAPTOP can report a coarse primary pointer with NO fine pointer
 * anywhere (any-pointer:fine === false), making it indistinguishable from a phone
 * by pointer alone. An earlier attempt to special-case the installed PWA on
 * "touch-only" devices therefore pinned such a laptop to the mobile shell. Width
 * is the only reliable signal that separates a laptop window from a phone, so an
 * installed PWA (display-mode: standalone) is treated exactly like a browser tab:
 * a wide window renders desktop, a phone-width window renders the mobile shell.
 *
 * Trade-off: a wide touch-only TABLET installed as a PWA now gets the desktop
 * layout (hover-based sidebar), because it reports the same width + coarse pointer
 * as a touchscreen laptop and the two cannot be told apart. Acceptable — laptops
 * are the case that must work.
 *
 * The touch clause closes the 641–900px "dead band": above 640px a phone in
 * landscape (or a small touch tablet) used to fall through to the desktop
 * sidebar, which CSS renders as an icon-only rail whose sub-navigation only
 * opens on hover/focus — unreachable by a finger. TOUCH_BREAKPOINT matches the
 * Sidebar.css auto-rail breakpoint so a touch device in that band gets the
 * working bottom-tab shell instead. Narrow *mouse* windows below TOUCH_BREAKPOINT
 * (fine pointer, so no touchRail) still get the desktop layout.
 *
 * Escape hatch: if localStorage["forceDesktop"] === "true" the mobile shell is
 * suppressed — BUT only when the viewport is wider than MOBILE_BREAKPOINT, so a
 * phone can't get stuck on the unusable hover sidebar. This also auto-frees a
 * phone previously trapped by the "Switch to desktop view" button.
 */

import { useEffect, useState } from "react";

export const MOBILE_BREAKPOINT = 640;
// Keep in sync with the auto-rail @media breakpoint in components/Sidebar/Sidebar.css.
export const TOUCH_BREAKPOINT = 900;
const FORCE_DESKTOP_KEY = "forceDesktop";

/** True when the device's primary pointer is coarse (touch) — phones/tablets. */
export function isCoarsePointer() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches
  );
}

function detect() {
  if (typeof window === "undefined") return false;
  const hasMM = typeof window.matchMedia === "function";
  const coarse = hasMM && window.matchMedia("(pointer: coarse)").matches;
  try {
    // forceDesktop is honored unless the viewport is phone-narrow — below
    // MOBILE_BREAKPOINT the desktop sidebar rail is unusable, so a phone can't
    // get stuck on it; any wider device may opt out.
    if (
      window.innerWidth > MOBILE_BREAKPOINT &&
      window.localStorage.getItem(FORCE_DESKTOP_KEY) === "true"
    ) {
      return false;
    }
  } catch {
    // localStorage may be unavailable (private mode) — fall through
  }
  // Drive the mobile shell off viewport WIDTH, not pointer type or display-mode.
  // Pointer/any-pointer can't be trusted: a touchscreen LAPTOP can report pure
  // coarse with NO fine pointer (any-pointer:fine === false), making it
  // indistinguishable from a phone by pointer alone — so a wide installed PWA
  // would wrongly pin to the mobile shell. Width is the only reliable signal that
  // separates a laptop window from a phone, so an installed PWA follows the same
  // width rule as a browser tab: a wide window renders desktop, a phone-width
  // window renders the mobile shell. (Trade-off: a wide touch-only tablet PWA
  // gets the desktop layout, since it reports the same as a touchscreen laptop.)
  const narrow = window.innerWidth <= MOBILE_BREAKPOINT;
  const touchRail = coarse && window.innerWidth <= TOUCH_BREAKPOINT;
  return Boolean(narrow || touchRail);
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
