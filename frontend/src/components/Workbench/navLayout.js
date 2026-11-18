/**
 * The per-browser layout switch (CR026 flag, CR105 adds "workbench").
 * Layout.jsx reads the flag once at load, so a switch reloads the page.
 */
export function setNavLayout(value) {
  try {
    localStorage.setItem("navLayout", value);
  } catch {
    /* storage blocked — the reload simply keeps the current layout */
  }
  window.location.reload();
}
