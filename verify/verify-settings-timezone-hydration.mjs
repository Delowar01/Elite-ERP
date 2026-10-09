/**
 * Pre-DEV-UI-01.7 (P0.1) — the Security Center and the Compliance Center render the same dates and
 * times on the server and in the browser, whatever time zone the browser runs in.
 *
 * Both pages are client components: rendered once on the server, then again in the browser to
 * hydrate. They formatted timestamps with toLocaleString("en-US", …) and no timeZone, so each run
 * used its own zone — the server (UTC) wrote "Oct 9, 12:22 PM", a browser in Riyadh "Oct 9, 03:22
 * PM" — and React refused to hydrate the difference (error #418), then re-rendered the page in the
 * browser's zone. The consent dates did the same across midnight UTC.
 *
 * Fixture: a fresh TEST-only org registered through the UI. The owner's last password change, one
 * extra session, two security events and two consent records are written 30 minutes either side
 * of midnight UTC two days ago — so the calendar DAY differs ahead of UTC (Riyadh, Dhaka) and
 * behind it (New York), not only the hour.
 *
 * For every browser time zone (UTC, Asia/Riyadh, America/New_York, Asia/Dhaka) and app language
 * (en with an en-US browser, ar with an ar-SA browser):
 *   1. the browser really runs in that zone — left to itself it would print the instants differently;
 *   2. the language really applied (dir ltr / rtl);
 * and on each page:
 *   3. no page error and no console error — no React #418;
 *   4. every seeded timestamp, hydrated, reads exactly what the JavaScript-disabled server render wrote;
 *   5. and exactly the UTC reading, spelled out here without Intl (month, day, 12-hour clock);
 *   6. in English, the headings around the dates are unchanged.
 * Then, per page and language: one set of strings in all four zones.
 *
 * Runs by verify:browser against the server the runner starts, whose own zone is the host's (UTC).
 */
import { randomBytes } from "node:crypto";
import { chromium } from "playwright";
import { Client } from "pg";
import { assertFreshBuild } from "./assert-fresh-build.mjs";
import { pickCountry } from "./register-org.mjs";

const BASE = "http://localhost:3000";
const pass = "Qx7#vLm2$Rt9wZp4";
const email = `tz_${Math.random().toString(36).slice(2, 8)}@t.dev`;
const results = [];
const check = (n, c, x = "") => results.push([c, n, x]);

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
// Refuse to run against a build other than the one on disk — see assert-fresh-build.mjs.
await assertFreshBuild(BASE);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const VIEWPORT = { width: 1440, height: 950 };

// ---------- fixture org: registered through the UI, then given timestamps either side of midnight UTC ----------
const regCtx = await browser.newContext({ viewport: VIEWPORT, locale: "en-US", timezoneId: "UTC" });
regCtx.setDefaultTimeout(45000);
regCtx.setDefaultNavigationTimeout(60000);
const reg = await regCtx.newPage();
await reg.goto(`${BASE}/register`);
await reg.fill('input[name="orgName"]', "Time Zone Determinism Co");
await reg.fill('input[name="name"]', "Owner");
await reg.fill('input[name="email"]', email);
await reg.fill('input[name="password"]', pass);
const cf = reg.locator('input[name="confirmPassword"]');
if (await cf.count()) await cf.fill(pass);
await pickCountry(reg);
await reg.getByRole("button", { name: /register|create|sign up/i }).first().click();
await reg.waitForURL(/\/dashboard/, { timeout: 40000 });
const session = await regCtx.storageState();
await regCtx.close();

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const { org_id: org, id: uid } = await one("select org_id, id from users where email=$1", [email]);

// Two days ago keeps the security events inside the Security Center's 30-day window on any run date.
const today = new Date();
const midnight = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 2);
const BEFORE = new Date(midnight - 30 * 60000); // 23:30 UTC, the day before
const AFTER = new Date(midnight + 30 * 60000); // 00:30 UTC
// The columns are timestamp without time zone, read back as UTC: write the UTC wall-clock time.
const wall = (d) => d.toISOString().replace("T", " ").replace("Z", "");

await db.query("update users set password_changed_at=$1::timestamp where id=$2", [wall(BEFORE), uid]);
await db.query(
  `insert into sessions (org_id,user_id,token_hash,ip_address,browser,os,device,created_at,last_activity_at,expires_at)
   values ($1,$2,$3,'203.0.113.71','Fixture Browser','Fixture OS','Desktop',$4::timestamp,$5::timestamp,now() + interval '30 days')`,
  [org, uid, randomBytes(32).toString("hex"), wall(BEFORE), wall(AFTER)],
);
for (const [type, ip, when] of [["login.success", "203.0.113.81", BEFORE], ["password.changed", "203.0.113.82", AFTER]]) {
  await db.query(
    "insert into security_events (org_id,user_id,email,type,severity,ip_address,created_at) values ($1,$2,'tz-probe@t.dev',$3,'info',$4,$5::timestamp)",
    [org, uid, type, ip, wall(when)],
  );
}
for (const [subject, granted, version, when] of [["privacy_policy", true, "tz-probe-1", BEFORE], ["data_processing", false, "tz-probe-2", AFTER]]) {
  await db.query(
    "insert into consent_records (org_id,user_id,subject,granted,version,created_at) values ($1,$2,$3,$4,$5,$6::timestamp)",
    [org, uid, subject, granted, version, wall(when)],
  );
}
const seeded = await one(
  `select (select count(*) from sessions where user_id=$2 and ip_address='203.0.113.71')::int as s,
          (select count(*) from security_events where org_id=$1 and email='tz-probe@t.dev')::int as e,
          (select count(*) from consent_records where org_id=$1 and version like 'tz-probe-%')::int as c`,
  [org, uid],
);
check("fixture: password change, a session, two security events and two consent records either side of midnight UTC",
  seeded.s === 1 && seeded.e === 2 && seeded.c === 2, JSON.stringify(seeded));

// ---------- the UTC readings, spelled out without Intl ----------
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const utcDate = (d) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
const utcDateTime = (d) => {
  const h = d.getUTCHours();
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${String(h % 12 || 12).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};
const norm = (s) => (s ?? "").replace(/\s+/g, " ").trim();
const EXPECTED = {
  security: { password: utcDateTime(BEFORE), signedIn: utcDateTime(BEFORE), lastActive: utcDateTime(AFTER), event1: utcDateTime(BEFORE), event2: utcDateTime(AFTER) },
  compliance: { consent1: utcDate(BEFORE), consent2: utcDate(AFTER) },
};

// textContent (not innerText), so a JavaScript-disabled load — where streamed segments sit in hidden
// <div id="S:…"> blocks — reads the same nodes. Rows are found by the fixture's own values.
const READ = {
  security: () => {
    const rows = [...document.querySelectorAll("tr")];
    const dates = (ip) => {
      const r = rows.find((tr) => [...tr.cells].some((td) => td.textContent.trim() === ip));
      return r ? [...r.querySelectorAll("td.num-tabular")].map((td) => td.textContent) : [];
    };
    const [signedIn, lastActive] = dates("203.0.113.71");
    const pw = document.querySelector("#cur-pw")?.closest(".card")?.querySelector(".text-ink-muted");
    return {
      values: { password: pw?.textContent ?? null, signedIn: signedIn ?? null, lastActive: lastActive ?? null, event1: dates("203.0.113.81")[0] ?? null, event2: dates("203.0.113.82")[0] ?? null },
      headings: [...document.querySelectorAll("th")].map((th) => th.textContent.trim()),
      dir: document.documentElement.dir,
    };
  },
  compliance: () => {
    const rows = [...document.querySelectorAll("tr")];
    const date = (version) => rows.find((tr) => tr.cells[2]?.textContent.trim() === version)?.cells[3]?.textContent ?? null;
    return {
      values: { consent1: date("tz-probe-1"), consent2: date("tz-probe-2") },
      headings: [...document.querySelectorAll("th")].map((th) => th.textContent.trim()),
      dir: document.documentElement.dir,
    };
  },
};
const PAGES = [
  ["Security Center", "security", "/settings/security", ["Signed in", "Last active", "When"]],
  ["Compliance Center", "compliance", "/settings/compliance", ["Date"]],
];
const ZONES = ["UTC", "Asia/Riyadh", "America/New_York", "Asia/Dhaka"];
const LANGS = [
  { app: "en", browserLocale: "en-US", dir: "ltr" },
  { app: "ar", browserLocale: "ar-SA", dir: "rtl" },
];

const seen = {}; // `${page}|${app}` → zone → hydrated values
for (const lang of LANGS) {
  for (const zone of ZONES) {
    const tag = (label) => `[${zone} · ${lang.app}] ${label}`;
    const ctx = await browser.newContext({ viewport: VIEWPORT, locale: lang.browserLocale, timezoneId: zone, storageState: session });
    const ssr = await browser.newContext({ viewport: VIEWPORT, locale: lang.browserLocale, timezoneId: zone, storageState: session, javaScriptEnabled: false });
    for (const c of [ctx, ssr]) {
      c.setDefaultTimeout(45000);
      c.setDefaultNavigationTimeout(60000);
      await c.addCookies([{ name: "locale", value: lang.app, domain: "localhost", path: "/" }]);
    }
    const page = await ctx.newPage();
    const ssrPage = await ssr.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${String(e.message).slice(0, 140)}`));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 140)}`);
    });

    // Not vacuous: this browser really would have written these instants its own way.
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    const own = await page.evaluate(
      ([b, a]) => ({
        zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        dateTime: new Date(b).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
        dates: [b, a].map((i) => new Date(i).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" })),
      }),
      [BEFORE.toISOString(), AFTER.toISOString()],
    );
    const sameAsUtc = norm(own.dateTime) === utcDateTime(BEFORE) && norm(own.dates[0]) === utcDate(BEFORE) && norm(own.dates[1]) === utcDate(AFTER);
    const dayMoves = norm(own.dates[0]) !== utcDate(BEFORE) || norm(own.dates[1]) !== utcDate(AFTER);
    check(
      tag(zone === "UTC"
        ? "the browser runs in UTC and, by itself, writes the UTC readings"
        : `the browser runs in ${zone} and, by itself, would write "${norm(own.dateTime)}" and the dates ${own.dates.map((d) => `"${norm(d)}"`).join(" / ")} — another hour and another calendar day than UTC`),
      own.zone === zone && (zone === "UTC" ? sameAsUtc : !sameAsUtc && dayMoves),
      JSON.stringify(own),
    );

    for (const [label, key, path, englishHeadings] of PAGES) {
      errors.length = 0;
      await page.goto(BASE + path, { waitUntil: "networkidle" });
      await page.waitForTimeout(800);
      const hydrated = await page.evaluate(READ[key]);
      await ssrPage.goto(BASE + path, { waitUntil: "load" });
      const served = await ssrPage.evaluate(READ[key]);
      const fields = Object.keys(EXPECTED[key]);
      (seen[`${label}|${lang.app}`] ??= {})[zone] = hydrated.values;

      check(tag(`${label}: no page error and no console error (no React #418)`), errors.length === 0, errors.slice(0, 2).join(" | "));
      check(tag(`${label}: the language applied (dir="${lang.dir}")`), hydrated.dir === lang.dir, `dir="${hydrated.dir}"`);
      const differs = fields.filter((f) => hydrated.values[f] === null || hydrated.values[f] !== served.values[f]);
      check(
        tag(`${label}: every seeded timestamp hydrates to exactly the server-rendered text (${fields.length} timestamps)`),
        differs.length === 0,
        differs.map((f) => `${f}: server "${served.values[f]}" vs hydrated "${hydrated.values[f]}"`).join(" | "),
      );
      // The password line carries its label ("Last changed …"); the date is its end.
      const wrong = fields.filter((f) => (f === "password" ? !norm(hydrated.values[f]).endsWith(` ${EXPECTED[key][f]}`) : norm(hydrated.values[f]) !== EXPECTED[key][f]));
      check(
        tag(`${label}: and that text is the UTC reading (${fields.map((f) => `${f} "${EXPECTED[key][f]}"`).join(", ")})`),
        wrong.length === 0,
        wrong.map((f) => `${f}: "${norm(hydrated.values[f])}"`).join(" | "),
      );
      if (lang.app === "en") {
        const missing = englishHeadings.filter((h) => !hydrated.headings.includes(h));
        // The label only — whether the date after it is right is the check above.
        const pwLine = key === "security" ? norm(hydrated.values.password).startsWith("Last changed ") : true;
        check(
          tag(`${label}: English copy unchanged (headings ${englishHeadings.map((h) => `"${h}"`).join(", ")}${key === "security" ? ', "Last changed …"' : ""})`),
          missing.length === 0 && pwLine,
          `missing ${missing.join(", ")}; password "${norm(hydrated.values.password)}"`,
        );
      }
    }
    await ctx.close();
    await ssr.close();
  }
}

// ---------- across zones: one set of strings ----------
for (const [k, byZone] of Object.entries(seen)) {
  const [label, app] = k.split("|");
  const first = JSON.stringify(byZone[ZONES[0]]);
  const odd = ZONES.filter((z) => JSON.stringify(byZone[z]) !== first);
  check(`[${app}] ${label}: identical strings in UTC, Asia/Riyadh, America/New_York and Asia/Dhaka`, odd.length === 0 && ZONES.every((z) => byZone[z]),
    odd.map((z) => `${z} ${JSON.stringify(byZone[z])}`).join(" | ") + ` vs UTC ${first}`);
}

await db.end();
await browser.close();
let ok = true;
for (const [c, n, x] of results) {
  if (!c) ok = false;
  console.log(`${c ? "PASS" : "FAIL"}  ${n}${x && !c ? "  << " + x : ""}`);
}
console.log(`\n${results.filter((r) => r[0]).length}/${results.length} checks`);
console.log(ok ? "SETTINGS TIME ZONE HYDRATION PASS" : "SETTINGS TIME ZONE HYDRATION FAIL");
process.exit(ok ? 0 : 1);
