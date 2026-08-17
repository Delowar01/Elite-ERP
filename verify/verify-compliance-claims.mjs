/**
 * The Compliance Center must never again claim a compliance posture the product does not have.
 *
 * Written the way the ZATCA claim checks are: assert the claims ABSENT, not the replacements
 * present. Wording can improve freely — "Compliant", "ISO 27001 certified" and any attestation
 * phrasing must never come back, in either language.
 *
 * One assertion here is STRUCTURAL rather than textual, and it is the important one: no group may
 * render a full-marks "n/n" success badge. That badge was the visual form of the claim, and it can
 * return through a data change (one more control flipped true) rather than a wording change, which
 * no string assertion would catch.
 */
import { chromium } from "playwright";
import { Pool } from "pg";
import { readFileSync } from "fs";
import { assertFreshBuild } from "./assert-fresh-build.mjs";
import { pickCountry } from "./register-org.mjs";

const BASE = "http://localhost:3000";
const DBURL = readFileSync(".env", "utf8").split("\n").find((l) => l.startsWith("DATABASE_URL=")).slice(13).trim();
const pool = new Pool({ connectionString: DBURL });
let fail = 0;
const ok = (n, c, extra = "") => { console.log(`${c ? "  ✓" : "  ✗ FAIL"} ${n}${extra ? `  << ${extra}` : ""}`); if (!c) fail++; };
const uniq = () => Math.random().toString(36).slice(2, 8);

await assertFreshBuild(BASE);
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const p = await b.newPage({ viewport: { width: 1360, height: 1000 } });
const email = `cc_${uniq()}@test.dev`;
await p.goto(`${BASE}/register`, { waitUntil: "networkidle" });
await p.fill("#orgName", `CC Org ${uniq()}`); await p.fill("#name", "CC"); await p.fill("#email", email);
await p.fill("#password", `Zx9$mQ${uniq()}vK!ray`);
await pickCountry(p);
await Promise.all([p.waitForURL(`${BASE}/dashboard`, { timeout: 30000 }), p.click('button[type="submit"]')]);

console.log("\n== Compliance Center claims ==");
await p.goto(`${BASE}/settings/compliance`, { waitUntil: "networkidle" });
await p.waitForTimeout(500);
const body = await p.locator("body").innerText();

// English claims that must never return.
// The page DENIES certification in words ("not a certification", "self-assessed, not certified"),
// so the bare token "certified" is present honestly. These are the forms that would be a CLAIM —
// asserting the token itself would punish the truthful wording and push it back out.
for (const claim of [
  "Compliant",              // the pill — a blanket assertion the screen could not not-make
  "is certified",
  "ISO 27001 certified",
  "SOC 2 certified",
  "attestation",            // SOC 2 language
  "Attestation",
  "SOC 2",                  // the framework mapping was the part that lied
  "in progress",            // ISO 27001 is roadmap, not an engaged programme
  "pursuing",
]) ok(`page does NOT claim "${claim}"`, !body.includes(claim));
ok("page explicitly DENIES certification", /not a certification/i.test(body) && /not certified/i.test(body));

// The structural one: no full-marks success badge on any group.
const badges = await p.locator(".card .badge, .card [class*='badge']").allInnerTexts().catch(() => []);
const fullMarks = badges.filter((x) => /^(\d+)\s*\/\s*\1$/.test(x.trim()));
ok("no group renders a full-marks n/n success badge", fullMarks.length === 0, fullMarks.join(", "));

// And the honest replacements do render.
ok("titled as a readiness checklist", body.includes("Security & Compliance Readiness"));
ok("states plainly that it is not a certification", /not a certification/i.test(body));
ok("ISO 27001 is labelled roadmap", body.includes("ISO 27001 — roadmap"));
ok("the encryption control names WHAT is encrypted (MFA secrets), not 'personal data'",
  body.includes("MFA secrets and recovery codes encrypted at rest") && !body.includes("Encryption of personal data at rest"));
ok("backup control says the product does not verify execution", /not verified by the product/i.test(body));
ok("every control carries an explicit state",
  body.includes("Implemented") && (body.includes("Informational") || body.includes("deployment")));

console.log("\n== Arabic surface ==");
// Rendered in Arabic for real, rather than checked against the English page — an Arabic assertion
// on an English render is an assertion that cannot fail.
await p.context().addCookies([{ name: "locale", value: "ar", url: BASE }]);
await p.goto(`${BASE}/settings/compliance`, { waitUntil: "networkidle" });
await p.waitForTimeout(500);
const ar = await p.locator("body").innerText();
ok("Arabic render is actually Arabic (not an English fallback)", ar.includes("جاهزية الأمان والامتثال"), ar.slice(0, 80));
// The Arabic page DENIES certification ("ليست شهادة اعتماد", "وليس معتمداً"), so asserting the bare
// tokens absent would fire on the denial itself — an assertion that punishes the honest wording.
// These are the forms that would constitute a CLAIM.
for (const claim of ["متوافق", "حاصل على شهادة", "معتمد من", "مُعتمد رسمياً"]) {
  ok(`Arabic: no "${claim}" claim`, !ar.includes(claim));
}
ok("Arabic: the page explicitly DENIES certification", ar.includes("ليست شهادة اعتماد"));
ok("Arabic: ISO 27001 shown as roadmap wording", ar.includes("ضمن خطة التطوير"));
// Back to English by SETTING the locale, never by clearing cookies — clearing drops the session
// cookie too, and the next navigation lands on the login page while the assertion reads an empty
// dashboard and blames the product.
await p.context().addCookies([{ name: "locale", value: "en", url: BASE }]);

console.log("\n== Dashboard ==");
await p.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
await p.waitForTimeout(400);
const dash = await p.locator("body").innerText();
ok("dashboard does NOT claim 'Your data is encrypted'", !dash.includes("Your data is encrypted"));
ok("dashboard says what is actually encrypted", dash.includes("Encrypted connection, encrypted credentials"));

await b.close(); await pool.end();
console.log(`\n${fail === 0 ? "ALL PASSED" : fail + " CHECK(S) FAILED"}`);
process.exit(fail === 0 ? 0 : 1);
