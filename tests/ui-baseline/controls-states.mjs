/**
 * DEV-UI-01.4 — control-gallery states for `run.mjs capture-controls` (gallery: controls-gallery.tsx).
 *
 * Static groups are photographed as rendered; interactive states run one deterministic step first
 * (open a menu, type a filter, arrow to an option, or reach a control with the KEYBOARD so
 * :focus-visible is the real thing). Full-page screenshots of a small gallery page.
 */
import { VIEWPORTS } from "./config.mjs";

const vp = (name) => VIEWPORTS.find((v) => v.name === name);
const ALL = { locales: ["en", "ar"], themes: ["light", "dark"], viewports: ["1440", "390"] };
const LIGHT = { locales: ["en", "ar"], themes: ["light"], viewports: ["1440", "390"] };
const FOCUS = { locales: ["en", "ar"], themes: ["light", "dark"], viewports: ["1440"] };

/** [state, gallery group, action, axes] */
const STATES = [
  ["buttons", "buttons", null, ALL],
  ["fields", "fields", null, ALL],
  ["selects", "selects", null, ALL],
  ["searchables", "searchables", null, ALL],
  ["checks", "checks", null, ALL],
  ["tabs-menu", "tabs", null, ALL],
  ["select-open", "selects", "select-open", ALL],
  ["searchable-open", "searchables", "searchable-open", ALL],
  ["searchable-filtered", "searchables", "searchable-filter", LIGHT],
  ["searchable-active", "searchables", "searchable-active", LIGHT],
  ["focus-button", "buttons", "focus:[data-slot=button]", FOCUS],
  ["focus-input", "fields", "focus:[data-slot=input]", FOCUS],
  ["focus-select", "selects", "focus:[data-gallery=select-main]", FOCUS],
  ["focus-checkbox", "checks", "focus:[data-slot=checkbox]", FOCUS],
  ["focus-radio", "checks", "focus-radio", FOCUS],
  ["focus-tab", "tabs", "focus-tab", FOCUS],
  ["focus-row-menu", "tabs", "focus:.row-menu-btn", FOCUS],
];

export function controlsMatrix() {
  const out = [];
  for (const [state, group, action, axes] of STATES)
    for (const locale of axes.locales)
      for (const theme of axes.themes)
        for (const name of axes.viewports)
          out.push({ id: `controls-${state}__${locale}__${theme}__${name}`, group, action, locale, theme, viewport: vp(name), route: { id: state, path: `/__ui-baseline/controls/${group}`, area: "Controls (DEV-UI-01.4)" } });
  return out;
}
