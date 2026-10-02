// Status registry (DEV-UI-01.2). Run via `npm run verify:status-registry` — deliberately WITHOUT
// --conditions=react-server: it server-renders the real <StatusBadge>, which needs the ordinary React
// build (the react-server build has no renderToStaticMarkup).
//
// What it pins, so status presentation cannot drift back into pages:
//   1. completeness   — every commercial DocumentType's registry keys == documentStatuses(docType)
//   2. semantics      — the owner-locked tone / pulse decisions, entry by entry
//   3. translation    — readable English, a real Arabic translation per entry, safe unknown fallback
//   4. ownership      — <StatusBadge> takes no variant / pulse from callers; the registry decides
//   5. no local maps  — an independent AST scan (not the G4 regex) for status→tone/colour maps,
//                       status-driven Badge variants, raw pill-tone classes and raw status labels
//   6. tag shape      — 4px status tag, no default dot, pulse only where the registry says so,
//                       and the generic .pill / <Badge> left as it was
//   7. contrast       — all six tones, light and dark, on the approved DEV-UI-01.1 tokens
//   8. labels + tones outside tags (DEV-UI-01.2-C1) — AST rules: no status option list rendered
//                       through raw t(), no raw status t("<value>") label, no hand-coloured status
//                       stat; one tone→text-class map; explicit coverage of every status selector,
//                       form, filter, stat row and task label

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  STATUS_REGISTRY, STATUS_DOMAINS, STATUS_TONE_TOKENS, STATUS_TONE_TEXT_CLASS, resolveStatus, statusLabel, statusStat,
  statusTextClass, humanizeStatus, type StatusDomain, type StatusTone,
} from "../src/lib/status-registry";
import { StatusBadge } from "../src/components/ui/status-badge";
import { StatRow } from "../src/app/(app)/sales/_shared/stat-row";
import { DOCUMENT_TYPES, documentStatuses } from "../src/lib/document-lifecycle";
import { TOKENS } from "../src/lib/design-tokens";
import { contrast } from "../src/lib/contrast";

const results: [boolean, string, string][] = [];
const check = (name: string, cond: boolean, extra = "") => results.push([cond, name, extra]);
const ROOT = new URL("..", import.meta.url).pathname;
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const entries = () =>
  STATUS_DOMAINS.flatMap((d) => Object.entries(STATUS_REGISTRY[d]).map(([raw, def]) => ({ domain: d, raw, def })));

// ---------- 1. completeness against the lifecycle ----------
for (const dt of DOCUMENT_TYPES) {
  const reg = Object.keys(STATUS_REGISTRY[dt as StatusDomain] ?? {}).sort();
  const life = documentStatuses(dt).sort();
  check(`${dt}: registry statuses == lifecycle statuses`, JSON.stringify(reg) === JSON.stringify(life), `registry [${reg}] lifecycle [${life}]`);
}
const workspace = read("src/lib/document-list-workspace.ts");
const wsLists = [...workspace.matchAll(/statuses:\s*\[([^\]]*)\]/g)].map((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]).sort().join(","));
const docSets = DOCUMENT_TYPES.map((dt) => Object.keys(STATUS_REGISTRY[dt as StatusDomain]).sort().join(","));
check("every list-workspace status filter equals a registered document status set",
  wsLists.length === 8 && wsLists.every((l) => docSets.includes(l)), wsLists.join(" | "));
check("dispatched and reversed are registered (missed by the old maps)",
  "dispatched" in STATUS_REGISTRY.delivery_challan && "reversed" in STATUS_REGISTRY.credit_note && "reversed" in STATUS_REGISTRY.debit_note);
check("no invented payroll `paid` state", !("paid" in STATUS_REGISTRY.payroll_run) && !("paid" in STATUS_REGISTRY.payroll_period));

// ---------- 2. owner-locked semantics ----------
const LOCKED: [StatusDomain, string, StatusTone, boolean?][] = [
  ["quotation", "draft", "neutral"], ["quotation", "sent", "info"], ["quotation", "accepted", "success"], ["quotation", "rejected", "danger"], ["quotation", "expired", "warning"],
  ["sales_order", "draft", "neutral"], ["sales_order", "confirmed", "info"], ["sales_order", "fulfilled", "success"], ["sales_order", "cancelled", "danger"],
  ["proforma_invoice", "draft", "neutral"], ["proforma_invoice", "sent", "info"],
  ["sales_invoice", "draft", "neutral"], ["sales_invoice", "sent", "info"], ["sales_invoice", "partially_paid", "warning"], ["sales_invoice", "paid", "success"], ["sales_invoice", "void", "danger"],
  ["delivery_challan", "draft", "neutral"], ["delivery_challan", "dispatched", "info"], ["delivery_challan", "delivered", "success"],
  ["credit_note", "draft", "neutral"], ["credit_note", "issued", "corrective"], ["credit_note", "reversed", "neutral"],
  ["debit_note", "draft", "neutral"], ["debit_note", "issued", "corrective"], ["debit_note", "reversed", "neutral"],
  ["purchase_order", "draft", "neutral"], ["purchase_order", "ordered", "info"], ["purchase_order", "received", "success"], ["purchase_order", "cancelled", "danger"],
  ["invoice_settlement", "paid", "success"], ["invoice_settlement", "partial", "warning"], ["invoice_settlement", "pending", "info"], ["invoice_settlement", "overdue", "danger"],
  ["leave", "pending", "warning", true], ["leave", "approved", "success"], ["leave", "rejected", "danger"],
  ["attendance", "present", "success"], ["attendance", "late", "warning"], ["attendance", "on_leave", "info"], ["attendance", "absent", "neutral"],
  ["employee", "active", "success"], ["employee", "inactive", "neutral"], ["active_flag", "active", "success"], ["active_flag", "inactive", "neutral"],
  ["project", "planned", "neutral"], ["project", "active", "info"], ["project", "on_hold", "warning"], ["project", "completed", "success"], ["project", "cancelled", "danger"],
  ["task", "todo", "neutral"], ["task", "in_progress", "info"], ["task", "blocked", "danger"], ["task", "done", "success"],
  ["payroll_period", "draft", "warning", true], ["payroll_period", "processed", "success"], ["payroll_run", "processed", "success"],
  ["record_state", "archived", "neutral"], ["record_state", "deleted", "danger"],
  ["stock", "low_stock", "warning"], ["stock", "in_stock", "success"],
  ["payment", "reversed", "neutral"], ["consent", "granted", "success"], ["consent", "withdrawn", "neutral"],
  ["zatca_state", "enabled", "success"], ["zatca_state", "not_enabled", "neutral"], ["exchange_rate_state", "stale", "warning"],
  ["security_severity", "info", "neutral"], ["security_severity", "low", "info"], ["security_severity", "medium", "warning"], ["security_severity", "high", "danger"], ["security_severity", "critical", "danger"],
  ["project_health", "profitable", "success"], ["project_health", "loss", "danger"], ["project_health", "no_revenue", "neutral"],
];
let wrongTone = 0;
for (const [d, raw, tone, pulse] of LOCKED) {
  const s = resolveStatus(d, raw);
  if (!s.known || s.tone !== tone || Boolean(s.pulse) !== Boolean(pulse)) {
    wrongTone++;
    check(`locked: ${d}.${raw} = ${tone}${pulse ? " + pulse" : ""}`, false, `got ${s.known ? s.tone : "UNKNOWN"}${s.pulse ? " + pulse" : ""}`);
  }
}
check(`all ${LOCKED.length} locked status decisions hold`, wrongTone === 0, `${wrongTone} wrong`);
const pulsing = entries().filter((e) => e.def.pulse).map((e) => `${e.domain}.${e.raw}`).sort();
check("pulse is owned by exactly leave.pending and payroll_period.draft", JSON.stringify(pulsing) === JSON.stringify(["leave.pending", "payroll_period.draft"]), pulsing.join(","));
check("payment reversal English label is exactly 'Reversed' (verify-payment-fx depends on it)", statusLabel("en", "payment", "reversed") === "Reversed");

// ---------- 3. translation ----------
const AMBIGUOUS_TITLE_KEYS = ["Unpaid", "Received", "Paid", "Void", "Pending", "To Do"];
let badEn = 0, badAr = 0, ambiguous = 0;
for (const { domain, raw, def } of entries()) {
  const en = statusLabel("en", domain, raw);
  if (!(en === def.label && /^[A-Z]/.test(en) && !en.includes("_"))) { badEn++; check(`EN label ${domain}.${raw}`, false, en); }
  const ar = statusLabel("ar", domain, raw);
  if (!(ar !== def.label && /[؀-ۿ]/.test(ar))) { badAr++; check(`AR translation ${domain}.${raw} (key "${def.i18nKey}")`, false, ar); }
  if (AMBIGUOUS_TITLE_KEYS.includes(def.i18nKey)) { ambiguous++; check(`${domain}.${raw} does not use an ambiguous title-case key`, false, def.i18nKey); }
}
const total = entries().length;
check(`every one of ${total} registry entries has a readable English label`, badEn === 0, `${badEn} bad`);
check(`every one of ${total} registry entries has its Arabic translation`, badAr === 0, `${badAr} missing`);
check("no registry entry uses an ambiguous title-case dictionary key", ambiguous === 0);
const unknown = resolveStatus("sales_invoice", "on_credit_hold");
check("unknown status: neutral, known=false, readable label, never throws",
  unknown.tone === "neutral" && !unknown.known && unknown.label === "On credit hold" && statusLabel("ar", "sales_invoice", "on_credit_hold") === "On credit hold", unknown.label);
check("empty / null status still yields a non-empty label", resolveStatus("quotation", null).label === "Unknown" && humanizeStatus("") === "Unknown");

// ---------- 4. StatusBadge ownership ----------
const render = (domain: StatusDomain, status: string, locale: "en" | "ar" = "en") =>
  renderToStaticMarkup(createElement(StatusBadge, { domain, status, locale }));
const issued = render("credit_note", "issued");
check("StatusBadge renders tone, raw value and domain from the registry",
  /class="status-tag"/.test(issued) && /data-tone="corrective"/.test(issued) && /data-status="issued"/.test(issued) && /data-status-domain="credit_note"/.test(issued) && />Issued</.test(issued), issued);
check("StatusBadge Arabic label comes from the registry key", render("sales_invoice", "partially_paid", "ar").includes("مدفوع جزئيًا"));
check("StatusBadge unknown value renders neutral with a readable label", /data-tone="neutral"/.test(render("quotation", "on_review")) && />On review</.test(render("quotation", "on_review")));
// The prop NAMES, read from the component's parameter type with the TypeScript parser.
const sbSrc = read("src/components/ui/status-badge.tsx");
const sbFile = ts.createSourceFile("status-badge.tsx", sbSrc, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let propNames: string[] = [];
ts.forEachChild(sbFile, (n) => {
  if (ts.isFunctionDeclaration(n) && n.name?.text === "StatusBadge") {
    const type = n.parameters[0]?.type;
    if (type && ts.isTypeLiteralNode(type)) propNames = type.members.map((m) => (m.name && ts.isIdentifier(m.name) ? m.name.text : "")).filter(Boolean);
  }
});
check("StatusBadge props are exactly domain / status / locale + presentational extras",
  JSON.stringify([...propNames].sort()) === JSON.stringify(["className", "detail", "domain", "icon", "locale", "status"]), propNames.join(","));
check("StatusBadge exposes no variant / tone / live / pulse prop", !propNames.some((p) => /^(variant|tone|live|pulse)$/.test(p)), propNames.join(","));

// ---------- 5. no local status maps (independent of the G4 regex) ----------
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) ? [p] : [];
  });
}
const SRC = join(ROOT, "src");
const REGISTRY = join(SRC, "lib/status-registry.ts");
// Priority words are a categorical attribute that happens to share three keys with severity.
const PRIORITY_ONLY = new Set(["low", "medium", "high"]);
const domainKeys = STATUS_DOMAINS.map((d) => new Set(Object.keys(STATUS_REGISTRY[d])));
const TONEISH = /\b(success|warning|danger|info|neutral|corrective)\b|pill-|var\(--|#[0-9a-f]{3,8}\b|\b(bg|text)-(success|warning|danger|info)/i;
const localMaps: string[] = [];
const badBadges: string[] = [];
const rawPills: string[] = [];
const rawLabels: string[] = [];
for (const file of walk(SRC)) {
  if (file === REGISTRY) continue;
  const rel = file.slice(ROOT.length);
  const text = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = (node: ts.Node) => {
    if (ts.isObjectLiteralExpression(node)) {
      const props = node.properties.filter(ts.isPropertyAssignment);
      const names = props.map((p) => (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : "")).filter(Boolean);
      for (const keys of domainKeys) {
        const hit = names.filter((n) => keys.has(n) && !PRIORITY_ONLY.has(n));
        const toneValues = props.filter((p) => hit.includes((p.name as ts.Identifier).text) && TONEISH.test(p.initializer.getText(sf))).length;
        if (hit.length >= 2 && toneValues >= 2) {
          localMaps.push(`${rel}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1} {${hit.join(",")}}`);
          break;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  text.split("\n").forEach((line, i) => {
    if (/<Badge[^>]*variant=\{[^}]*(\.status\b|isActive|recordState|severity|granted|health|stale|todayStatus)/.test(line)) badBadges.push(`${rel}:${i + 1}`);
    if (!rel.endsWith("components/ui/badge.tsx") && /\bpill-(success|warning|danger|info|neutral|corrective)\b/.test(line)) rawPills.push(`${rel}:${i + 1}`);
    if (/\{t\(locale, [\w.]+\.(status|severity)\)\}/.test(line)) rawLabels.push(`${rel}:${i + 1}`);
  });
}
check("no local status→tone/colour map outside the canonical registry", localMaps.length === 0, localMaps.slice(0, 5).join(" "));
check("no <Badge> variant decided from a status / state value", badBadges.length === 0, badBadges.slice(0, 5).join(" "));
check("no raw pill-<tone> status classes in components", rawPills.length === 0, rawPills.slice(0, 5).join(" "));
check("no raw stored status rendered as a label via t(locale, x.status)", rawLabels.length === 0, rawLabels.slice(0, 5).join(" "));
const dash = read("src/app/(app)/dashboard/page.tsx");
check("dashboard invoice legend takes colour and label from the registry",
  (dash.match(/settlementColor\("(paid|partial|pending|overdue)"\)/g) ?? []).length === 8 &&
    (dash.match(/statusLabel\(locale, "invoice_settlement"/g) ?? []).length === 4 &&
    !/var\(--accent-purple\)" \}\} \/>\{t\(locale, "Partial"\)/.test(dash));

// ---------- 6. tag shape ----------
const globals = read("src/app/globals.css");
const mockup = read("src/app/(app)/mockup-parity.css");
const tagRule = globals.match(/\.status-tag \{([^}]*)\}/)?.[1] ?? "";
check("status tag radius is 4px", /border-radius:\s*4px/.test(tagRule), tagRule.trim());
check("status tag uses logical padding (RTL-safe)", /padding-inline:/.test(tagRule) && !/padding-(left|right):/.test(tagRule));
check("status tag has no gradient, shadow or transform", !/gradient|box-shadow|transform/.test(tagRule));
check("status tag has no default leading dot", !/\.status-tag::before|\.status-tag:before/.test(globals));
check("generic .pill was not converted (still the original 999px pill)", /\.pill \{[^}]*border-radius: 999px/.test(mockup));
const plain = render("sales_invoice", "paid");
const leavePending = render("leave", "pending");
check("pulse indicator only on registry pulse states", !plain.includes("status-tag-pulse") && leavePending.includes("status-tag-pulse"), `${plain} | ${leavePending}`);
for (const tone of ["neutral", "info", "success", "warning", "danger", "corrective"] as StatusTone[]) {
  const r = globals.match(new RegExp(`\\.status-tag\\[data-tone="${tone}"\\] \\{([^}]*)\\}`))?.[1] ?? "";
  check(`status tag ${tone} uses the approved tokens`, r.includes(`--status-fg: var(--${tone})`) && r.includes(`--status-bg: var(--${tone}-bg)`) &&
    STATUS_TONE_TOKENS[tone].fg === `var(--${tone})` && STATUS_TONE_TOKENS[tone].bg === `var(--${tone}-bg)`, r.trim());
}

// ---------- 7. contrast, all six tones, light and dark ----------
const PAIRS: Record<StatusTone, [keyof typeof TOKENS.light, keyof typeof TOKENS.light]> = {
  neutral: ["neutral", "neutralTint"], info: ["info", "infoTint"], success: ["success", "successTint"],
  warning: ["warning", "warningTint"], danger: ["danger", "dangerTint"], corrective: ["corrective", "correctiveTint"],
};
for (const ap of ["light", "dark"] as const) {
  for (const [tone, [fg, bg]] of Object.entries(PAIRS)) {
    const r = contrast(TOKENS[ap][fg], TOKENS[ap][bg]);
    check(`${ap}: ${tone} tag text on its tint ≥ 4.5:1`, r >= 4.5, r.toFixed(2));
  }
}

// ---------- 8. labels and tones outside tags (DEV-UI-01.2-C1) ----------
// Reusable AST rules over every .tsx file except the registry. They look at the shape of the code,
// not at file names, so a new page that reintroduces the pattern fails too.
const TONES: StatusTone[] = ["neutral", "info", "success", "warning", "danger", "corrective"];
check("tone → text-class map is static and covers all six tones",
  TONES.every((tone) => STATUS_TONE_TEXT_CLASS[tone] === `text-${tone}`) && Object.keys(STATUS_TONE_TEXT_CLASS).length === 6,
  JSON.stringify(STATUS_TONE_TEXT_CLASS));
const theme = globals.match(/@theme inline \{([\s\S]*?)\n\}/)?.[1] ?? "";
check("every tone text class has a Tailwind colour (--color-<tone> in @theme inline)",
  TONES.every((tone) => new RegExp(`--color-${tone}:\\s*var\\(--${tone}\\)`).test(theme)));
const regSrc = read("src/lib/status-registry.ts");
check("the tone → text-class map holds literal class strings (no constructed classes)",
  !/`text-\$\{/.test(regSrc) && !/"text-"\s*\+/.test(regSrc));

/** Every raw value of every domain, minus the generic priority words. */
const ALL_RAW = new Set(entries().map((e) => e.raw).filter((r) => !PRIORITY_ONLY.has(r)));
/** `t(<locale>, <arg>)` → arg, else undefined. */
const tArg = (n: ts.Node): ts.Expression | undefined =>
  ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "t" && n.arguments.length === 2 ? n.arguments[1] : undefined;
const strLit = (n: ts.Node | undefined): string | undefined =>
  n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : undefined;
/** "On Leave" / "on_leave" / "dispatched" → the registry raw form, if it is one. */
const asRaw = (label: string) => label.trim().toLowerCase().replace(/[\s-]+/g, "_");
const SEMANTIC_COLOUR = /\b(text|bg)-(success|warning|danger|info|neutral|corrective)\b|var\(--(success|warning|danger|info|neutral|corrective|accent-green|accent-red|accent-purple|accent-orange)\)/;
/** String values held by an array literal: plain strings, or the string properties of object elements. */
function arrayStrings(arr: ts.ArrayLiteralExpression): string[] {
  return arr.elements.flatMap((el) => {
    const v = strLit(el);
    if (v !== undefined) return [v];
    if (ts.isObjectLiteralExpression(el))
      return el.properties.filter(ts.isPropertyAssignment).map((p) => strLit(p.initializer)).filter((x): x is string => x !== undefined);
    return [];
  });
}
const unwrap = (e: ts.Expression): ts.Expression =>
  ts.isAsExpression(e) || ts.isParenthesizedExpression(e) || ts.isSatisfiesExpression(e) ? unwrap(e.expression) : e;
/** The registry domain an option list belongs to (≥ 2 of its values are that domain's raw values). */
function statusDomainOf(values: string[]): StatusDomain | undefined {
  return STATUS_DOMAINS.find((d) => values.filter((v) => !PRIORITY_ONLY.has(v) && v in STATUS_REGISTRY[d]).length >= 2);
}
const refersTo = (n: ts.Node, names: Set<string>): boolean =>
  (ts.isIdentifier(n) && names.has(n.text)) || (ts.forEachChild(n, (c) => (refersTo(c, names) ? true : undefined)) ?? false);
const bindingNames = (b: ts.BindingName): string[] =>
  ts.isIdentifier(b) ? [b.text] : b.elements.flatMap((e) => (ts.isOmittedExpression(e) ? [] : bindingNames(e.name)));

const arrayViaT: string[] = [];      // R1: STATUSES.map((s) => t(locale, s)) — any status option list via raw t()
const rawStatusT: string[] = [];     // R2: t(locale, "dispatched") — a raw stored value used as a dictionary key
const colouredStats: string[] = [];  // R3: a status label paired with a hand-picked semantic colour
const statRowColours: string[] = []; // R4: a StatRow item coloured by hand instead of statusStat()
for (const file of walk(SRC)) {
  if (file === REGISTRY || !file.endsWith(".tsx")) continue;
  const rel = file.slice(ROOT.length);
  const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const at = (n: ts.Node) => `${rel}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
  // file-level const arrays: name → string values
  const constArrays = new Map<string, string[]>();
  const collect = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      const init = unwrap(n.initializer);
      if (ts.isArrayLiteralExpression(init)) constArrays.set(n.name.text, arrayStrings(init));
    }
    ts.forEachChild(n, collect);
  };
  collect(sf);
  const visit = (n: ts.Node) => {
    // R1 — <statusArray>.map((x) => … t(locale, x / x.prop) …)
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "map") {
      const target = unwrap(n.expression.expression);
      const values = ts.isArrayLiteralExpression(target) ? arrayStrings(target) : ts.isIdentifier(target) ? constArrays.get(target.text) : undefined;
      const fn = n.arguments[0];
      const domain = values && statusDomainOf(values);
      if (domain && fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && fn.parameters[0]) {
        const params = new Set(bindingNames(fn.parameters[0].name));
        const scan = (m: ts.Node) => {
          const a = tArg(m);
          if (a && refersTo(a, params)) arrayViaT.push(`${at(m)} [${domain}] t(locale, ${a.getText(sf)})`);
          ts.forEachChild(m, scan);
        };
        scan(fn.body);
      }
    }
    // R2 — t(locale, "<raw stored value>")
    const a = tArg(n);
    const lit = strLit(a);
    if (lit !== undefined && /^[a-z]+(_[a-z]+)*$/.test(lit) && ALL_RAW.has(lit)) rawStatusT.push(`${at(n)} t(locale, "${lit}")`);
    // R3a — { label: t(locale, "<status>"), colorClass|color: <semantic colour> }
    if (ts.isObjectLiteralExpression(n)) {
      const prop = (k: string) => n.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === k);
      const label = prop("label");
      const colour = prop("colorClass") ?? prop("color");
      const labelLit = label && (strLit(tArg(label.initializer)) ?? undefined);
      if (labelLit && colour && ALL_RAW.has(asRaw(labelLit)) && SEMANTIC_COLOUR.test(colour.initializer.getText(sf)))
        colouredStats.push(`${at(n)} "${labelLit}" ${colour.initializer.getText(sf)}`);
    }
    // R3b — <el style={{ color: <semantic> }}>{t(locale, "<status>")}</el>
    if (ts.isJsxElement(n)) {
      const style = n.openingElement.attributes.properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText(sf) === "style");
      const styleText = style?.initializer?.getText(sf) ?? "";
      if (/\bcolor:/.test(styleText) && SEMANTIC_COLOUR.test(styleText)) {
        for (const c of n.children) {
          const lbl = ts.isJsxExpression(c) && c.expression ? strLit(tArg(c.expression)) : undefined;
          if (lbl && ALL_RAW.has(asRaw(lbl))) colouredStats.push(`${at(n)} "${lbl}" ${styleText}`);
        }
      }
    }
    // R4 — <StatRow items={[{ …, colorClass: "…" }]} />: colour on a stat comes only from statusStat()
    if ((ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) && n.tagName.getText(sf) === "StatRow") {
      for (const p of n.attributes.properties) {
        if (!ts.isJsxAttribute(p) || p.name.getText(sf) !== "items") continue;
        const scan = (m: ts.Node) => {
          if (ts.isPropertyAssignment(m) && ts.isIdentifier(m.name) && m.name.text === "colorClass") statRowColours.push(`${at(m)} ${m.getText(sf)}`);
          ts.forEachChild(m, scan);
        };
        scan(p);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}
check("R1: no status option list (array of registry values) is labelled through raw t()", arrayViaT.length === 0, arrayViaT.slice(0, 6).join(" | "));
check("R2: no raw stored status value is used as a t() key (labels come from statusLabel)", rawStatusT.length === 0, rawStatusT.slice(0, 6).join(" | "));
check("R3: no status label is paired with a hand-picked semantic colour", colouredStats.length === 0, colouredStats.slice(0, 6).join(" | "));
check("R4: no StatRow item carries a hand-written colorClass (status stats use statusStat())", statRowColours.length === 0, statRowColours.slice(0, 6).join(" | "));
// no second tone → text-class map anywhere: an object literal keyed by ≥ 3 tone names whose values are text-* classes
const toneMaps: string[] = [];
for (const file of walk(SRC)) {
  if (file === REGISTRY) continue;
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(/\{[^{}]*\}/g)) {
    const keys = [...m[0].matchAll(/\b(neutral|info|success|warning|danger|corrective)\s*:\s*["'`]text-/g)];
    if (keys.length >= 3) toneMaps.push(file.slice(ROOT.length));
  }
}
check("STATUS_TONE_TEXT_CLASS is the only tone → text-class map", toneMaps.length === 0, toneMaps.join(" "));

// statusStat / StatRow behaviour, rendered
const dcDispatched = statusStat("en", "delivery_challan", "dispatched", 3);
const cnIssued = statusStat("en", "credit_note", "issued", 2);
check("statusStat: dispatched → info / text-info, label 'Dispatched'",
  dcDispatched.tone === "info" && dcDispatched.colorClass === "text-info" && dcDispatched.label === "Dispatched" && dcDispatched.value === "3", JSON.stringify(dcDispatched));
check("statusStat: credit note issued → corrective / text-corrective",
  cnIssued.tone === "corrective" && cnIssued.colorClass === "text-corrective", JSON.stringify(cnIssued));
check("statusStat: Arabic label from the registry key, missing count → 0",
  statusStat("ar", "sales_invoice", "partially_paid", undefined).label === "مدفوع جزئيًا" && statusStat("en", "quotation", "draft", null).value === "0");
check("statusTextClass follows the registry tone (quotation.expired → text-warning, attendance.on_leave → text-info)",
  statusTextClass("quotation", "expired") === "text-warning" && statusTextClass("attendance", "on_leave") === "text-info");
const statHtml = renderToStaticMarkup(createElement(StatRow, { items: [{ label: "Total", value: "9" }, dcDispatched] }));
check("StatRow renders the registry tone class and data-status / data-tone on a status stat",
  /data-status-domain="delivery_challan" data-status="dispatched" data-tone="info"/.test(statHtml) && /class="kpi-value text-info"/.test(statHtml) && />Dispatched</.test(statHtml), statHtml);
check("StatRow leaves a non-status stat uncoloured and unattributed",
  /<div class="card" style="padding:16px 18px"><div class="kpi-label"[^>]*>Total<\/div><div class="kpi-value "/.test(statHtml), statHtml);

// explicit coverage — every known status selector / form / filter / stat row / task label
const APP = "src/app/(app)/";
const COVER: [string, string, RegExp[], RegExp[]][] = [
  // [label, file, must contain, must not contain]
  ["project status select", "projects/[id]/project-status-select.tsx", [/STATUSES\.map\(\(s\) =>[\s\S]{0,120}statusLabel\(locale, "project", s\)/], [/t\(locale, s\)/]],
  ["project form status", "projects/project-form.tsx", [/STATUSES\.map\(\(s\) =>[\s\S]{0,120}statusLabel\(locale, "project", s\)/], [/t\(locale, s\)/]],
  ["employee form status", "hr/employees/employee-form.tsx",
    [/<SelectItem value="active">\{statusLabel\(locale, "employee", "active"\)\}/, /<SelectItem value="inactive">\{statusLabel\(locale, "employee", "inactive"\)\}/], [/t\(locale, "(active|inactive)"\)/]],
  ["proforma detail status select + confirmation", "sales/proforma/proforma-detail-actions.tsx",
    [/statusLabel\(locale, "proforma_invoice", s\)/, /value: statusLabel\(locale, "proforma_invoice", value\)/], [/t\(locale, (s|value)\)/]],
  ["quotation detail status select + confirmation", "sales/quotations/quotation-detail-actions.tsx",
    [/statusLabel\(locale, "quotation", s\)/, /value: statusLabel\(locale, "quotation", value\)/], [/t\(locale, (s|value)\)/]],
  ["sales-order detail status select + confirmation", "sales/orders/order-detail-actions.tsx",
    [/statusLabel\(locale, "sales_order", s\)/, /value: statusLabel\(locale, "sales_order", value\)/], [/t\(locale, (s|value)\)/]],
  ["delivery-challan detail status select + confirmation", "sales/delivery-challans/dc-detail-actions.tsx",
    [/statusLabel\(locale, "delivery_challan", s\)/, /value: statusLabel\(locale, "delivery_challan", value\)/], [/t\(locale, (s|value)\)/]],
  ["list workspace status filter", "documents/_workspace/list-workspace-toolbar.tsx",
    [/module: DocumentType;/, /statusOptions\.map\(\(s\) =>[\s\S]{0,120}\{statusLabel\(locale, module, s\)\}/], [/t\(locale, s\)/, /isStatusDomain/]],
  ["task kanban column labels + status select", "projects/[id]/kanban-board.tsx",
    [/const COLUMNS: \{ status: string \}\[\] = \[\{ status: "todo" \}, \{ status: "in_progress" \}, \{ status: "blocked" \}, \{ status: "done" \}\];/,
     /<span>\{statusLabel\(locale, "task", col\.status\)\}<\/span>/, /COLUMNS\.map\(\(c\) =>[\s\S]{0,140}\{statusLabel\(locale, "task", c\.status\)\}/],
    [/label: "(To Do|In Progress|Blocked|Done)"/, /t\(locale, (col|c)\.label\)/]],
  ["dashboard HR snapshot (attendance)", "dashboard/page.tsx",
    [/\["present", hrSnapshot\.present\],\s*\["on_leave", hrSnapshot\.onLeave\],\s*\["absent", hrSnapshot\.absent\],/, /statusTextClass\("attendance", status\)\}>\{statusLabel\(locale, "attendance", status\)\}/],
    [/t\(locale, "(Present|On Leave|Absent)"\)/]],
  ["dashboard project overview (project)", "dashboard/page.tsx",
    [/\["completed", projectsOverview\.completed\],\s*\["active", projectsOverview\.active\],\s*\["on_hold", projectsOverview\.onHold\],\s*\["planned", projectsOverview\.planned\],/,
     /statusTextClass\("project", status\)\}>\{statusLabel\(locale, "project", status\)\}/],
    [/t\(locale, "(In Progress|On Hold|Not Started)"\)/]],
  ["employee cards present / on-leave KPIs", "hr/employees/employees-client.tsx",
    [/className=\{statusTextClass\("attendance", "present"\)\}/, /statusLabel\(locale, "attendance", "on_leave"\)/, /className=\{statusTextClass\("attendance", "on_leave"\)\}/],
    [/color: "var\(--(accent-green|warning)\)"/]],
];
for (const [label, file, must, mustNot] of COVER) {
  const src = read(APP + file);
  const missing = must.filter((re) => !re.test(src)).map(String);
  const present = mustNot.filter((re) => re.test(src)).map(String);
  check(`coverage: ${label}`, missing.length === 0 && present.length === 0, `missing ${missing.join(" ")} | forbidden ${present.join(" ")}`);
}
// the nine list pages: every status stat via statusStat() in its own domain, nothing else coloured
const STAT_ROWS: [string, StatusDomain, string[]][] = [
  ["sales/quotations/quotations-list-client.tsx", "quotation", ["accepted", "sent", "draft"]],
  ["sales/orders/orders-list-client.tsx", "sales_order", ["confirmed", "fulfilled", "draft"]],
  ["sales/proforma/proforma-list-client.tsx", "proforma_invoice", ["sent", "draft"]],
  ["sales/invoices/invoices-list-client.tsx", "sales_invoice", ["paid", "sent", "draft"]],
  ["sales/delivery-challans/dc-list-client.tsx", "delivery_challan", ["delivered", "dispatched", "draft"]],
  ["purchasing/orders/po-list-client.tsx", "purchase_order", ["received", "ordered", "draft"]],
  ["sales/credit-notes/cn-list-client.tsx", "credit_note", ["issued", "draft"]],
  ["purchasing/debit-notes/dn-list-client.tsx", "debit_note", ["issued", "draft"]],
  ["projects/projects-list-client.tsx", "project", ["active", "completed", "planned"]],
];
for (const [file, domain, statuses] of STAT_ROWS) {
  const src = read(APP + file);
  const row = src.match(/<StatRow\s+items=\{\[([\s\S]*?)\]\}\s*\/>/)?.[1] ?? "";
  const calls = [...row.matchAll(/statusStat\(locale, "(\w+)", "(\w+)", stats\.(\w+)\)/g)];
  const ok = calls.length === statuses.length &&
    calls.every((c, i) => c[1] === domain && c[2] === statuses[i] && c[3] === statuses[i]) && !/colorClass/.test(row);
  check(`coverage: ${domain} list stat row — ${statuses.join(" / ")} via statusStat`, ok, row.trim().replace(/\s+/g, " ").slice(0, 200));
}

let ok = true;
for (const [cond, name, extra] of results) {
  if (!cond) ok = false;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra && !cond ? "  << " + extra : ""}`);
}
console.log(`\n${results.filter((r) => r[0]).length}/${results.length} checks`);
console.log(ok ? "STATUS REGISTRY VERIFICATION PASS" : "STATUS REGISTRY VERIFICATION FAIL");
process.exit(ok ? 0 : 1);
