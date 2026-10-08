/**
 * DEV-UI-01.6 — document editor / detail screenshot states, captured by `run.mjs capture-documents`.
 *
 * The 256-state matrix shows a few document pages untouched. These states add what the document shell
 * actually does: an empty and a populated invoice, the item picker open, the document error region,
 * Configure Columns, the note editor and the terms list, the unsaved-changes indicator and a save in
 * flight, plus edit and detail pages (sent / draft invoice, quotation with its status Select open, PO)
 * and the Quotation / PO / Credit Note / Delivery Challan create screens. Same frozen clock, seed and
 * TEST-ONLY database.
 *
 * Every step is deterministic: typed text is fixed, the picked item is chosen by keyboard from the seed
 * catalogue, and the save-pending state holds the server action's request in the browser (it is never
 * sent), so the spinner state cannot race the response. Nothing is written to the run database by any
 * state except the error state's failed save attempt, which the server rejects before writing.
 *
 * `action` names a step in DOC_ACTIONS below. `full` states are full-page screenshots; overlay states
 * (picker, dialog, open Select) are viewport screenshots so the fixed layer is framed as the user sees it.
 */
import { VIEWPORTS } from "./config.mjs";

const vp = (name) => VIEWPORTS.find((v) => v.name === name);
const ALLW = ["1440", "1024", "768", "390"];
const EDGE = ["1440", "390"];
const BOTH = ["en", "ar"];

/** [id, path, action, locales, themes, viewports, full] */
const GROUPS = [
  // Invoice create — the reference editor
  ["inv-create-empty", "/sales/invoices/new", null, BOTH, ["light"], ALLW, true],
  ["inv-create-empty", "/sales/invoices/new", null, BOTH, ["dark"], ["1440"], true],
  ["inv-create-populated", "/sales/invoices/new", "populate", BOTH, ["light"], ALLW, true],
  ["inv-create-populated", "/sales/invoices/new", "populate", BOTH, ["dark"], ["1440"], true],
  ["inv-picker-open", "/sales/invoices/new", "picker", BOTH, ["light"], EDGE, false],
  ["inv-error", "/sales/invoices/new", "error", BOTH, ["light"], ALLW, true],
  ["inv-columns", "/sales/invoices/new", "columns", BOTH, ["light"], EDGE, false],
  ["inv-note", "/sales/invoices/new", "note", BOTH, ["light"], ALLW, true],
  ["inv-terms", "/sales/invoices/new", "terms", BOTH, ["light"], ALLW, true],
  ["inv-dirty", "/sales/invoices/new", "dirty", BOTH, ["light"], EDGE, false],
  ["inv-save-pending", "/sales/invoices/new", "pending", BOTH, ["light"], EDGE, false],
  // Edit + detail
  ["inv-edit", "/sales/invoices/6/edit", null, BOTH, ["light"], ALLW, true],
  ["inv-sent-detail", "/sales/invoices/3", null, BOTH, ["light"], ALLW, true],
  ["inv-sent-detail", "/sales/invoices/3", null, BOTH, ["dark"], ["1440"], true],
  ["inv-draft-detail", "/sales/invoices/6", null, BOTH, ["light"], ALLW, true],
  // Other document types
  ["qtn-create", "/sales/quotations/new", null, BOTH, ["light"], ALLW, true],
  ["qtn-detail-status", "/sales/quotations/1", "status-open", BOTH, ["light"], ALLW, false],
  ["po-create", "/purchasing/orders/new", null, BOTH, ["light"], ALLW, true],
  ["po-detail", "/purchasing/orders/1", null, BOTH, ["light"], ALLW, true],
  ["cn-create", "/sales/credit-notes/new", null, BOTH, ["light"], ALLW, true],
  ["dc-create", "/sales/delivery-challans/new", null, BOTH, ["light"], ALLW, true],
];

export function documentMatrix() {
  const out = [];
  for (const [group, path, action, locales, themes, viewports, full] of GROUPS)
    for (const locale of locales)
      for (const theme of themes)
        for (const name of viewports)
          out.push({ id: `doc-${group}__${locale}__${theme}__${name}`, route: { id: group, path, area: "Documents (DEV-UI-01.6)" }, locale, theme, viewport: vp(name), action, full });
  return out;
}

const firstLineName = (page) => page.locator("main tr[data-line-index='0'] [data-line-item-name]");

/** One deterministic step each, after the page settled. */
export const DOC_ACTIONS = {
  // A catalogue item picked by keyboard (Design services), a quantity and a discount.
  populate: async (page) => {
    const name = firstLineName(page);
    await name.click();
    await name.fill("Design");
    await page.locator("[data-item-picker]").waitFor();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.locator("[data-item-picker]").waitFor({ state: "detached" });
    await page.locator('main tr[data-line-index="0"] input[aria-label^="Qty — "], main tr[data-line-index="0"] input[aria-label^="الكمية — "]').first().fill("4");
    await page.locator("main .doc-totals-card .t-row.discount input").fill("100");
    await page.locator("main .doc-totals-card .t-row.discount input").blur();
    await page.evaluate(() => window.scrollTo(0, 0));
  },
  picker: async (page) => {
    const name = firstLineName(page);
    await name.scrollIntoViewIfNeeded();
    await name.click();
    await name.fill("Booth");
    await page.locator("[data-item-picker]").waitFor();
    await page.keyboard.press("ArrowDown");
  },
  // The server rejects an empty document ("Choose a client."): the error region appears and takes focus.
  error: async (page) => {
    await page.locator("main .doc-action-bar button").last().click();
    await page.locator("main [data-doc-form-error]").waitFor();
    await page.waitForFunction(() => document.activeElement?.hasAttribute("data-doc-form-error"));
    await page.evaluate(() => window.scrollTo(0, 0)); // full-page shot: the sticky shell back at the top
  },
  columns: async (page) => {
    await page.locator("main button.doc-pill-btn").filter({ hasText: /Edit Columns|تعديل الأعمدة/ }).click();
    await page.getByRole("dialog").waitFor();
  },
  note: async (page) => {
    await page.getByRole("tab").nth(1).click();
    if ((await page.locator("main .rte-editable").count()) === 0) await page.locator("main [role=tabpanel] button.doc-pill-btn").last().click();
    const ed = page.locator("main .rte-editable").first();
    await ed.click();
    await page.keyboard.type("Delivery and installation within 14 days of the signed order.");
    await ed.evaluate((e) => e.blur());
    await page.evaluate(() => window.scrollTo(0, 0));
  },
  terms: async (page) => {
    await page.getByRole("tab").first().click();
    const add = page.locator("main [role=tabpanel] button.doc-pill-btn").last();
    for (const text of ["50% advance payment on order confirmation.", "Prices are valid for 30 days."]) {
      await add.click();
      await page.locator("main [data-term-index]").last().locator("textarea").fill(text);
    }
    await page.locator("main [data-term-index]").last().locator("textarea").blur();
    await page.evaluate(() => window.scrollTo(0, 0));
  },
  // Typing a title makes the form dirty: the "Unsaved changes" indicator in the title bar.
  dirty: async (page) => {
    await page.locator("main input[id$='-title']").first().fill("Exhibition stand, Riyadh Expo");
    await page.locator("main input[id$='-title']").first().blur();
    await page.evaluate(() => window.scrollTo(0, 0));
  },
  // Save as Draft pressed; the server action request is held in the browser and never answered, so
  // the pressed button stays in its loading state (spinner, aria-busy) for the screenshot.
  pending: async (page) => {
    await page.route("**/sales/invoices/new", (route) => (route.request().method() === "POST" ? new Promise(() => {}) : route.continue()));
    await page.locator("main .doc-titlebar-actions button").first().click();
    await page.locator("main .doc-titlebar-actions button[aria-busy=true]").waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
  },
  "status-open": async (page) => {
    await page.locator("main [role=combobox]").first().click();
    await page.locator("[role=listbox]").waitFor();
  },
};
