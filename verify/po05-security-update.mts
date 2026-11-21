/**
 * Platform Owner PO-05 (Next.js security update and complete build recovery — development only) — the approved change
 * to the dependency manifests, on PO05_BASE (the PO-03D handover, 741686e).
 *
 * next and eslint-config-next 16.4.3 → 16.4.6, exact pins kept, eslint-config-next in lockstep as in cf0c6e5. 16.4.3 is
 * affected by the seven moderate advisories recorded below (the npm advisory database — the source `npm audit` and the
 * Next.js build gate read — and the GitHub Advisory Database agree: every one is fixed in 16.4.5); 16.4.6 is the newest
 * stable 16.4.x release and its only behavioural change over 16.4.5 is NodeNextResponse.appendHeader keeping a single
 * header value as a plain string. React, React DOM and sharp do not change. No application file changes.
 *
 * The rule for an approved change is the one every earlier phase used: no re-baseline. package.json's and
 * package-lock.json's hunks are recorded here byte for byte, [741686e's text, PO-05's text]; undone, each file is
 * 741686e's to the byte (PO05_BASE_SHA). The lockfile is npm's own output for the update
 * (`npm install next@16.4.6 eslint-config-next@16.4.6 --save-exact`), not edited by hand. Six bundled-metadata entries
 * of the optional wasm32 Tailwind binary stay out of it, as in cf0c6e5 and 041eb23 (PO05_LOCK_LEFT_OUT); npm 10.9
 * adds them only when it resolves without an installed tree. The lockfile's byte pin in
 * verify/document-form-pins.json moves with it (PO05_LOCK_PIN), as in cf0c6e5 and 041eb23.
 *
 * Generated from the diff against PO05_BASE (each hunk widened with context until it is unique in both files, its base
 * form nowhere in PO-05's); changing either file means regenerating this record, which is then part of the change
 * under review. Checked by verify/verify-po05-security-update.mts (npm run verify:po05-security-update [-- --build]).
 */
import { createHash } from "node:crypto";

export const PO05_BASE = "741686ef03438ddc2395f9185211582784ee37ed";
export const PO05_VERSIONS = { next: ["16.4.3", "16.4.6"], "eslint-config-next": ["16.4.3", "16.4.6"] } as const;
export const PO05_UNCHANGED = { react: "19.2.4", "react-dom": "19.2.4", sharp: "0.35.5" } as const;
export const PO05_EDITS: Record<string, [string, string][]> = {
  "package.json": [
    ["    \"verify:platform-seat-enforcement-browser\": \"tsx --conditions=react-server verify/verify-platform-seat-enforcement-browser.mts\"\n",
      "    \"verify:platform-seat-enforcement-browser\": \"tsx --conditions=react-server verify/verify-platform-seat-enforcement-browser.mts\",\n    \"verify:po05-security-update\": \"tsx verify/verify-po05-security-update.mts\"\n"],
    ["    \"next\": \"16.4.3\",\n",
      "    \"next\": \"16.4.6\",\n"],
    ["    \"eslint-config-next\": \"16.4.3\",\n",
      "    \"eslint-config-next\": \"16.4.6\",\n"],
  ],
  "package-lock.json": [
    ["        \"next\": \"16.4.3\",\n",
      "        \"next\": \"16.4.6\",\n"],
    ["        \"eslint-config-next\": \"16.4.3\",\n",
      "        \"eslint-config-next\": \"16.4.6\",\n"],
    ["      \"version\": \"16.4.3\",\n      \"resolved\": \"https://registry.npmjs.org/@next/env/-/env-16.4.3.tgz\",\n      \"integrity\": \"sha512-a7tz1QCcWWkwC/rPJcPMJk/UNRu9CFhDd3OHYE5hddbJrs8BqRTalxI6GlKCWEGzRLHN+S/B7a4PAHCtm25aBQ==\",\n",
      "      \"version\": \"16.4.6\",\n      \"resolved\": \"https://registry.npmjs.org/@next/env/-/env-16.4.6.tgz\",\n      \"integrity\": \"sha512-SunBjJ6t+oBtecS3dTjdVuMhUogP5wD/vrGL5EVuQYM1iS4O5ilL51HkiJ3sPjMzRHiCChvr4dbaSJbR7F3lxA==\",\n"],
    ["      \"version\": \"16.4.3\",\n      \"resolved\": \"https://registry.npmjs.org/@next/eslint-plugin-next/-/eslint-plugin-next-16.4.3.tgz\",\n      \"integrity\": \"sha512-oxuC06wt/71h6ACYCV9GbKOfnf5a7VlRe/p80YHTut15TNgDEmynDnaq8t/xhy5rlvk7dhItIPs6H3rvIM4kyw==\",\n",
      "      \"version\": \"16.4.6\",\n      \"resolved\": \"https://registry.npmjs.org/@next/eslint-plugin-next/-/eslint-plugin-next-16.4.6.tgz\",\n      \"integrity\": \"sha512-HdqERVOafOD8JaUSAkwf9aSu/1rsHlkN8C5GcXYBH3C/z1MxBhZFxB5rz/xqMMRiIj7r9tIv8OCLQ9JWUxCvWA==\",\n"],
    ["      \"version\": \"16.4.3\",\n      \"resolved\": \"https://registry.npmjs.org/@next/swc-darwin-arm64/-/swc-darwin-arm64-16.4.3.tgz\",\n      \"integrity\": \"sha512-4yq5EXBt+VDtAZwTyfijaFp5D2C5oz3Ikw5a2kiX2K9nw72vrZX2q5UuAlkPtUMO1tQz6JTKpaKWjS7OOefTDQ==\",\n",
      "      \"version\": \"16.4.6\",\n      \"resolved\": \"https://registry.npmjs.org/@next/swc-darwin-arm64/-/swc-darwin-arm64-16.4.6.tgz\",\n      \"integrity\": \"sha512-kJ4VVZkley17xKaJx72QN2IBqjrj7zenCQZaUF0l9ShS/1Mt2kW4+Z5KGG6vgr3L/J562xTOizVyM1iA/u5nlg==\",\n"],
    ["      \"version\": \"16.4.3\",\n      \"resolved\": \"https://registry.npmjs.org/@next/swc-darwin-x64/-/swc-darwin-x64-16.4.3.tgz\",\n      \"integrity\": \"sha512-1Rvkn/LUhnEF8WxnRkOrqGhbwXui1bkWFxONKIbN+r7C+9KHDSZ+iUoj4CzymVMWUyZIyx9szcb9+kbKhD500A==\",\n",
      "      \"version\": \"16.4.6\",\n      \"resolved\": \"https://registry.npmjs.org/@next/swc-darwin-x64/-/swc-darwin-x64-16.4.6.tgz\",\n      \"integrity\": \"sha512-eIPGZIqC+8JKaeZmvnCANJQF4xWkkHqSnAAajtFxgwDMAOnCgxNvP52SeWZ41PyVwoe+Le/NQuZSaQ8j7YshSA==\",\n"],
    ["      \"version\": \"16.4.3\",\n      \"resolved\": \"https://registry.npmjs.org/@next/swc-linux-arm64-gnu/-/swc-linux-arm64-gnu-16.4.3.tgz\",\n      \"integrity\": \"sha512-dCKpXErGg3abUM6t5JTJV/ottVBTStJB5lRJTbgdUdQaQ+jNHiK56Hsc0YAEg/rinSh42hYG3HWiYmEMdilnxg==\",\n",
      "      \"version\": \"16.4.6\",\n      \"resolved\": \"https://registry.npmjs.org/@next/swc-linux-arm64-gnu/-/swc-linux-arm64-gnu-16.4.6.tgz\",\n      \"integrity\": \"sha512-9nI6O8vvczH2D9ZNdMGqb/3NuT15T9ksOZnAmx9/gjF2cOi74+xxyf1Hk96uIMfm14c9y6wHeBq6SH8g6udvcA==\",\n"],
    ["      \"version\": \"16.4.3\",\n      \"resolved\": \"https://registry.npmjs.org/@next/swc-linux-arm64-musl/-/swc-linux-arm64-musl-16.4.3.tgz\",\n      \"integrity\": \"sha512-WwYbhWkhYBvBtib1K4W0kL8MW2snBD2A5b3SN4vPpqalZbZs5+bQ1yzAdepVoOqrFfEW3dmREy4Zs1MrWcrFbw==\",\n",
      "      \"version\": \"16.4.6\",\n      \"resolved\": \"https://registry.npmjs.org/@next/swc-linux-arm64-musl/-/swc-linux-arm64-musl-16.4.6.tgz\",\n      \"integrity\": \"sha512-7/qPhTxDp2ScluOJOhLuhWmlA17o1yZ0SIgpISBCpBxXgtnK4+KGywBpFkfLPiU1rnSM1faFGzYkH6i7JdTrqA==\",\n"],
    ["      \"version\": \"16.4.3\",\n      \"resolved\": \"https://registry.npmjs.org/@next/swc-linux-x64-gnu/-/swc-linux-x64-gnu-16.4.3.tgz\",\n      \"integrity\": \"sha512-QymWvfUwDEC5/lpJOsxX5VAbyoR2D13+2Jsjz4be7gT4LPqEgdpkeLIR/HFfCLgKzoMhpJbp6I/JnogyNZHcaA==\",\n",
      "      \"version\": \"16.4.6\",\n      \"resolved\": \"https://registry.npmjs.org/@next/swc-linux-x64-gnu/-/swc-linux-x64-gnu-16.4.6.tgz\",\n      \"integrity\": \"sha512-oOpbNa8XOW1qCGd9VvzC4fbkkRxEls7/WI6tz+YHC0xRA7KpV1U7DrAnCPjzVyOk/karzWEepCOcTIDmwK8FwQ==\",\n"],
    ["      \"version\": \"16.4.3\",\n      \"resolved\": \"https://registry.npmjs.org/@next/swc-linux-x64-musl/-/swc-linux-x64-musl-16.4.3.tgz\",\n      \"integrity\": \"sha512-Vmjd9D7DpA4Vv3cUlr82QWgJD/BQZmns801vtC5VWHg6jCIA4a5vMKpQnfrM2pyCrp2eV0ENdUg4PlN3bAc2Yw==\",\n",
      "      \"version\": \"16.4.6\",\n      \"resolved\": \"https://registry.npmjs.org/@next/swc-linux-x64-musl/-/swc-linux-x64-musl-16.4.6.tgz\",\n      \"integrity\": \"sha512-aM8CZ+OR2EwXaAYw7KGkW2GDmNDsLBIRe1MMRZCJPTdw/xhTD0IMUVO4sf3KqrzuRouGzwwLZn34+gFeVXiUQA==\",\n"],
    ["      \"version\": \"16.4.3\",\n      \"resolved\": \"https://registry.npmjs.org/@next/swc-win32-arm64-msvc/-/swc-win32-arm64-msvc-16.4.3.tgz\",\n      \"integrity\": \"sha512-lG1pPdPLk7gTyGb00n5JIMLdBJgjb+UEhSdZvFbhUMg0DyC6z4B7RnpSKF9VCd4imkLObVbXOFA0kFCpw7yFow==\",\n",
      "      \"version\": \"16.4.6\",\n      \"resolved\": \"https://registry.npmjs.org/@next/swc-win32-arm64-msvc/-/swc-win32-arm64-msvc-16.4.6.tgz\",\n      \"integrity\": \"sha512-U0p7/tEtqvHX2crhd841CDwKtp5CFkKXVjOhmfccR3Pvp64sj8KBwRqsvltqLOwVBbj0NtkxwXSDpEHYGbxeXQ==\",\n"],
    ["      \"version\": \"16.4.3\",\n      \"resolved\": \"https://registry.npmjs.org/@next/swc-win32-x64-msvc/-/swc-win32-x64-msvc-16.4.3.tgz\",\n      \"integrity\": \"sha512-NmQC9RkJdnPXRaMxtkCzobB3teVjqF33oSOnwDfi+XYGWWYpt+xlGK3mtktSKLbdjwaWbJu2OkkMiRFGUUncKg==\",\n",
      "      \"version\": \"16.4.6\",\n      \"resolved\": \"https://registry.npmjs.org/@next/swc-win32-x64-msvc/-/swc-win32-x64-msvc-16.4.6.tgz\",\n      \"integrity\": \"sha512-3ZG15/5WIdlTQsIEvc9sPTTSL5XFrlLklIKmfF4fwsDnoAhu6NcBDXsk3mbGxNyo6aVLEGex+fHCv2MahY7a9g==\",\n"],
    ["      \"version\": \"16.4.3\",\n      \"resolved\": \"https://registry.npmjs.org/eslint-config-next/-/eslint-config-next-16.4.3.tgz\",\n      \"integrity\": \"sha512-j9IqBma6abp800frdUURaizYMgXOK+jNGyq6CsYcM9AxpSJs5D/TgMNGeAmRUilZvA7g9V1Tr71gNg9/SVTuMQ==\",\n",
      "      \"version\": \"16.4.6\",\n      \"resolved\": \"https://registry.npmjs.org/eslint-config-next/-/eslint-config-next-16.4.6.tgz\",\n      \"integrity\": \"sha512-IBGGrVf9E6pL0NGL0hmeicVGeSyv1VEzIWq6IecDqkw+YFByhEtDJS9u1r6s6a1VxK6rssh69KyNFQUgfaacqw==\",\n"],
    ["        \"@next/eslint-plugin-next\": \"16.4.3\",\n",
      "        \"@next/eslint-plugin-next\": \"16.4.6\",\n"],
    ["      \"version\": \"16.4.3\",\n      \"resolved\": \"https://registry.npmjs.org/next/-/next-16.4.3.tgz\",\n      \"integrity\": \"sha512-OqxKTGi9u80FydydsMNYNjnuje9Au+kvHlt2GZ//ftdpDHm1dxKqAaENoOOTX5wKzn+9vaKUNIfZeyZUuLhCnA==\",\n",
      "      \"version\": \"16.4.6\",\n      \"resolved\": \"https://registry.npmjs.org/next/-/next-16.4.6.tgz\",\n      \"integrity\": \"sha512-QZJiYhaZLJMo2KpkQGQIwvmd79WVsAWeYIU554a8d7zArS3si/IRy3lBNV/rtYhE70oLwdLYhPAXLPx8HwcwtA==\",\n"],
    ["        \"@next/env\": \"16.4.3\",\n",
      "        \"@next/env\": \"16.4.6\",\n"],
    ["        \"@next/swc-darwin-arm64\": \"16.4.3\",\n        \"@next/swc-darwin-x64\": \"16.4.3\",\n        \"@next/swc-linux-arm64-gnu\": \"16.4.3\",\n        \"@next/swc-linux-arm64-musl\": \"16.4.3\",\n        \"@next/swc-linux-x64-gnu\": \"16.4.3\",\n        \"@next/swc-linux-x64-musl\": \"16.4.3\",\n        \"@next/swc-win32-arm64-msvc\": \"16.4.3\",\n        \"@next/swc-win32-x64-msvc\": \"16.4.3\",\n",
      "        \"@next/swc-darwin-arm64\": \"16.4.6\",\n        \"@next/swc-darwin-x64\": \"16.4.6\",\n        \"@next/swc-linux-arm64-gnu\": \"16.4.6\",\n        \"@next/swc-linux-arm64-musl\": \"16.4.6\",\n        \"@next/swc-linux-x64-gnu\": \"16.4.6\",\n        \"@next/swc-linux-x64-musl\": \"16.4.6\",\n        \"@next/swc-win32-arm64-msvc\": \"16.4.6\",\n        \"@next/swc-win32-x64-msvc\": \"16.4.6\",\n"],
  ],
};
export const PO05_BASE_SHA: Record<string, string> = { "package.json": "baa7ed22b2fe27ce", "package-lock.json": "dcfa0b4bbdbb6e3d" };
export const PO05_LOCK_PIN = { before: "dcfa0b4bbdbb6e3d", after: "8e7d93fae52124cc" } as const;
/** The lockfile entries the update changes ("" is the root manifest entry). */
export const PO05_LOCK_CHANGED: readonly string[] = ["", "node_modules/@next/env", "node_modules/@next/eslint-plugin-next", "node_modules/@next/swc-darwin-arm64", "node_modules/@next/swc-darwin-x64", "node_modules/@next/swc-linux-arm64-gnu", "node_modules/@next/swc-linux-arm64-musl", "node_modules/@next/swc-linux-x64-gnu", "node_modules/@next/swc-linux-x64-musl", "node_modules/@next/swc-win32-arm64-msvc", "node_modules/@next/swc-win32-x64-msvc", "node_modules/eslint-config-next", "node_modules/next"];
/** npm 10.9's bundled-metadata entries of the optional wasm32 Tailwind binary — absent from the base and from PO-05's lockfile. */
export const PO05_LOCK_LEFT_OUT: readonly string[] = ["node_modules/@tailwindcss/oxide-wasm32-wasi/node_modules/@emnapi/core", "node_modules/@tailwindcss/oxide-wasm32-wasi/node_modules/@emnapi/runtime", "node_modules/@tailwindcss/oxide-wasm32-wasi/node_modules/@emnapi/wasi-threads", "node_modules/@tailwindcss/oxide-wasm32-wasi/node_modules/@napi-rs/wasm-runtime", "node_modules/@tailwindcss/oxide-wasm32-wasi/node_modules/@tybys/wasm-util", "node_modules/@tailwindcss/oxide-wasm32-wasi/node_modules/tslib"];
/** The advisories: id from the npm advisory database (bulk endpoint, queried for next 16.4.3 – 16.4.6 on 2026-11-21), GHSA and CVE
 *  from the GitHub Advisory Database. The npm range is the 16.x line's; 16.4.5 is the first patched 16.x release for every one. */
export const PO05_ADVISORIES: readonly { npm: number; ghsa: string; cve: string; severity: "moderate"; cvss: number; cwe: string; vulnerable: string; patched: string; title: string }[] = [
  { npm: 1247486, ghsa: "GHSA-mfr8-8qww-v76h", cve: "CVE-2026-119790", severity: "moderate", cvss: 6.3, cwe: "CWE-362", vulnerable: ">=16.3.0 <=16.4.4", patched: "16.4.5",
    title: "Information disclosure across root params when a 'use cache' function is called through unstable_cache()" },
  { npm: 1247712, ghsa: "GHSA-vc7v-qv4w-wrv8", cve: "CVE-2026-119351", severity: "moderate", cvss: 6.3, cwe: "CWE-362", vulnerable: ">=16.2.0 <=16.4.4", patched: "16.4.5",
    title: "Cache leak across root param values in nested 'use cache' functions via delayed inner stream metadata" },
  { npm: 1248078, ghsa: "GHSA-7qx7-33qx-rqx2", cve: "CVE-2026-119347", severity: "moderate", cvss: 6.9, cwe: "CWE-1287", vulnerable: ">=16.0.0 <=16.4.4", patched: "16.4.5",
    title: "SVG rejection bypass in the image optimization" },
  { npm: 1248080, ghsa: "GHSA-f3mh-rxg3-f5g2", cve: "CVE-2026-119346", severity: "moderate", cvss: 6.0, cwe: "CWE-200, CWE-201", vulnerable: ">=16.0.0 <=16.4.4", patched: "16.4.5",
    title: "HttpOnly cookie exposure through internal response header on Next.js Edge runtime routes" },
  { npm: 1248083, ghsa: "GHSA-pc58-hwjq-p385", cve: "CVE-2026-119348", severity: "moderate", cvss: 6.3, cwe: "CWE-444", vulnerable: ">=16.0.0 <=16.4.4", patched: "16.4.5",
    title: "Cross-client response injection and disclosure in self-hosted Next.js applications forwarding fetched responses" },
  { npm: 1248084, ghsa: "GHSA-rhh4-g77r-r9qj", cve: "CVE-2026-119349", severity: "moderate", cvss: 6.3, cwe: "CWE-694", vulnerable: ">=16.0.0 <=16.4.4", patched: "16.4.5",
    title: "Cross-user cache disclosure and poisoning in Next.js use cache with binary arguments" },
  { npm: 1248085, ghsa: "GHSA-vvgp-ww4w-46vf", cve: "CVE-2026-119350", severity: "moderate", cvss: 6.3, cwe: "CWE-349", vulnerable: ">=16.4.0 <=16.4.4", patched: "16.4.5",
    title: "Cache poisoning of shared fallback shells in Cache Components via request-supplied placeholder route params" },
];
/** The 16.4.6 build's output (exit 0): Next.js's last recorded build stage, and its App Router route table — the blocked 16.4.3
 *  build's, unchanged. The advisory gate is awaited only after the output is written, so its verdict is the exit code, not a file. */
export const PO05_BUILD = { lastStage: "static-generation", appRoutes: 102, routesSha: "207b4c3ef33e3672" } as const;

const sha16 = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

/** A recorded file with PO-05's hunks undone (the base text when nothing else changed). */
export function undoPo05(file: string, text: string): string {
  let out = text;
  for (const [was, is] of [...(PO05_EDITS[file] ?? [])].reverse()) {
    if (out.split(is).length === 2) out = out.replace(is, () => was);
  }
  return out;
}

/** The recorded files that are not exactly the base plus their hunks. */
export function po05Drift(actual: (file: string) => string | null): string[] {
  const drift: string[] = [];
  for (const [file, hunks] of Object.entries(PO05_EDITS)) {
    const text = actual(file);
    if (text === null) { drift.push(file); continue; }
    const each = hunks.every(([was, is]) => text.split(is).length === 2 && !text.includes(was));
    if (!each || sha16(undoPo05(file, text)) !== PO05_BASE_SHA[file]) drift.push(file);
  }
  return drift;
}
