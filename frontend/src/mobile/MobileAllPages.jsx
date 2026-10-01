import { useNavigate } from "react-router-dom";
import MobileSheet from "./MobileSheet";
import { getSidebarNav } from "../config/routes.jsx";
import { DESKTOP_PREFIX } from "./desktopPages";

/**
 * Every desktop page, grouped as the desktop sidebar groups them. Each opens in
 * the mobile shell at `/m/d/<path>` (see MobileDesktopPage). Rarely used, so it
 * lives behind the top bar's menu button rather than on the home launcher.
 */
export default function MobileAllPages({ open, onClose }) {
  const navigate = useNavigate();
  const go = (path) => {
    onClose();
    navigate(`${DESKTOP_PREFIX}${path === "/" ? "" : path}`);
  };
  const groups = getSidebarNav().filter((g) => !g.divider && !g.single && g.items?.length);

  return (
    <MobileSheet open={open} title="All pages (desktop layout)" onClose={onClose}>
      <div className="m-picker__list">
        {groups.map((g) => (
          <div key={g.key}>
            <div className="m-picker__group-h">{g.label}</div>
            {g.items
              // A parameterised route (`/balances/:view`) is not a page by itself.
              .filter((r) => !r.path.includes(":"))
              .map((r) => (
                <button key={r.path} type="button" className="m-picker__item" onClick={() => go(r.path)}>
                  {r.label}
                </button>
              ))}
          </div>
        ))}
      </div>
    </MobileSheet>
  );
}
