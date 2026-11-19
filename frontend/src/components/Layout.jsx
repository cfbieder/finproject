import WorkbenchLayout from "./Workbench/WorkbenchLayout";
import "./Layout.css";
import "./DataTable.css";
import "./buttons.css";

/**
 * The desktop shell. Since CR105 S6c (2026-11-19) it is always the Workbench
 * layout — icon rail, section tabs, header period, inspector, keyboard. CR026's
 * top bar and sidebar (and the per-browser navLayout flag that chose between
 * them) are retired. Phones use mobile/MobileLayout instead (App.jsx).
 */
export default function Layout({ children }) {
  return <WorkbenchLayout>{children}</WorkbenchLayout>;
}
