#!/usr/bin/env node
// PO-07 S6-R: secret scan of the staged artifact tree, BEFORE it is archived. Never prints a matched value: only the
// file, the rule and the byte offset (this repository's logs are public).
//   node scan-artifact.mjs <po07-artifact dir> [--canaries <file>] [--forbid-env NAME]...
//
// Build output (.next) — FAIL on: an environment file; a private key; a URL with a password; a GitHub, npm, AWS,
//   Stripe or Slack token; a JSON Web Token; any canary from the env-embedding probe; the value of any --forbid-env
//   variable.
// Dependencies (node_modules, registry content whose integrity npm verified) — FAIL on a canary, a --forbid-env value
//   or a GitHub token; REPORT (not fail) private-key blocks, which some packages ship as test fixtures.
// Also REPORTS where the runner's build path and the fictional build DATABASE_URL's database name occur in .next.
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const root = path.resolve(argv.shift() ?? usage());
const exact = []; // [label, Buffer]
while (argv.length) {
  const a = argv.shift();
  if (a === "--canaries") {
    for (const line of fs.readFileSync(argv.shift(), "utf8").split("\n")) {
      const t = line.indexOf("\t");
      if (t > 0 && line.length - t > 8) exact.push([`canary ${line.slice(0, t)}`, Buffer.from(line.slice(t + 1))]);
    }
  } else if (a === "--forbid-env") {
    const n = argv.shift(); const v = process.env[n];
    if (v && v.length >= 16) exact.push([`value of $${n}`, Buffer.from(v)]);
  } else usage();
}
function usage() { console.error("usage: node scan-artifact.mjs <dir> [--canaries <file>] [--forbid-env NAME]..."); process.exit(64); }

const STRICT = [
  // a key BLOCK (header + base64 body; a bare header string is a format check in libraries such as jose)
  ["private key", /-----BEGIN ([A-Z0-9]+ )*PRIVATE KEY-----(?:\\[rn]|\s)*[A-Za-z0-9+/]{40,}/g],
  ["URL with a password", /\b[a-z][a-z0-9+.-]{1,15}:\/\/[^\s/"'`@:<>(){}\\]{1,64}:[^\s/"'`@<>(){}\\$]{1,128}@[a-z0-9][a-z0-9.-]{0,252}/gi],
  ["GitHub token", /\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/g],
  ["npm token", /\bnpm_[A-Za-z0-9]{36}\b/g],
  ["AWS access key", /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ["Stripe live key", /\b[rs]k_live_[0-9a-zA-Z]{20,}\b/g],
  ["Slack token", /\bxox[abposr]-[0-9A-Za-z-]{10,}\b/g],
  ["JSON Web Token", /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
];
const DEPS = [["GitHub token", STRICT[2][1]]];
const REPORT_DEPS = [["private key block", STRICT[0][1]]];
// Placeholder hosts used by library documentation strings ("https://user:pass@example.com").
const PLACEHOLDER_URL = /@(example\.(com|org|net)|localhost|host|hostname|domain|server|[a-z0-9-]+\.example\.(com|org))\b/i;

let failures = 0;
const fail = (rule, file, off) => { failures++; if (failures <= 40) console.log(`FAIL ${rule}: ${path.relative(root, file)} @${off}`); };
const report = new Map();
const note = (k, file) => { const s = report.get(k) ?? new Set(); s.add(path.relative(root, file)); report.set(k, s); };
const RUNNER_PATH = process.env.GITHUB_WORKSPACE ? Buffer.from(path.dirname(process.env.GITHUB_WORKSPACE)) : null;

function* walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile()) yield p;
  }
}
let scanned = 0, bytes = 0;
for (const part of [".next", "node_modules"]) {
  const strict = part === ".next";
  for (const f of walk(path.join(root, part))) {
    scanned++;
    if (strict && /^\.env/.test(path.basename(f))) fail("environment file", f, 0);
    const buf = fs.readFileSync(f); bytes += buf.length;
    for (const [label, v] of exact) { const i = buf.indexOf(v); if (i >= 0) fail(label, f, i); }
    if (strict && RUNNER_PATH && buf.indexOf(RUNNER_PATH) >= 0) note("runner build path", f);
    if (strict && buf.indexOf("build_test_only_") >= 0) note("fictional build DATABASE_URL database name", f);
    const text = buf.toString("latin1");
    for (const [label, re] of strict ? STRICT : DEPS) {
      re.lastIndex = 0;
      for (let m; (m = re.exec(text)); ) {
        if (label === "URL with a password" && PLACEHOLDER_URL.test(m[0])) { note("placeholder credential URL in a library string (allowed)", f); continue; }
        fail(label, f, m.index); break;
      }
    }
    if (!strict) for (const [label, re] of REPORT_DEPS) { re.lastIndex = 0; if (re.test(text)) note(label, f); }
  }
}
for (const [k, s] of report) {
  const list = [...s].sort();
  console.log(`REPORT ${k}: ${list.length} file(s)${list.length ? ` — ${list.slice(0, 8).join(", ")}${list.length > 8 ? ", …" : ""}` : ""}`);
}
console.log(`SECRET-SCAN ${failures ? "FAIL" : "PASS"} files=${scanned} bytes=${bytes} exact_values=${exact.length} failures=${failures}`);
process.exit(failures ? 1 : 0);
