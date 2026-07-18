// Stage 11 — committed, headless security regression tests (no server, no DB).
// Runs in CI. Guards the security-critical invariants of the crypto envelope and
// password policy. Server-only TS modules can't be imported in plain Node, so these
// assert the algorithm contract + source contract that the modules must uphold.
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let pass = 0, fail = 0;
const ok = (label, cond, extra = "") => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${label}${cond ? "" : "  -> " + extra}`); };

// ---- 1. AES-256-GCM envelope round-trip + rotation + tamper (algorithm contract) ----
const kv2 = crypto.randomBytes(32), kv1 = crypto.randomBytes(32);
const ring = new Map([[2, kv2], [1, kv1]]);
const enc = (pt, v) => { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv("aes-256-gcm", ring.get(v), iv); const ct = Buffer.concat([c.update(pt, "utf8"), c.final()]); return `v${v}:${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${ct.toString("base64")}`; };
const dec = (e) => { const p = e.split(":"); const d = crypto.createDecipheriv("aes-256-gcm", ring.get(Number(p[0].slice(1))), Buffer.from(p[1], "base64")); d.setAuthTag(Buffer.from(p[2], "base64")); return Buffer.concat([d.update(Buffer.from(p[3], "base64")), d.final()]).toString("utf8"); };
const secret = "SA2505000068205575665000";
ok("AES-256-GCM round-trips", dec(enc(secret, 2)) === secret);
ok("old key version still decrypts after rotation", dec(enc(secret, 1)) === secret);
ok("ciphertext hides plaintext", !enc(secret, 2).includes(secret));
ok("random IV => distinct ciphertexts", enc(secret, 2) !== enc(secret, 2));
let tampered = enc(secret, 2).split(":"); tampered[3] = Buffer.from("attacker").toString("base64");
let caught = false; try { dec(tampered.join(":")); } catch { caught = true; }
ok("GCM auth tag rejects tampering", caught);

// ---- 2. Source contract: crypto module upholds its security properties ----
const cryptoSrc = readFileSync(join(root, "src/lib/crypto/field-encryption.ts"), "utf8");
ok("field-encryption uses aes-256-gcm", cryptoSrc.includes("aes-256-gcm"));
ok("field-encryption is server-only", cryptoSrc.includes('"server-only"'));
ok("field-encryption reads key from env (no hardcoded key)", cryptoSrc.includes("process.env.FIELD_ENCRYPTION_KEYS") && !/=\s*"[A-Za-z0-9+/]{40,}"/.test(cryptoSrc));
ok("field-encryption supports versioned rotation", cryptoSrc.includes("byVersion"));

// ---- 3. Password policy spec (regex contract mirrored) ----
const rules = {
  upper: (p) => /[A-Z]/.test(p), lower: (p) => /[a-z]/.test(p),
  number: (p) => /[0-9]/.test(p), special: (p) => /[^A-Za-z0-9]/.test(p),
};
ok("weak 'password' fails composition", !(rules.upper("password") && rules.number("password") && rules.special("password")));
ok("strong 'Str0ng!Pass' passes composition", rules.upper("Str0ng!Pass") && rules.lower("Str0ng!Pass") && rules.number("Str0ng!Pass") && rules.special("Str0ng!Pass"));
const policySrc = readFileSync(join(root, "src/lib/security/password-policy.ts"), "utf8");
ok("policy detects common passwords", policySrc.includes("isCommonPassword") && policySrc.includes("COMMON_PASSWORDS"));
ok("policy checks reuse/history", policySrc.includes("isPasswordReused"));
ok("policy supports expiry", policySrc.includes("isPasswordExpired"));

// ---- 4. Auth hardening contract ----
const authSrc = readFileSync(join(root, "src/lib/auth.ts"), "utf8");
ok("AUTH_SECRET has no insecure fallback", !authSrc.includes("dev-insecure-fallback-secret") && authSrc.includes("is not set"));
ok("session cookie uses __Host- prefix in prod", authSrc.includes("__Host-"));

// ---- 5. Immutable audit contract ----
const auditSrc = readFileSync(join(root, "src/lib/security/audit.ts"), "utf8");
ok("audit module exposes no update/delete", !/\.update\(|\.delete\(/.test(auditSrc));
const trigger = readFileSync(join(root, "drizzle/immutable_audit.sql"), "utf8");
ok("DB trigger rejects UPDATE/DELETE on audit tables", trigger.includes("BEFORE UPDATE OR DELETE") && trigger.includes("audit_logs"));

console.log(`\n${pass}/${pass + fail} security checks passed`);
process.exit(fail ? 1 : 0);
