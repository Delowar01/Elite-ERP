#!/usr/bin/env node
// PO-07 K5 (25 Nov 2026): the S0 baseline chain, traceable end to end (PC only, read-only).
//   node tools/s0-trace.mjs <directory of the S0 files> [--chain <tsv>] [--register <tsv>] [--last <S0 file>]
// Defaults: tools/baseline-chain.tsv and tools/baseline-register.tsv next to this script.
// For every step between consecutive baselines of the chain (original 22 Nov 2026 → … → the latest accepted one):
//   - each file must be the one recorded (SHA-256 in the chain);
//   - every difference in the shared-service identity rows, the per-site status and the staging names is
//       STAGING  a resource the kit's own stages create, recognised by name only: the staging units
//                (elite-po-*, postgresql@16-po07ns) in the running-service list, sockets under /run/elite-po-staging/
//                or /run/elite-po-pg/, and the approved staging names of S0 section 8 — never a host TCP listener;
//       KNOWN    listed for exactly this step with exactly these values in the register, which records who accepted
//                it, when, and the evidence;
//       FAIL     anything else, including a list difference that mixes staging and other entries (unless the row
//                itself is registered).
// Nothing is accepted automatically: a register line needs the owner's written acceptance first.
// --last: the given file must be the chain's final baseline (s0_compare.sh --trace passes the reference here).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const dir = args[0] && !args[0].startsWith("--") ? args[0] : null;
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const here = path.dirname(fileURLToPath(import.meta.url));
const chainF = opt("--chain", path.join(here, "baseline-chain.tsv"));
const regF = opt("--register", path.join(here, "baseline-register.tsv"));
const last = opt("--last", null);
if (!dir) { console.error("usage: s0-trace.mjs <dir> [--chain f] [--register f] [--last f]"); process.exit(64); }

const tsv = (f) => fs.readFileSync(f, "utf8").split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.split("\t"));
const chain = tsv(chainF).map(([id, file, sha, taken, role]) => ({ id, file, sha, taken, role }));
const register = tsv(regF).map(([step, label, from, to, why]) => ({ step, label, from: from ?? "", to: to ?? "", why }));
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");

// identity rows: the same facts and patterns as tools/s0_compare.sh (prefix → value after; suffix → value before)
const ERP_HOST = "erp.po07.test";
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ROWS = [
  ["ERP MainPID", "^MainPID: "], ["ERP next-server pid(s)", "^next-server pid\\(s\\) of user po07erp: "],
  ["ERP release", "^current release: "], ["ERP release HEAD", "^release HEAD: "],
  ["ERP release dir checksum", "^ERP release dir checksum \\(names\\+sizes\\+mtimes, top level of current\\): "],
  ["ERP unit + drop-ins checksum", "^ERP unit \\+ drop-ins checksum: "], ["ERP shared env checksum", "^ERP shared env checksum \\(file bytes, not printed\\): "],
  ["running services (count|checksum)", "^count: "], ["failed units", "^failed units now: "],
  ["PostgreSQL main postgresql.conf", " /etc/postgresql/16/main/postgresql\\.conf$"], ["main pid", "^main pid: "],
  ["nginx tree checksum", "^tree checksum: "], ["nginx master pid", "^master pid: "],
  ["ERP vhost checksum", ` /etc/nginx/sites-enabled/${esc(ERP_HOST)}\\.conf$`],
  ["TCP listeners (count|checksum)", "^TCP listen count: "], ["unix listeners (count|checksum)", "^unix listen count: "],
  ["main pg_hba.conf", " /etc/postgresql/16/main/pg_hba\\.conf$"], ["main pg_ident.conf", " /etc/postgresql/16/main/pg_ident\\.conf$"],
  ["main start.conf", " /etc/postgresql/16/main/start\\.conf$"], ["createcluster.conf", " /etc/postgresql-common/createcluster\\.conf$"],
];
const LISTS = { "running services (count|checksum)": ["baseline-units.txt", /^(elite-po-[a-z-]+\.(service|socket|slice|timer)|postgresql@16-po07ns\.service)$/],
  "unix listeners (count|checksum)": ["baseline-unix.txt", /^\/run\/elite-po-(staging|pg)\//], "TCP listeners (count|checksum)": ["baseline-tcp.txt", null] };

function parse(text) {
  const lines = text.split("\n");
  const val = (re) => {
    const r = new RegExp(re); const l = lines.find((x) => r.test(x)); if (l === undefined) return "";
    return l.replace(r, "").replace(/\s+$/, "");
  };
  const rows = Object.fromEntries(ROWS.map(([k, re]) => [k, val(re)]));
  const sect = (from, to) => { const a = lines.findIndex((l) => l.startsWith(`== ${from} `)); if (a < 0) return [];
    const b = lines.findIndex((l, i) => i > a && l.startsWith(`== ${to} `)); return lines.slice(a + 1, b < 0 ? undefined : b); };
  const sites = Object.fromEntries(sect("1b", "2").filter((l) => /^ {2}\S/.test(l)).map((l) => l.trim().split(/\s+/)));
  const names = Object.fromEntries(sect("8", "9").map((l) => l.match(/^((?:user|group|unit|path) \S+)\s+(TAKEN|free)$/)).filter(Boolean).map((m) => [m[1], m[2]]));
  const list = (n) => { const a = lines.indexOf(`##BEGIN ${n}`), b = lines.indexOf(`##END ${n}`); return a < 0 || b < 0 ? null : lines.slice(a + 1, b).filter(Boolean); };
  return { rows, sites, names, list };
}

let fail = 0, known = 0, staging = 0;
const out = (tag, msg) => { console.log(`${tag.padEnd(7)} ${msg}`); if (tag === "FAIL") fail++; if (tag === "KNOWN") known++; if (tag === "STAGING") staging++; };
const reg = (step, label, from, to) => register.find((r) => r.step === step && r.label === label && r.from === from && r.to === to);
if (chain.length < 2) { out("FAIL", `the chain ${chainF} has fewer than two baselines`); }
const parsed = chain.map((c) => {
  const f = path.join(dir, c.file);
  if (!fs.existsSync(f)) { out("FAIL", `${c.id} ${c.file}: missing`); return null; }
  const b = fs.readFileSync(f);
  if (sha(b) !== c.sha) out("FAIL", `${c.id} ${c.file}: SHA-256 ${sha(b).slice(0, 16)}… is not the recorded ${c.sha.slice(0, 16)}… (a changed or substituted baseline)`);
  return parse(b.toString("utf8"));
});
for (let i = 1; i < chain.length; i++) {
  const A = parsed[i - 1], B = parsed[i], step = `${chain[i - 1].id}>${chain[i].id}`;
  console.log(`\n== ${step}: ${chain[i - 1].role} (${chain[i - 1].taken}) → ${chain[i].role} (${chain[i].taken})`);
  if (!A || !B) { out("FAIL", "a baseline of this step is missing"); continue; }
  let same = 0;
  for (const [label] of ROWS) {
    const a = A.rows[label], b = B.rows[label];
    if (a === b) { same++; continue; }
    const r = reg(step, label, a, b);
    if (r) { out("KNOWN", `${label}: ${a || "absent"} → ${b} (${r.why})`); continue; }
    const L = LISTS[label], la = L && A.list(L[0]), lb = L && B.list(L[0]);
    if (L && la && lb) {
      const added = lb.filter((x) => !la.includes(x)), removed = la.filter((x) => !lb.includes(x));
      const other = [...added.map((x) => `+${x}`), ...removed.map((x) => `-${x}`)].filter((x) => !(L[1] && L[1].test(x.slice(1))));
      if (other.length === 0 && added.length + removed.length > 0) { out("STAGING", `${label}: ${[...added.map((x) => `+${x}`), ...removed.map((x) => `-${x}`)].join(" ")} (kit staging resources)`); continue; }
      out("FAIL", `${label}: ${a} → ${b}; not a staging resource and not registered for ${step}: ${other.join(" ") || "(checksum only)"}`);
    } else out("FAIL", `${label}: ${a || "absent"} → ${b || "absent"} — not registered for ${step}`);
  }
  for (const s of [...new Set([...Object.keys(A.sites), ...Object.keys(B.sites)])].sort()) {
    const a = A.sites[s] ?? "", b = B.sites[s] ?? "";
    if (a === b) { same++; continue; }
    const r = reg(step, `site ${s}`, a, b);
    r ? out("KNOWN", `site ${s}: ${a || "absent"} → ${b} (${r.why})`) : out("FAIL", `site ${s}: ${a || "absent"} → ${b || "absent"} — not registered for ${step}`);
  }
  const nameDiff = [...new Set([...Object.keys(A.names), ...Object.keys(B.names)])].sort().filter((k) => (A.names[k] ?? "") !== (B.names[k] ?? ""));
  if (nameDiff.length) out("STAGING", `approved staging names: ${nameDiff.map((k) => `${k} ${A.names[k] ?? "-"}→${B.names[k] ?? "-"}`).join("; ")}`);
  console.log(`        ${same} fact(s) unchanged`);
}
if (last) {
  const lb = fs.existsSync(last) ? sha(fs.readFileSync(last)) : "";
  if (lb !== chain[chain.length - 1].sha) out("FAIL", `${path.basename(last)} is not the latest accepted baseline of the chain (${chain[chain.length - 1].id} ${chain[chain.length - 1].file})`);
  else console.log(`\nOK      ${path.basename(last)} is the latest accepted baseline (${chain[chain.length - 1].id})`);
}
console.log(`\nTRACE steps=${Math.max(chain.length - 1, 0)} known=${known} staging=${staging} fail=${fail}`);
process.exit(fail === 0 ? 0 : 3);
