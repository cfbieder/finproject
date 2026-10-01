import { matchPath } from "react-router-dom";
import { getRouterRoutes } from "../config/routes.jsx";

/** Where a desktop page lives inside the mobile shell (the "All pages" menu). */
export const DESKTOP_PREFIX = "/m/d";

/** The desktop route a `/m/d/...` path names, or null. */
export function desktopRouteFor(pathname) {
  const desktopPath = pathname.slice(DESKTOP_PREFIX.length) || "/";
  return getRouterRoutes().find((r) => matchPath({ path: r.path, end: true }, desktopPath)) || null;
}
