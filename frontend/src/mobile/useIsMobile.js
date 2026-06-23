/**
 * useIsMobile — detects when the mobile shell should be shown.
 *
 * Returns true when ANY of:
 *   - The viewport is <= MOBILE_BREAKPOINT pixels wide, OR
 *   - The device is TOUCH-ONLY AND the viewport is <= TOUCH_BREAKPOINT wide, OR
 *   - The page is running as an installed PWA (display-mode: standalone) AND the
 *     device is TOUCH-ONLY.
 *
 * "Touch-only" means a coarse primary pointer with NO fine pointer available
 * anywhere (no any-pointer:fine) — i.e. a phone/tablet. A touchscreen LAPTOP also
 * reports a coarse primary pointer, but it exposes a fine pointer too (touchpad/
 * mouse), so it is NOT touch-only and gets the desktop layout. Keying off
 * any-pointer:fine (rather than coarse alone) is what separates the two: the
 * hover-based desktop sidebar is only unusable when there is no precise pointer
 * at all.
 *
 * Note: a standalone PWA on a laptop/desktop (any fine pointer present) is NOT
 * forced to mobile — it follows the same width rules as a browser tab, so a wide
 * installed window renders the desktop layout. Standalone only pins mobile on a
 * touch-only device installed to the home screen, where the sidebar is unusable.
 *
 * The touch clause closes the 641–900px "dead band": above 640px a phone in
 * landscape (or a small touch tablet) used to fall through to the desktop
 * sidebar, which CSS renders as an icon-only rail whose sub-navigation only
 * opens on hover/focus — unreachable by a finger. TOUCH_BREAKPOINT matches the
 * Sidebar.css auto-rail breakpoint so any touch-only device that would otherwise
 * see that rail gets the working bottom-tab shell instead. Narrow windows on a
 * device with a fine pointer stay on the desktop layout, as before.
 *
 * Escape hatch: if localStorage["forceDesktop"] === "true" the mobile shell is
 * suppressed — BUT only when a fine pointer is available. On a touch-only phone
 * the desktop sidebar rail is hover-only and unusable, so the flag is ignored
 * there. This also auto-frees a phone previously trapped by the (now touch-
 * hidden) "Switch to desktop view" button, with no need to clear storage by hand.
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
  // "Touch-only" = coarse primary pointer AND no fine pointer available anywhere.
  // This separates a phone/tablet (truly touch-only) from a touchscreen LAPTOP,
  // which reports a coarse primary pointer but ALSO exposes a fine pointer (its
  // touchpad/mouse) via any-pointer:fine. The hover-based desktop sidebar is only
  // unusable on touch-only devices; a touchscreen laptop can drive it with the
  // touchpad, so it should get the desktop layout, not the mobile shell.
  const anyFine = hasMM && window.matchMedia("(any-pointer: fine)").matches;
  const touchOnly = coarse && !anyFine;
  try {
    // forceDesktop is honored unless the device is touch-only — on a phone the
    // desktop sidebar rail is hover-only and unusable, so a trapped phone
    // recovers automatically rather than being held on the desktop layout.
    if (!touchOnly && window.localStorage.getItem(FORCE_DESKTOP_KEY) === "true") {
      return false;
    }
  } catch {
    // localStorage may be unavailable (private mode) — fall through
  }
  const standalone = hasMM && window.matchMedia("(display-mode: standalone)").matches;
  const narrow = window.innerWidth <= MOBILE_BREAKPOINT;
  const touchRail = touchOnly && window.innerWidth <= TOUCH_BREAKPOINT;
  // An installed PWA (display-mode: standalone) only forces the mobile shell on a
  // touch-only device (phone/tablet). A touchscreen laptop (coarse primary but a
  // fine pointer available) tracks the same width rules as a browser tab, so a
  // wide installed window renders the desktop layout instead of being pinned to
  // mobile purely because it's installed.
  const standaloneTouch = standalone && touchOnly;
  return Boolean(narrow || touchRail || standaloneTouch);
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
