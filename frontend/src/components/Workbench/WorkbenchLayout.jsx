/**
 * CR105 S1 — the Workbench shell: a 56px icon rail, the current section's
 * pages as header tabs, and the ⌘K palette / help drawer from CR026.
 * Selected per browser with localStorage.navLayout = "workbench" (Layout.jsx).
 * Pages render unchanged inside .page-shell.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { HelpCircle, Moon, Search, Sun, PanelLeft } from "lucide-react";
import CommandPalette from "../CommandPalette/CommandPalette";
import HelpPanel from "../HelpPanel/HelpPanel";
import Footer from "../Footer";
import useTheme from "../../hooks/useTheme";
import Rest from "../../js/rest.js";
import finMark from "../../assets/fin-mark.svg";
import { WORKBENCH_SECTIONS, findWorkbenchTab } from "./sections";
import { setNavLayout } from "./navLayout";
import HeaderPeriodPicker from "./HeaderPeriodPicker";
import ShortcutsSheet from "./ShortcutsSheet";
import { isTypingTarget, useGoChords } from "./keys";
import { HeaderPeriodProvider } from "../../contexts/HeaderPeriodContext";
import { InspectorPanel, InspectorProvider } from "../../contexts/InspectorContext.jsx";
import "./Workbench.css";

const isDev = import.meta.env.DEV || import.meta.env.VITE_APP_MODE === "dev";
const version = import.meta.env.VITE_APP_VERSION || "2.0.0";

/** Transactions waiting for review — the Inbox badge. Re-read on navigation. */
function useReviewCount(pathname) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let live = true;
    Rest.fetchJson("/api/v2/util/attention-summary")
      .then((s) => live && setCount(s?.review?.count || 0))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [pathname]);
  return count;
}

function RailLink({ section, active, badge }) {
  const Icon = section.icon;
  return (
    <Link
      to={section.tabs[0].path}
      className={`wb-rail__item${active ? " is-active" : ""}`}
      title={`${section.label} (g ${section.go})`}
      aria-label={badge > 0 ? `${section.label}, ${badge} to review` : section.label}
      // The tab, not the rail link, is the current page; the rail marks the section.
      aria-current={active ? "true" : undefined}
    >
      <Icon size={20} strokeWidth={1.8} />
      {badge > 0 && <span className="wb-rail__badge">{badge > 99 ? "99+" : badge}</span>}
    </Link>
  );
}

export default function WorkbenchLayout({ children }) {
  const { pathname } = useLocation();
  const { section, tab } = findWorkbenchTab(pathname);
  const { theme, toggle } = useTheme();
  const review = useReviewCount(pathname);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const navigate = useNavigate();
  useGoChords(WORKBENCH_SECTIONS, navigate);

  // "?" lists the shortcuts.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "?" || e.defaultPrevented || isTypingTarget(e)) return;
      e.preventDefault();
      setKeysOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const activeTabRef = useRef(null);

  // Keep the current tab in view when a section's tabs overflow a narrow window.
  useEffect(() => {
    activeTabRef.current?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [pathname]);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const main = WORKBENCH_SECTIONS.filter((s) => !s.foot);
  const foot = WORKBENCH_SECTIONS.filter((s) => s.foot);
  const isDark = theme === "dark";

  return (
    <HeaderPeriodProvider>
    <InspectorProvider>
    <div className="app-layout wb">
      <nav className={`wb-rail${isDev ? " wb-rail--dev" : ""}`} aria-label="Sections">
        <Link className="wb-rail__brand" to="/" title={`Fin v${version}${isDev ? " DEV" : ""}`}>
          <img src={finMark} alt="Fin" />
        </Link>
        {main.map((s) => (
          <RailLink
            key={s.key}
            section={s}
            active={section?.key === s.key}
            badge={s.key === "inbox" ? review : 0}
          />
        ))}
        <div className="wb-rail__foot">
          {foot.map((s) => (
            <RailLink key={s.key} section={s} active={section?.key === s.key} />
          ))}
          <button
            type="button"
            className="wb-rail__item"
            onClick={toggle}
            title={isDark ? "Light theme" : "Dark theme"}
            aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
          >
            {isDark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button
            type="button"
            className="wb-rail__item"
            onClick={() => setNavLayout("sidebar")}
            title="Classic layout"
            aria-label="Switch to the classic layout"
          >
            <PanelLeft size={18} />
          </button>
        </div>
      </nav>

      <div className="app-main">
        <header className="wb-top">
          {section && <span className="wb-top__section">{section.label}</span>}
          {section && section.tabs.length > 1 && (
            <nav className="wb-tabs" aria-label={`${section.label} pages`}>
              {section.tabs.map((t) => (
                <Link
                  key={t.path}
                  to={t.path}
                  ref={t === tab ? activeTabRef : undefined}
                  className={`wb-tab${t === tab ? " is-active" : ""}`}
                  aria-current={t === tab ? "page" : undefined}
                >
                  {t.label}
                </Link>
              ))}
            </nav>
          )}
          <div className="wb-top__right">
            {tab?.period && <HeaderPeriodPicker />}
            <button
              type="button"
              className="wb-top__cmd"
              onClick={() => setPaletteOpen(true)}
              aria-label="Open command palette"
            >
              <Search size={14} />
              <span className="wb-top__cmd-label">Search or jump to…</span>
              <kbd>⌘K</kbd>
            </button>
            <button
              type="button"
              className="wb-top__tool"
              onClick={() => setHelpOpen(true)}
              aria-label="Open help"
              title="Help"
            >
              <HelpCircle size={18} />
            </button>
          </div>
        </header>
        <div className="wb-work">
          <div className="page-content-area" key={pathname}>
            <div className="page-shell">{children}</div>
          </div>
          <InspectorPanel />
        </div>
        <Footer />
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <HelpPanel open={helpOpen} onClose={() => setHelpOpen(false)} />
      <ShortcutsSheet open={keysOpen} onClose={() => setKeysOpen(false)} />
    </div>
    </InspectorProvider>
    </HeaderPeriodProvider>
  );
}
