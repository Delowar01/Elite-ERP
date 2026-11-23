// PO-07 S9 (D31): the CUSTOMER SERVICE renders a document PDF through its own route — once, then two at once — within
// its task, memory and CPU limits, and the slice stays clear of its task ceiling. Runs on the host as root (only root
// can open the proxy socket). Fictional data only: one sign-up (example.invalid), one client and one quotation for it
// in the staging database. Prints counters and statuses — never a cookie, a password or a secret.
// Usage: node s9-pdf-load.mjs <config.json>   (written by s9_units_start.sh)
import http from "node:http";
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";

const C = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const CCOOKIE = "__Host-elite_erp_session";
let pass = 0, fail = 0;
const rec = (ok, name, detail = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); };
const raw = (method, path, headers, body) => new Promise((res, rej) => {
  const req = http.request({ socketPath: C.custSock, method, path, headers: { host: C.custHost, "x-forwarded-host": C.custHost, "x-forwarded-proto": "https", ...headers } }, (r) => {
    const chunks = []; r.on("data", (c) => chunks.push(c));
    r.on("end", () => res({ status: r.statusCode, headers: r.headers, body: Buffer.concat(chunks) }));
  });
  req.setTimeout(120000, () => req.destroy(new Error("timeout")));
  req.on("error", rej);
  if (body) req.write(body);
  req.end();
});
const manifest = JSON.parse(fs.readFileSync(`${C.appDir}/.next/server/server-reference-manifest.json`, "utf8"));
const actionId = (name) => Object.entries(manifest.node).filter(([, v]) => v.exportedName === name).map(([id]) => id)[0] ?? null;
async function postForm(path, name, fields) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(`_1_${k}`, v);
  fd.append("0", JSON.stringify(["$undefined", "$K1"]));
  const r = new Request("http://encoder.invalid/", { method: "POST", body: fd });
  return raw("POST", path, { "next-action": actionId(name), accept: "text/x-component", "sec-fetch-site": "same-origin", origin: `https://${C.custHost}`,
    "content-type": r.headers.get("content-type") }, Buffer.from(await r.arrayBuffer()));
}
const psql = (sql) => {
  const r = spawnSync(C.psql[0], [...C.psql.slice(1), "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`psql: ${r.stderr.split("\n")[0]}`);
  return r.stdout.trim();
};
// cgroup v2 counters of the customer unit and of the slice
const cg = (rel, f) => { try { return fs.readFileSync(`/sys/fs/cgroup${rel}/${f}`, "utf8").trim(); } catch { return ""; } };
const kv = (txt) => Object.fromEntries(txt.split("\n").filter(Boolean).map((l) => l.split(" ")).map(([k, v]) => [k, Number(v)]));
const snap = (rel) => ({ pidsEvents: kv(cg(rel, "pids.events")), memEvents: kv(cg(rel, "memory.events")), cpu: kv(cg(rel, "cpu.stat")) });
const peaks = { cust: 0, slice: 0, custMem: 0, sliceMem: 0 };
const sample = () => {
  peaks.cust = Math.max(peaks.cust, Number(cg(C.custCg, "pids.current")) || 0);
  peaks.slice = Math.max(peaks.slice, Number(cg(C.sliceCg, "pids.current")) || 0);
  peaks.custMem = Math.max(peaks.custMem, Number(cg(C.custCg, "memory.current")) || 0);
  peaks.sliceMem = Math.max(peaks.sliceMem, Number(cg(C.sliceCg, "memory.current")) || 0);
};

// 1. a fictional customer company and its session (the customer's own sign-up)
const email = `pdf-test-${randomBytes(4).toString("hex")}@example.invalid`;
const pw = `Pdf-${randomBytes(18).toString("base64url")}!9a`;
const reg = await postForm("/register", "registerAction", { orgName: "PDF Fictional Test Co", name: "PDF Test", email, password: pw, country: "Saudi Arabia", currency: "SAR" });
const ck = [].concat(reg.headers["set-cookie"] ?? []).find((c) => c.startsWith(`${CCOOKIE}=`));
rec(Boolean(ck), "a fictional sign-up on the customer host gives a session", `${reg.status}`);
const cookie = ck ? ck.split(";")[0] : "";
// 2. one fictional client and one quotation for that company (the staging database; nothing else is touched)
let qid = "";
try {
  qid = psql(`with u as (select id, org_id from users where email = '${email}'), c as (insert into customers (org_id, name) select org_id, 'PDF Test Client (fictional)' from u returning id, org_id)
    insert into quotations (org_id, quotation_number, title, customer_id, issue_date, created_by_id) select c.org_id, 'QT-PO07-PDF-0001', 'PO-07 D31 fictional quotation', c.id, current_date, u.id from c, u returning id;`).split("\n")[0];
} catch (e) { console.log(`psql failed: ${e.message}`); }
rec(/^\d+$/.test(qid), "one fictional client and quotation exist for that company", qid ? `quotation ${qid}` : "none");
// the print view the PDF is made from shows THIS quotation for THIS session (so a PDF below is the document, not a
// redirect target such as the sign-in page)
if (qid && cookie) {
  const pv = await raw("GET", `/print/quotation/${qid}`, { cookie });
  rec(pv.status === 200 && pv.body.toString("utf8").includes("QT-PO07-PDF-0001"), "the print view of that quotation renders for its session", `${pv.status}`);
}
// 3. one PDF, then two at once, through the customer process's own route (Chromium inside the customer unit)
const before = { cust: snap(C.custCg), slice: snap(C.sliceCg) };
const timer = setInterval(sample, 100);
const pdf = async () => {
  const r = await raw("GET", `/api/document-pdf/quotation/${qid}`, { cookie });
  return { status: r.status, type: String(r.headers["content-type"] ?? ""), head: r.body.subarray(0, 5).toString("latin1"), bytes: r.body.length };
};
const okPdf = (p) => p.status === 200 && /application\/pdf/.test(p.type) && p.head === "%PDF-" && p.bytes > 1000;
let one = null, two = [];
if (qid && cookie) {
  const t1 = Date.now(); one = await pdf(); const d1 = Date.now() - t1;
  rec(okPdf(one), "one PDF: 200, application/pdf, %PDF-", `${one.status} ${one.bytes} bytes ${d1} ms`);
  const t2 = Date.now(); two = await Promise.all([pdf(), pdf()]); const d2 = Date.now() - t2;
  rec(two.length === 2 && two.every(okPdf), "two concurrent PDFs: both 200, application/pdf, %PDF-", `${two.map((p) => `${p.status}/${p.bytes}`).join(" ")} in ${d2} ms`);
}
sample(); clearInterval(timer);
const after = { cust: snap(C.custCg), slice: snap(C.sliceCg) };
// 4. the limits: no fork refused, no memory limit reached, task peaks clear of 90 % of each ceiling
const d = (a, b, k) => (b[k] ?? 0) - (a[k] ?? 0);
const custPeak = Math.max(peaks.cust, Number(cg(C.custCg, "pids.peak")) || 0);
console.log(`TASKS customer unit: peak ${custPeak} of ${C.custTasksMax} (sampled ${peaks.cust}); slice: sampled peak ${peaks.slice} of ${C.sliceTasksMax} during the PDFs (lifetime peak ${cg(C.sliceCg, "pids.peak")})`);
console.log(`MEMORY customer unit: peak ${Math.round(peaks.custMem / 1048576)} MB sampled (unit peak ${Math.round(Number(cg(C.custCg, "memory.peak")) / 1048576)} MB) of MemoryHigh ${C.custMemHighMB} / MemoryMax ${C.custMemMaxMB} MB; slice sampled peak ${Math.round(peaks.sliceMem / 1048576)} MB`);
console.log(`CPU customer unit: ${(d(before.cust.cpu, after.cust.cpu, "usage_usec") / 1e6).toFixed(1)} s CPU; throttled ${d(before.cust.cpu, after.cust.cpu, "nr_throttled")} periods (${(d(before.cust.cpu, after.cust.cpu, "throttled_usec") / 1e6).toFixed(1)} s) — the CPUQuota doing its job, never exceeded`);
rec(d(before.cust.pidsEvents, after.cust.pidsEvents, "max") === 0 && d(before.slice.pidsEvents, after.slice.pidsEvents, "max") === 0, "no task (fork/thread) was refused in the customer unit or the slice");
rec(custPeak <= Math.floor(C.custTasksMax * 0.9), `customer unit task peak ${custPeak} stays under 90 % of its TasksMax (${Math.floor(C.custTasksMax * 0.9)})`);
rec(peaks.slice <= Math.floor(C.sliceTasksMax * 0.9), `slice task peak ${peaks.slice} stays under 90 % of the slice TasksMax (${Math.floor(C.sliceTasksMax * 0.9)})`);
for (const [k, label] of [["max", "MemoryMax"], ["oom", "an OOM"], ["oom_kill", "an OOM kill"], ["high", "MemoryHigh"]]) {
  rec(d(before.cust.memEvents, after.cust.memEvents, k) === 0 && d(before.slice.memEvents, after.slice.memEvents, k) === 0, `no ${label} event in the customer unit or the slice`);
}
console.log(`PDF-LOAD pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
