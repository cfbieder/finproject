/**
 * UIPreview — non-functional mockup of the proposed CR026 UI revamp.
 *
 * Self-contained: no API calls, no shared chrome changes. Renders a mock
 * "app window" depicting the new collapsible sidebar, regrouped IA, top
 * utility strip (command palette + help + theme toggle), a refreshed
 * dashboard, and a phone mock. Light/dark is scoped to this page via local
 * design tokens on the root container (the same data-theme approach CR026
 * proposes globally), so toggling here does NOT affect the rest of the app.
 *
 * Reachable at /ui-preview (Settings landing). Delete with the route entry
 * if CR026 is shelved.
 */
import { useState } from "react";
import {
  LayoutDashboard,
  Receipt,
  Calculator,
  TrendingUp,
  BarChart3,
  HardDrive,
  Settings2,
  HelpCircle,
  Search,
  Moon,
  Sun,
  PanelLeftClose,
  PanelLeftOpen,
  Contrast,
  ChevronDown,
  ArrowLeftRight,
  BookOpen,
  FileSpreadsheet,
  RefreshCw,
  PlusCircle,
  Wallet,
  PieChart,
  LineChart,
  Upload,
  Database,
  Command,
  ArrowUp,
  ArrowDown,
  Bell,
  CircleUserRound,
} from "lucide-react";
import "./UIPreview.css";

/* ---- mock navigation model (the proposed CR026 IA) ---- */
const NAV = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, single: true },
  {
    id: "accounts",
    label: "Accounts & Transactions",
    icon: Receipt,
    children: [
      { label: "Actuals", icon: Receipt },
      { label: "Budget", icon: FileSpreadsheet },
      { label: "Ledger", icon: BookOpen },
      { label: "Transfer Analysis", icon: ArrowLeftRight },
      { label: "Refresh Feeds", icon: RefreshCw },
      { label: "Manual Entry", icon: PlusCircle },
    ],
  },
  {
    id: "budget",
    label: "Budget",
    icon: Calculator,
    children: [
      { label: "Worksheet", icon: FileSpreadsheet },
      { label: "Realization", icon: BarChart3 },
      { label: "Variances", icon: TrendingUp },
      { label: "FX Rates", icon: PieChart },
    ],
  },
  {
    id: "forecast",
    label: "Forecast",
    icon: TrendingUp,
    children: [
      { label: "1 · Inc/Exp Mapping", icon: ArrowLeftRight },
      { label: "2 · Scenarios", icon: BookOpen },
      { label: "3 · Modules", icon: Calculator },
      { label: "4 · Income/Expenses", icon: FileSpreadsheet },
      { label: "5 · Review", icon: LineChart },
    ],
  },
  {
    id: "reports",
    label: "Reports",
    icon: BarChart3,
    children: [
      { label: "Balance Summary", icon: Wallet },
      { label: "Cash Flow", icon: ArrowLeftRight },
      { label: "Balance Trends", icon: TrendingUp },
      { label: "Net Worth Chart", icon: LineChart },
    ],
  },
  { divider: true },
  {
    id: "data",
    label: "Data Sources",
    icon: HardDrive,
    children: [
      { label: "Upload CSV", icon: Upload },
      { label: "Bank Feed Setup", icon: RefreshCw },
      { label: "Quicken Import", icon: Database },
      { label: "Backup", icon: HardDrive },
    ],
  },
  { id: "settings", label: "Settings", icon: Settings2, single: true },
  { id: "help", label: "Help", icon: HelpCircle, single: true },
];

/* ---- mock dashboard data ---- */
const KPIS = [
  { label: "Net Worth", value: "$4.82M", delta: 2.3, up: true, hero: true, bars: [40, 44, 43, 48, 52, 55, 61] },
  { label: "Total Assets", value: "$5.41M", delta: 1.8, up: true, bars: [50, 52, 51, 56, 58, 60, 64] },
  { label: "Liabilities", value: "$0.59M", delta: -3.1, up: false, good: true, bars: [70, 66, 60, 58, 55, 52, 49] },
  { label: "Savings Rate", value: "38%", delta: 4.0, up: true, bars: [22, 28, 25, 31, 34, 36, 38] },
];

const TX = [
  { name: "Fidelity — Dividend", cat: "Investment Income", amt: "+$1,240.00", up: true, when: "Today" },
  { name: "Bank Pekao — Rent PM4", cat: "Rental Income", amt: "+$2,310.00", up: true, when: "Today" },
  { name: "Amazon", cat: "Household", amt: "−$184.22", up: false, when: "Yesterday" },
  { name: "Wise — FX Transfer", cat: "Transfer · FX", amt: "−$5,000.00", up: false, when: "2 days ago" },
  { name: "Caixa — Mortgage", cat: "Interest", amt: "−$1,002.40", up: false, when: "3 days ago" },
];

const CATS = [
  { name: "Living Expenses", pct: 82, amt: "$4,120" },
  { name: "Property Costs", pct: 64, amt: "$3,210" },
  { name: "Travel", pct: 41, amt: "$2,060" },
  { name: "Household", pct: 28, amt: "$1,390" },
];

const PALETTE_ITEMS = [
  { icon: Wallet, label: "Go to Balance Summary", hint: "Reports" },
  { icon: PlusCircle, label: "Add manual transaction", hint: "Action" },
  { icon: LineChart, label: "Go to Forecast Review", hint: "Forecast" },
  { icon: RefreshCw, label: "Refresh feeds", hint: "Action" },
  { icon: Settings2, label: "Open Chart of Accounts", hint: "Settings" },
];

export default function UIPreview() {
  const [theme, setTheme] = useState("light");
  const [collapsed, setCollapsed] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [active, setActive] = useState("overview"); // single (Overview/Settings/Help)
  const [activeChild, setActiveChild] = useState(null); // { group, label } — leaf node
  const [paletteOpen, setPaletteOpen] = useState(false);

  const dark = theme === "dark";

  return (
    <div className="uiprev-page">
      {/* explainer / controls (real chrome, not part of the mock) */}
      <div className="uiprev-explainer">
        <div>
          <h1 className="uiprev-h1">UI Preview — CR026</h1>
          <p className="uiprev-sub">
            Non-functional mockup of the proposed new look. Toggle the controls to explore the sidebar
            (expanded / rail), light / dark theme, and the ⌘K command palette. Nothing here is wired to data.
          </p>
        </div>
        <div className="uiprev-controls">
          <button className="btn btn--outline btn--sm" onClick={() => setCollapsed((c) => !c)}>
            {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
            {collapsed ? "Expand sidebar" : "Collapse to rail"}
          </button>
          <button className="btn btn--outline btn--sm" onClick={() => setTheme(dark ? "light" : "dark")}>
            {dark ? <Sun size={15} /> : <Moon size={15} />}
            {dark ? "Light" : "Dark"}
          </button>
          <button className="btn btn--primary btn--sm" onClick={() => setPaletteOpen(true)}>
            <Command size={15} /> Command palette
          </button>
        </div>
      </div>

      {/* the mock app window */}
      <div className={`uiprev${collapsed ? " is-rail" : ""}`} data-theme={theme}>
        {/* sidebar */}
        <aside className="uiprev-side">
          <div className="uiprev-brand">
            <div className="uiprev-brand-mark">Fin</div>
            {!collapsed && (
              <div className="uiprev-brand-meta">
                <span className="uiprev-brand-name">Fin</span>
                <span className="uiprev-brand-ver">v2.15.1</span>
              </div>
            )}
          </div>

          <nav className="uiprev-nav">
            {NAV.map((item, i) => {
              if (item.divider) return <div key={`d${i}`} className="uiprev-nav-divider" />;
              const Icon = item.icon;
              const isOpen = expanded === item.id;
              if (item.single) {
                const isActive = active === item.id;
                return (
                  <button
                    key={item.id}
                    className={`uiprev-navitem${isActive ? " is-active" : ""}`}
                    onClick={() => {
                      setActive(item.id);
                      setActiveChild(null);
                    }}
                    title={collapsed ? item.label : undefined}
                  >
                    <Icon size={18} className="uiprev-navicon" />
                    {!collapsed && <span className="uiprev-navlabel">{item.label}</span>}
                  </button>
                );
              }
              // Parent group: clicking toggles disclosure only. It lights up
              // (is-active) when one of its leaves is the selected node, so the
              // active path stays visible without the parent being a target.
              const groupHasActiveChild = activeChild?.group === item.id;
              return (
                <div key={item.id} className="uiprev-navgroup">
                  <button
                    className={`uiprev-navitem${isOpen ? " is-open" : ""}${groupHasActiveChild ? " is-active" : ""}`}
                    onClick={() => setExpanded(isOpen ? null : item.id)}
                    title={collapsed ? item.label : undefined}
                  >
                    <Icon size={18} className="uiprev-navicon" />
                    {!collapsed && <span className="uiprev-navlabel">{item.label}</span>}
                    {!collapsed && (
                      <ChevronDown
                        size={15}
                        className={`uiprev-navchev${isOpen ? " is-open" : ""}`}
                      />
                    )}
                  </button>
                  {!collapsed && isOpen && (
                    <div className="uiprev-navchildren">
                      {item.children.map((c) => {
                        const CI = c.icon;
                        const childActive =
                          activeChild?.group === item.id && activeChild?.label === c.label;
                        return (
                          <button
                            key={c.label}
                            className={`uiprev-navchild${childActive ? " is-active" : ""}`}
                            onClick={() => {
                              setActiveChild({ group: item.id, label: c.label });
                              setActive(null);
                            }}
                          >
                            <CI size={15} className="uiprev-navicon" />
                            <span>{c.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>

          <div className="uiprev-side-footer">
            <button
              className="uiprev-themetoggle"
              onClick={() => setTheme(dark ? "light" : "dark")}
              title="Toggle light / dark"
            >
              <Contrast size={16} />
              {!collapsed && <span>Theme</span>}
            </button>
            <button
              className="uiprev-railtoggle"
              onClick={() => setCollapsed((c) => !c)}
              title={collapsed ? "Expand" : "Collapse"}
            >
              {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
              {!collapsed && <span>Collapse</span>}
            </button>
          </div>
        </aside>

        {/* main column */}
        <div className="uiprev-main">
          {/* top utility strip */}
          <header className="uiprev-strip">
            <div className="uiprev-crumbs">
              <span className="uiprev-crumb-muted">Overview</span>
            </div>
            <div className="uiprev-strip-actions">
              <button className="uiprev-cmd" onClick={() => setPaletteOpen(true)}>
                <Search size={14} />
                <span>Search or jump to…</span>
                <kbd className="uiprev-kbd">⌘K</kbd>
              </button>
              <button className="uiprev-tool" title="Help"><HelpCircle size={18} /></button>
              <button className="uiprev-tool" title="Notifications"><Bell size={18} /></button>
              <button
                className="uiprev-tool"
                title="Toggle theme"
                onClick={() => setTheme(dark ? "light" : "dark")}
              >
                {dark ? <Sun size={18} /> : <Moon size={18} />}
              </button>
              <button className="uiprev-tool" title="Account"><CircleUserRound size={20} /></button>
            </div>
          </header>

          {/* dashboard body */}
          <div className="uiprev-body">
            <div className="uiprev-pagehead">
              <div>
                <h2 className="uiprev-pagetitle">Good afternoon</h2>
                <p className="uiprev-pagesub">Here's where your finances stand as of Jun 4, 2026.</p>
              </div>
              <span className="uiprev-asof">As of today</span>
            </div>

            {/* KPI cards */}
            <div className="uiprev-kpis">
              {KPIS.map((k) => (
                <div key={k.label} className={`uiprev-kpi${k.hero ? " is-hero" : ""}`}>
                  <div className="uiprev-kpi-label">{k.label}</div>
                  <div className="uiprev-kpi-value">{k.value}</div>
                  <div className="uiprev-kpi-foot">
                    <span className={`uiprev-delta ${(k.good ? !k.up : k.up) ? "is-good" : "is-bad"}`}>
                      {k.up ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
                      {Math.abs(k.delta)}%
                    </span>
                    <div className="uiprev-spark">
                      {k.bars.map((b, i) => (
                        <span key={i} style={{ height: `${b}%` }} />
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* chart + lists */}
            <div className="uiprev-grid">
              <div className="uiprev-card uiprev-chartcard">
                <div className="uiprev-card-head">
                  <h3>Net worth over time</h3>
                  <div className="uiprev-pillrow">
                    <span className="uiprev-pill is-on">1Y</span>
                    <span className="uiprev-pill">3Y</span>
                    <span className="uiprev-pill">5Y</span>
                    <span className="uiprev-pill">Max</span>
                  </div>
                </div>
                <svg className="uiprev-chart" viewBox="0 0 600 200" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="uiprevFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" className="uiprev-fill-top" />
                      <stop offset="100%" className="uiprev-fill-bot" />
                    </linearGradient>
                  </defs>
                  <path
                    className="uiprev-area"
                    d="M0,150 C60,140 90,120 150,118 C220,116 250,95 320,90 C380,86 410,70 470,55 C520,44 560,38 600,30 L600,200 L0,200 Z"
                  />
                  <path
                    className="uiprev-line"
                    d="M0,150 C60,140 90,120 150,118 C220,116 250,95 320,90 C380,86 410,70 470,55 C520,44 560,38 600,30"
                  />
                </svg>
              </div>

              <div className="uiprev-card">
                <div className="uiprev-card-head"><h3>Top spending</h3></div>
                <div className="uiprev-bars">
                  {CATS.map((c) => (
                    <div key={c.name} className="uiprev-barrow">
                      <div className="uiprev-barrow-top">
                        <span>{c.name}</span>
                        <span className="uiprev-num">{c.amt}</span>
                      </div>
                      <div className="uiprev-bartrack">
                        <div className="uiprev-barfill" style={{ width: `${c.pct}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="uiprev-card uiprev-txcard">
                <div className="uiprev-card-head">
                  <h3>Recent transactions</h3>
                  <span className="uiprev-link">View all</span>
                </div>
                <div className="uiprev-txlist">
                  {TX.map((t, i) => (
                    <div key={i} className="uiprev-tx">
                      <div className={`uiprev-tx-dot ${t.up ? "is-good" : "is-bad"}`}>
                        {t.up ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
                      </div>
                      <div className="uiprev-tx-meta">
                        <span className="uiprev-tx-name">{t.name}</span>
                        <span className="uiprev-tx-cat">{t.cat} · {t.when}</span>
                      </div>
                      <span className={`uiprev-num ${t.up ? "is-good" : "is-bad"}`}>{t.amt}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* phone mock — demonstrates the simplified mobile view */}
              <div className="uiprev-card uiprev-phonecard">
                <div className="uiprev-card-head"><h3>Mobile · key-points view</h3></div>
                <div className="uiprev-phone">
                  <div className="uiprev-phone-screen">
                    <div className="uiprev-phone-top">Net Worth</div>
                    <div className="uiprev-phone-hero">$4.82M</div>
                    <div className="uiprev-phone-delta"><ArrowUp size={12} /> 2.3% this month</div>
                    <div className="uiprev-phone-kpis">
                      <div><span>Assets</span><b>$5.41M</b></div>
                      <div><span>Liab.</span><b>$0.59M</b></div>
                    </div>
                    <div className="uiprev-phone-list">
                      <div><span>Living Expenses</span><b className="is-bad">−$4,120</b></div>
                      <div><span>Rental Income</span><b className="is-good">+$2,310</b></div>
                      <div><span>Property Costs</span><b className="is-bad">−$3,210</b></div>
                    </div>
                    <div className="uiprev-phone-tabs">
                      <span className="is-on"><Wallet size={16} /></span>
                      <span><ArrowLeftRight size={16} /></span>
                      <span><RefreshCw size={16} /></span>
                      <span><Calculator size={16} /></span>
                      <span><BarChart3 size={16} /></span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* command palette overlay */}
          {paletteOpen && (
            <div className="uiprev-palette-scrim" onClick={() => setPaletteOpen(false)}>
              <div className="uiprev-palette" onClick={(e) => e.stopPropagation()}>
                <div className="uiprev-palette-search">
                  <Search size={16} />
                  <input autoFocus placeholder="Type a command or search…" />
                  <kbd className="uiprev-kbd">esc</kbd>
                </div>
                <div className="uiprev-palette-list">
                  {PALETTE_ITEMS.map((p) => {
                    const PI = p.icon;
                    return (
                      <button key={p.label} className="uiprev-palette-item" onClick={() => setPaletteOpen(false)}>
                        <PI size={16} />
                        <span>{p.label}</span>
                        <span className="uiprev-palette-hint">{p.hint}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
