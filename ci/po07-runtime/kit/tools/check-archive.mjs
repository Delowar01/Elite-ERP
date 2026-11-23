#!/usr/bin/env node
// PO-07 S6-R: validates a staging build archive (gzip-compressed POSIX tar) WITHOUT extracting it.
//
//   node check-archive.mjs <archive.tar.gz | -> [--expect dotted.key=value]... [--print-artifact-json]
//
// The same file runs in three places: in CI before upload, on the owner's PC after download, and on the staging VPS
// before extraction. It reads the archive as a stream, writes nothing, and exits 0 only if ALL of these hold:
//   - format: gzip + POSIX ustar/pax only (no GNU long-name records, no global pax headers), valid header checksums,
//     zero-filled end of archive;
//   - entry types: regular files, directories and symbolic links only (no hard links, devices, FIFOs, sparse files,
//     extended attributes);
//   - names: relative, under "po07-artifact/" only, no "." / ".." / empty component, no NUL, backslash, tab or
//     newline, no duplicates; top level limited to .next, node_modules and the three metadata files;
//   - symbolic links: relative targets that stay inside "po07-artifact/", and no entry beneath a symbolic link (so
//     extraction can never write through one);
//   - permissions: no setuid, setgid or sticky bit, nothing group- or world-writable;
//   - size limits (no decompression bomb);
//   - integrity: every regular file's SHA-256 equals MANIFEST.sha256, every link equals SYMLINKS.txt, and the two lists
//     have exactly the archive's members (nothing extra, nothing missing);
//   - ARTIFACT.json parses, has the expected schema, and every --expect matches.
import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { createHash } from "node:crypto";
import path from "node:path/posix";

const ROOT = "po07-artifact";
const META = new Set(["ARTIFACT.json", "MANIFEST.sha256", "SYMLINKS.txt"]);
const ROOT_CHILDREN = new Set([".next", "node_modules", ...META]);
const LIMITS = { entries: 300_000, fileBytes: 1024 ** 3, totalBytes: 4 * 1024 ** 3, metaBytes: 64 * 1024 ** 2 };
const PAX_KEYS = new Set(["path", "linkpath", "size", "mtime", "atime", "ctime", "uid", "gid", "uname", "gname", "charset", "hdrcharset"]);
const SCHEMA = "po07-staging-artifact/1";

const argv = process.argv.slice(2);
const source = argv.shift();
const expects = [];
let printArtifact = false;
while (argv.length) {
  const a = argv.shift();
  if (a === "--expect") expects.push(argv.shift() ?? "");
  else if (a === "--print-artifact-json") printArtifact = true;
  else usage(`unknown argument ${a}`);
}
if (!source) usage("no archive given");
function usage(msg) {
  console.error(`check-archive: ${msg}\nusage: node check-archive.mjs <archive.tar.gz|-> [--expect key=value]... [--print-artifact-json]`);
  process.exit(64);
}

const problems = [];
const bad = (m) => { if (problems.length < 50) problems.push(m); };

class Reader {
  constructor(stream) { this.it = stream[Symbol.asyncIterator](); this.buf = Buffer.alloc(0); this.eof = false; }
  async fill(n) {
    while (this.buf.length < n && !this.eof) {
      const { value, done } = await this.it.next();
      if (done) this.eof = true;
      else this.buf = this.buf.length ? Buffer.concat([this.buf, value]) : value;
    }
  }
  async exact(n) {
    await this.fill(n);
    if (this.buf.length < n) throw new Error("truncated archive");
    const out = this.buf.subarray(0, n); this.buf = this.buf.subarray(n); return out;
  }
  async some(max) { // at least one byte, at most max
    await this.fill(1);
    if (!this.buf.length) throw new Error("truncated archive");
    const n = Math.min(max, this.buf.length); const out = this.buf.subarray(0, n); this.buf = this.buf.subarray(n); return out;
  }
  async skip(n) { while (n > 0) n -= (await this.some(Math.min(n, 1 << 20))).length; }
  async restIsZero() {
    for (;;) {
      await this.fill(1);
      if (!this.buf.length) return true;
      if (this.buf.some((b) => b !== 0)) return false;
      this.buf = Buffer.alloc(0);
    }
  }
}

const str = (b) => { const i = b.indexOf(0); return (i < 0 ? b : b.subarray(0, i)).toString("utf8"); };
function num(b, field) {
  if (b[0] & 0x80) throw new Error(`base-256 ${field} field (not produced by the packager)`);
  const s = b.toString("latin1").replace(/\0[\s\S]*$/, "").trim();
  if (s === "") return 0;
  if (!/^[0-7]+$/.test(s)) throw new Error(`bad octal ${field} field`);
  return parseInt(s, 8);
}
function checksumOk(h) {
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
  return sum === num(h.subarray(148, 156), "checksum");
}
function parsePax(data) {
  const out = {};
  let i = 0;
  while (i < data.length) {
    const sp = data.indexOf(0x20, i);
    if (sp < 0) throw new Error("bad pax record");
    const len = Number(data.subarray(i, sp).toString("latin1"));
    if (!Number.isInteger(len) || len <= 0 || i + len > data.length || data[i + len - 1] !== 0x0a) throw new Error("bad pax record length");
    const rec = data.subarray(sp + 1, i + len - 1).toString("utf8");
    const eq = rec.indexOf("=");
    if (eq < 0) throw new Error("bad pax record");
    out[rec.slice(0, eq)] = rec.slice(eq + 1);
    i += len;
  }
  for (const k of Object.keys(out)) if (!PAX_KEYS.has(k)) throw new Error(`pax key not allowed: ${k}`);
  return out;
}

// name → normalised relative path ("po07-artifact/…" without a trailing slash), or null after recording why
function checkName(raw, isDir) {
  let n = raw;
  if (isDir && n.endsWith("/")) n = n.slice(0, -1);
  if (!n) return bad("empty name"), null;
  if (/[\0\\\t\n\r]/.test(n)) return bad(`forbidden character in name: ${JSON.stringify(raw).slice(0, 200)}`), null;
  if (n.startsWith("/")) return bad(`absolute name: ${raw}`), null;
  const parts = n.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) return bad(`"", "." or ".." component: ${raw}`), null;
  if (parts[0] !== ROOT) return bad(`outside ${ROOT}/: ${raw}`), null;
  if (parts.length === 1 && !isDir) return bad(`${ROOT} is not a directory`), null;
  if (parts.length >= 2 && !ROOT_CHILDREN.has(parts[1])) return bad(`not an allowed top-level member: ${parts[1]}`), null;
  if (parts.length === 2 && META.has(parts[1]) && isDir) return bad(`${parts[1]} must be a file`), null;
  if (parts.length > 2 && META.has(parts[1])) return bad(`entry beneath a metadata file: ${raw}`), null;
  return n;
}

const seen = new Set(), ancestors = new Set(), links = new Map(), files = new Map(), metaData = new Map();
let entries = 0, totalBytes = 0, dirs = 0, buildIdText = null;

async function main() {
  const input = source === "-" ? process.stdin : createReadStream(source);
  const gunzip = createGunzip();
  input.on("error", (e) => gunzip.destroy(e));
  const r = new Reader(input.pipe(gunzip));
  let pax = null;
  for (;;) {
    const h = await r.exact(512);
    if (h.every((b) => b === 0)) {
      await r.fill(512);
      const next = r.buf.length >= 512 ? await r.exact(512) : Buffer.alloc(512);
      if (next.some((b) => b !== 0)) bad("data after the first end-of-archive block");
      if (!(await r.restIsZero())) bad("non-zero bytes after the end of the archive");
      break;
    }
    if (!checksumOk(h)) throw new Error(`header checksum mismatch after ${entries} entries`);
    if (h.subarray(257, 263).toString("latin1") !== "ustar\0" || h.subarray(263, 265).toString("latin1") !== "00") throw new Error("not a POSIX ustar/pax header");
    const type = String.fromCharCode(h[156] || 0x30);
    let size = num(h.subarray(124, 136), "size");
    const prefix = str(h.subarray(345, 500));
    let name = (prefix ? `${prefix}/` : "") + str(h.subarray(0, 100));
    let linkname = str(h.subarray(157, 257));
    const mode = num(h.subarray(100, 108), "mode");
    if (type === "x") {
      if (pax) throw new Error("two pax headers in a row");
      if (size > 1 << 20) throw new Error("pax header too large");
      const data = await r.exact(size);
      await r.skip((512 - (size % 512)) % 512);
      pax = parsePax(data);
      continue;
    }
    if (pax) {
      if (pax.path !== undefined) name = pax.path;
      if (pax.linkpath !== undefined) linkname = pax.linkpath;
      if (pax.size !== undefined) { if (!/^\d+$/.test(pax.size)) throw new Error("bad pax size"); size = Number(pax.size); }
      pax = null;
    }
    if (++entries > LIMITS.entries) throw new Error(`more than ${LIMITS.entries} entries`);
    const isFile = type === "0", isDir = type === "5", isLink = type === "2";
    if (!isFile && !isDir && !isLink) {
      const what = { 1: "hard link", 3: "character device", 4: "block device", 6: "FIFO", 7: "contiguous file", g: "global pax header", L: "GNU long name", K: "GNU long link", S: "GNU sparse file" }[type] ?? `type ${JSON.stringify(type)}`;
      bad(`${what} not allowed: ${name}`);
      await r.skip(size + ((512 - (size % 512)) % 512));
      continue;
    }
    const n = checkName(name, isDir);
    if (n) {
      if (seen.has(n)) bad(`duplicate entry: ${n}`);
      seen.add(n);
      const parts = n.split("/");
      for (let i = 1; i < parts.length; i++) {
        const a = parts.slice(0, i).join("/");
        if (links.has(a)) bad(`entry beneath a symbolic link: ${n} (link ${a})`);
        ancestors.add(a);
      }
      if (!isLink && (mode & 0o7000)) bad(`setuid/setgid/sticky bit: ${n} (${mode.toString(8)})`);
      if (!isLink && (mode & 0o022)) bad(`group- or world-writable: ${n} (${mode.toString(8)})`);
    }
    if (isDir || isLink) {
      if (size !== 0) bad(`${isDir ? "directory" : "symbolic link"} with data: ${name}`);
      await r.skip(size + ((512 - (size % 512)) % 512));
      if (isDir) dirs++;
      if (isLink && n) {
        if (n.split("/").length < 3) bad(`symbolic link at the top level: ${n}`);
        if (ancestors.has(n)) bad(`symbolic link over an existing directory: ${n}`);
        if (!linkname || linkname.startsWith("/") || /[\0\\\t\n\r]/.test(linkname)) bad(`absolute or malformed link target: ${n} -> ${linkname}`);
        else {
          const to = path.normalize(path.join(path.dirname(n), linkname));
          if (to !== ROOT && !to.startsWith(`${ROOT}/`)) bad(`link escapes ${ROOT}/: ${n} -> ${linkname}`);
        }
        links.set(n, linkname);
      }
      continue;
    }
    // regular file
    if (size > LIMITS.fileBytes) throw new Error(`file larger than ${LIMITS.fileBytes} bytes: ${name}`);
    totalBytes += size;
    if (totalBytes > LIMITS.totalBytes) throw new Error(`more than ${LIMITS.totalBytes} bytes in total`);
    const rel = n ? n.slice(ROOT.length + 1) : null;
    const isMeta = rel !== null && (META.has(rel) || rel === ".next/BUILD_ID");
    if (isMeta && size > LIMITS.metaBytes) throw new Error(`${rel} too large`);
    const hash = createHash("sha256"), keep = [];
    let left = size;
    while (left > 0) {
      const c = await r.some(Math.min(left, 1 << 20));
      hash.update(c); if (isMeta) keep.push(Buffer.from(c));
      left -= c.length;
    }
    await r.skip((512 - (size % 512)) % 512);
    if (rel === null) continue;
    if (rel === ".next/BUILD_ID") buildIdText = Buffer.concat(keep).toString("utf8");
    if (META.has(rel)) metaData.set(rel, Buffer.concat(keep).toString("utf8"));
    else files.set(rel, hash.digest("hex"));
  }

  // ---- integrity against the embedded lists ----
  for (const m of META) if (!metaData.has(m)) bad(`missing ${m}`);
  if (!files.has(".next/BUILD_ID")) bad("missing .next/BUILD_ID");
  if (metaData.has("MANIFEST.sha256")) {
    const listed = new Map();
    for (const line of metaData.get("MANIFEST.sha256").split("\n")) {
      if (!line) continue;
      const m = /^([0-9a-f]{64}) [ *](.+)$/.exec(line); // GNU sha256sum: "<hash>  <name>" (text) or "<hash> *<name>" (binary)
      if (!m) { bad(`malformed MANIFEST line: ${line.slice(0, 120)}`); continue; }
      if (listed.has(m[2])) bad(`MANIFEST lists ${m[2]} twice`);
      listed.set(m[2], m[1]);
    }
    for (const [f, h] of files) if (!listed.has(f)) bad(`file not in MANIFEST: ${f}`); else if (listed.get(f) !== h) bad(`SHA-256 mismatch: ${f}`);
    for (const f of listed.keys()) if (!files.has(f)) bad(`MANIFEST lists a file the archive lacks: ${f}`);
  }
  if (metaData.has("SYMLINKS.txt")) {
    const listed = new Map();
    for (const line of metaData.get("SYMLINKS.txt").split("\n")) {
      if (!line) continue;
      const t = line.indexOf("\t");
      if (t < 0) { bad(`malformed SYMLINKS line: ${line.slice(0, 120)}`); continue; }
      listed.set(line.slice(0, t), line.slice(t + 1));
    }
    const actual = new Map([...links].map(([k, v]) => [k.slice(ROOT.length + 1), v]));
    for (const [l, t] of actual) if (listed.get(l) !== t) bad(`link not in SYMLINKS.txt as archived: ${l} -> ${t}`);
    for (const l of listed.keys()) if (!actual.has(l)) bad(`SYMLINKS.txt lists a link the archive lacks: ${l}`);
  }
  let artifact = null;
  if (metaData.has("ARTIFACT.json")) {
    try { artifact = JSON.parse(metaData.get("ARTIFACT.json")); } catch { bad("ARTIFACT.json does not parse"); }
    if (artifact) {
      if (artifact.schema !== SCHEMA) bad(`ARTIFACT.json schema is not ${SCHEMA}`);
      if (buildIdText === null || artifact.build_id !== buildIdText.trim()) bad(`ARTIFACT.json build_id ${JSON.stringify(artifact.build_id)} differs from .next/BUILD_ID`);
      if (artifact.contents?.files !== files.size) bad(`ARTIFACT.json says ${artifact.contents?.files} files, the archive has ${files.size}`);
      if (artifact.contents?.symlinks !== links.size) bad(`ARTIFACT.json says ${artifact.contents?.symlinks} links, the archive has ${links.size}`);
      const sha = (s) => createHash("sha256").update(s).digest("hex");
      if (metaData.has("MANIFEST.sha256") && artifact.contents?.manifest_sha256 !== sha(metaData.get("MANIFEST.sha256"))) bad("ARTIFACT.json manifest_sha256 does not match MANIFEST.sha256");
      if (metaData.has("SYMLINKS.txt") && artifact.contents?.symlinks_sha256 !== sha(metaData.get("SYMLINKS.txt"))) bad("ARTIFACT.json symlinks_sha256 does not match SYMLINKS.txt");
      for (const e of expects) {
        const eq = e.indexOf("=");
        if (eq < 1) { bad(`bad --expect ${e}`); continue; }
        const key = e.slice(0, eq), want = e.slice(eq + 1);
        const got = key.split(".").reduce((o, k) => (o == null ? undefined : o[k]), artifact);
        if (String(got) !== want) bad(`ARTIFACT.json ${key} is ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
      }
    }
  }
  return artifact;
}

try {
  const artifact = await main();
  if (printArtifact && artifact) console.log(JSON.stringify(artifact, null, 2));
  for (const p of problems) console.log(`FAIL ${p}`);
  const stats = `entries=${entries} files=${files.size} dirs=${dirs} symlinks=${links.size} bytes=${totalBytes}`;
  if (problems.length) { console.log(`ARCHIVE-CHECK FAIL ${problems.length >= 50 ? "50+" : problems.length} problem(s) ${stats}`); process.exit(1); }
  console.log(`ARCHIVE-CHECK PASS ${stats}`);
} catch (e) {
  for (const p of problems) console.log(`FAIL ${p}`);
  console.log(`ARCHIVE-CHECK FAIL ${e.message}`);
  process.exit(1);
}
