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

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  STATUS_REGISTRY, STATUS_DOMAINS, STATUS_TONE_TOKENS, resolveStatus, statusLabel, humanizeStatus,
  type StatusDomain, type StatusTone,
} from "../src/lib/status-registry";
import { StatusBadge } from "../src/components/ui/status-badge";
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

let ok = true;
for (const [cond, name, extra] of results) {
  if (!cond) ok = false;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra && !cond ? "  << " + extra : ""}`);
}
console.log(`\n${results.filter((r) => r[0]).length}/${results.length} checks`);
console.log(ok ? "STATUS REGISTRY VERIFICATION PASS" : "STATUS REGISTRY VERIFICATION FAIL");
process.exit(ok ? 0 : 1);
