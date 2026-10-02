/**
 * DEV-UI-01.3 — shell-only screenshot states, captured by `run.mjs capture-shell`.
 *
 * The 256-state matrix (config.mjs) photographs pages with every menu closed, as the owner, with the
 * sidebar expanded. That cannot show the app shell's own states: the collapsed rail, the navigation
 * drawer, the overlays, the menus, the Staff shell or keyboard focus. These states add exactly that,
 * on the same frozen clock, seed and TEST-ONLY database. Viewport screenshots (not full page): the
 * subject is the chrome, and overlays are fixed to the viewport.
 *
 * `action` names a step in run.mjs (SHELL_ACTIONS) performed after the page has settled.
 */
import { VIEWPORTS } from "./config.mjs";

export const STAFF_EMAIL = "staff@visual-baseline.test";

const vp = (name) => VIEWPORTS.find((v) => v.name === name);

/** [group, path, action, role, cookies, locales, themes, viewports] */
const GROUPS = [
  ["s1-collapsed-rail", "/dashboard", null, "owner", { sidebar_collapsed: "1" }, ["en", "ar"], ["light", "dark"], ["1440"]],
  ["s2-drawer-open", "/dashboard", "drawer", "owner", {}, ["en", "ar"], ["light", "dark"], ["768", "390"]],
  ["s3-command-palette", "/dashboard", "palette", "owner", {}, ["en", "ar"], ["light"], ["1440", "390"]],
  ["s4-record-search", "/dashboard", "search", "owner", {}, ["en", "ar"], ["light"], ["1440", "390"]],
  ["s5-account-menu", "/dashboard", "account", "owner", {}, ["en", "ar"], ["light"], ["1440", "390"]],
  ["s6-language-focus", "/dashboard", "language", "owner", {}, ["en", "ar"], ["light"], ["1440", "390"]],
  ["s7-notifications", "/dashboard", "notifications", "owner", {}, ["en", "ar"], ["light", "dark"], ["1440"]],
  ["s8-staff-shell", "/dashboard", null, "staff", {}, ["en", "ar"], ["light"], ["1440"]],
  ["s8-staff-drawer", "/dashboard", "drawer", "staff", {}, ["en", "ar"], ["light"], ["390"]],
  ["s9-focus-nav-item", "/dashboard", "focus-nav", "owner", {}, ["en"], ["light", "dark"], ["1440"]],
  ["s9-focus-topbar", "/dashboard", "focus-topbar", "owner", {}, ["en"], ["light", "dark"], ["1440"]],
  ["s10-recycle-bin-title", "/recycle-bin", null, "owner", {}, ["en", "ar"], ["light"], ["1440", "390"]],
];

export function shellMatrix() {
  const out = [];
  for (const [group, path, action, role, cookies, locales, themes, viewports] of GROUPS)
    for (const locale of locales)
      for (const theme of themes)
        for (const name of viewports)
          out.push({
            id: `shell-${group}__${locale}__${theme}__${name}`,
            route: { id: group, path, area: "App shell (DEV-UI-01.3)" },
            locale,
            theme,
            viewport: vp(name),
            action,
            role,
            cookies,
          });
  return out;
}
