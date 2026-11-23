#!/usr/bin/env node
// Self-test of check-archive.mjs: builds one valid archive and many hostile ones in a temporary directory (tar written
// by hand here, so every malformed case can be expressed) and requires PASS for the valid one and FAIL, with the
// expected reason, for each hostile one. Writes only inside its own temporary directory, which it removes.
//   node test-check-archive.mjs
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const CHECK = join(dirname(fileURLToPath(import.meta.url)), "check-archive.mjs");
const dir = mkdtempSync(join(tmpdir(), "po07-archive-test-"));
const sha = (b) => createHash("sha256").update(b).digest("hex");

function header({ name, type = "0", size = 0, mode = 0o644, linkname = "", magic = "ustar\0", version = "00" }) {
  const h = Buffer.alloc(512);
  const put = (off, len, s) => Buffer.from(s, "utf8").copy(h, off, 0, len);
  const oct = (off, len, v) => put(off, len, v.toString(8).padStart(len - 1, "0") + "\0");
  put(0, 100, name); oct(100, 8, mode); oct(108, 8, 0); oct(116, 8, 0); oct(124, 12, size); oct(136, 12, 1700000000);
  h.fill(0x20, 148, 156); h.write(type, 156, "latin1"); put(157, 100, linkname);
  h.write(magic, 257, "latin1"); h.write(version, 263, "latin1");
  let sum = 0; for (const b of h) sum += b;
  put(148, 8, sum.toString(8).padStart(6, "0") + "\0 ");
  return h;
}
const pad = (b) => Buffer.concat([b, Buffer.alloc((512 - (b.length % 512)) % 512)]);
const paxRecord = (k, v) => { const body = ` ${k}=${v}\n`; let n = body.length + 1; while (String(n).length + body.length !== n) n++; return `${n}${body}`; };

// entries: {name, data?, type?, mode?, linkname?, pax?: {k: v}, raw?: Buffer}
function tarOf(entries, { trailer = Buffer.alloc(1024) } = {}) {
  const parts = [];
  for (const e of entries) {
    if (e.raw) { parts.push(e.raw); continue; }
    if (e.pax) {
      const data = Buffer.from(Object.entries(e.pax).map(([k, v]) => paxRecord(k, v)).join(""), "utf8");
      parts.push(header({ name: "PaxHeaders/x", type: "x", size: data.length }), pad(data));
    }
    const data = e.data === undefined ? Buffer.alloc(0) : Buffer.from(e.data);
    parts.push(header({ name: e.name, type: e.type ?? "0", size: data.length, mode: e.mode ?? (e.type === "5" ? 0o755 : 0o644), linkname: e.linkname ?? "" }));
    if (data.length) parts.push(pad(data));
  }
  parts.push(trailer);
  return gzipSync(Buffer.concat(parts));
}

// A consistent artifact: metadata generated from the payload entries.
function artifact(payload, { tamper } = {}) {
  const files = payload.filter((e) => (e.type ?? "0") === "0");
  const links = payload.filter((e) => e.type === "2");
  const rel = (n) => n.slice("po07-artifact/".length);
  const manifest = files.map((e) => `${sha(Buffer.from(e.data ?? ""))}  ${rel(e.name)}\n`).sort().join("");
  const symlinks = links.map((e) => `${rel(e.name)}\t${e.linkname}\n`).sort().join("");
  const art = {
    schema: "po07-staging-artifact/1", build_id: "test-build-id", source: { sha: "a".repeat(40) },
    contents: { files: files.length, symlinks: links.length, manifest_sha256: sha(manifest), symlinks_sha256: sha(symlinks) },
  };
  const ents = [
    { name: "po07-artifact/", type: "5" },
    ...payload,
    { name: "po07-artifact/ARTIFACT.json", data: JSON.stringify(art) },
    { name: "po07-artifact/MANIFEST.sha256", data: manifest },
    { name: "po07-artifact/SYMLINKS.txt", data: symlinks },
  ];
  if (tamper) tamper(ents);
  return ents;
}
const base = () => [
  { name: "po07-artifact/.next/", type: "5" },
  { name: "po07-artifact/.next/BUILD_ID", data: "test-build-id" },
  { name: "po07-artifact/.next/server/", type: "5" },
  { name: "po07-artifact/.next/server/page.js", data: "module.exports = 1;\n" },
  { name: "po07-artifact/.next/node_modules/", type: "5" },
  { name: "po07-artifact/.next/node_modules/pg-0123", type: "2", linkname: "../../node_modules/pg" },
  { name: "po07-artifact/node_modules/", type: "5" },
  { name: "po07-artifact/node_modules/pg/", type: "5" },
  { name: "po07-artifact/node_modules/pg/index.js", data: "module.exports = {};\n" },
  { name: "po07-artifact/node_modules/.bin/", type: "5" },
  { name: "po07-artifact/node_modules/.bin/tool", type: "2", linkname: "../pg/index.js" },
  { name: "po07-artifact/node_modules/pg/bin.js", data: "#!/usr/bin/env node\n", mode: 0o755 },
  { name: `po07-artifact/node_modules/pg/${"long-name-".repeat(14)}.js`, data: "x", pax: { path: `po07-artifact/node_modules/pg/${"long-name-".repeat(14)}.js` } },
];
const withPayload = (extra, opts) => artifact([...base(), ...extra], opts);

const cases = [
  ["valid archive", tarOf(withPayload([])), "PASS"],
  ["valid archive, --expect matches", tarOf(withPayload([])), "PASS", ["--expect", `source.sha=${"a".repeat(40)}`]],
  ["--expect mismatch", tarOf(withPayload([])), "expected", ["--expect", "source.sha=wrong"]],
  ["path traversal", tarOf(withPayload([{ name: "po07-artifact/../evil", data: "x" }])), '".." component'],
  ["absolute path", tarOf(withPayload([{ name: "/etc/evil", data: "x" }])), "absolute name"],
  ["outside the root", tarOf(withPayload([{ name: "other/file", data: "x" }])), "outside po07-artifact/"],
  ["unexpected top-level member", tarOf(withPayload([{ name: "po07-artifact/run.sh", data: "x" }])), "not an allowed top-level member"],
  ["link escaping the root", tarOf(withPayload([{ name: "po07-artifact/node_modules/up", type: "2", linkname: "../../../etc" }])), "link escapes"],
  ["absolute link target", tarOf(withPayload([{ name: "po07-artifact/node_modules/abs", type: "2", linkname: "/etc/passwd" }])), "absolute or malformed link target"],
  ["write through a link", tarOf(withPayload([{ name: "po07-artifact/node_modules/d", type: "2", linkname: "pg" }, { name: "po07-artifact/node_modules/d/f", data: "x" }])), "entry beneath a symbolic link"],
  ["link over a directory", tarOf(withPayload([{ name: "po07-artifact/node_modules/pg", type: "2", linkname: ".bin" }])), "duplicate entry"],
  ["hard link", tarOf(withPayload([{ name: "po07-artifact/node_modules/h", type: "1", linkname: "po07-artifact/node_modules/pg/index.js" }])), "hard link not allowed"],
  ["character device", tarOf(withPayload([{ name: "po07-artifact/node_modules/dev", type: "3" }])), "character device not allowed"],
  ["FIFO", tarOf(withPayload([{ name: "po07-artifact/node_modules/fifo", type: "6" }])), "FIFO not allowed"],
  ["setuid file", tarOf(withPayload([{ name: "po07-artifact/node_modules/pg/su", data: "x", mode: 0o4755 }])), "setuid/setgid/sticky"],
  ["world-writable file", tarOf(withPayload([{ name: "po07-artifact/node_modules/pg/ww", data: "x", mode: 0o666 }])), "group- or world-writable"],
  ["tampered file", tarOf(withPayload([], { tamper: (e) => { e.find((x) => x.name.endsWith("server/page.js")).data = "evil();\n"; } })), "SHA-256 mismatch"],
  ["file missing from MANIFEST", tarOf(withPayload([], { tamper: (e) => e.splice(e.length - 3, 0, { name: "po07-artifact/node_modules/pg/extra.js", data: "x" }) })), "file not in MANIFEST"],
  ["MANIFEST lists a missing file", tarOf(withPayload([], { tamper: (e) => { const i = e.findIndex((x) => x.name.endsWith("pg/index.js")); e.splice(i, 1); } })), "MANIFEST lists a file the archive lacks"],
  ["changed link target", tarOf(withPayload([], { tamper: (e) => { e.find((x) => x.name.endsWith(".bin/tool")).linkname = "../pg/bin.js"; } })), "link not in SYMLINKS.txt"],
  ["duplicate entry", tarOf(withPayload([{ name: "po07-artifact/node_modules/pg/index.js", data: "module.exports = {};\n" }])), "duplicate entry"],
  ["GNU long-name record", tarOf(withPayload([{ name: "././@LongLink", type: "L", data: "po07-artifact/x" }])), "GNU long name not allowed"],
  ["extended attribute (pax xattr)", tarOf(withPayload([{ name: "po07-artifact/node_modules/pg/cap", data: "x", pax: { "SCHILY.xattr.security.capability": "x" } }])), "pax key not allowed"],
  ["GNU (non-POSIX) header", tarOf([{ raw: header({ name: "po07-artifact/", type: "5", magic: "ustar ", version: " \0" }) }]), "not a POSIX ustar/pax header"],
  ["bad header checksum", tarOf([{ raw: (() => { const h = header({ name: "po07-artifact/", type: "5" }); h[0] ^= 1; return h; })() }]), "header checksum mismatch"],
  ["data after the end of the archive", tarOf(withPayload([]), { trailer: Buffer.concat([Buffer.alloc(1024), Buffer.from("garbage")]) }), "non-zero bytes after the end"],
  ["truncated archive", gzipSync(Buffer.concat([header({ name: "po07-artifact/f", size: 4096 }), Buffer.alloc(100)])), "truncated archive"],
  ["not gzip", Buffer.from("plain text, not an archive"), "ARCHIVE-CHECK FAIL"],
];

let pass = 0, fail = 0;
for (const [label, bytes, want, extra = []] of cases) {
  const f = join(dir, `${label.replace(/[^a-z0-9]+/gi, "-")}.tar.gz`);
  writeFileSync(f, bytes);
  const r = spawnSync(process.execPath, [CHECK, f, ...extra], { encoding: "utf8" });
  const out = `${r.stdout}${r.stderr}`;
  const good = want === "PASS" ? r.status === 0 && out.includes("ARCHIVE-CHECK PASS") : r.status === 1 && out.includes(want) && out.includes("ARCHIVE-CHECK FAIL");
  good ? pass++ : fail++;
  console.log(`${good ? "PASS" : "FAIL"} ${label} → ${want === "PASS" ? "accepted" : `rejected (${want})`}${good ? "" : `\n${out.trim().split("\n").slice(-4).join("\n")}`}`);
}
rmSync(dir, { recursive: true, force: true });
console.log(`ARCHIVE-SELFTEST pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
