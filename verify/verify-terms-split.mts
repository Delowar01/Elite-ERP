/**
 * AUD-08.1 / E16 — executable proof of the `terms_conditions_groups.content -> terms` semantics.
 *
 * ## Why this suite exists
 *
 * AUD-08's `0005` baseline has to reproduce a transformation the project has ALREADY applied. The
 * repository already contains both halves of it:
 *
 *   - the canonical transformation, `splitGroupTerms()` in
 *     src/app/(app)/sales/_shared/document-terms.ts
 *   - the one-off migration that used it,
 *     scripts/migrations/2026-07-28-terms-groups-structured.ts
 *
 * So the baseline must not invent an approximate replacement. Before AUD-08.2 writes anything, the
 * semantics need to be pinned as fixtures — because today the only coverage is a SINGLE assertion
 * inside scripts/tests/terms-groups.e2e.ts:39, which no verify runner reaches. One assertion in an
 * ungated e2e script is not a specification.
 *
 * ## What it proves
 *
 * 1. `splitGroupTerms` behaves exactly as the 18 approved fixtures say it does (AUD-08-P0-C1 §02.4).
 * 2. FROZEN_splitGroupTerms — the vendored copy AUD-08.2 would carry inside the migration data
 *    step — produces an IDENTICAL ordered array for every fixture and for randomised input.
 *
 * Point 2 is the one that matters structurally. A migration's behaviour must never change because
 * application code changed, so the data step cannot import from src/. Vendoring a frozen copy is
 * the alternative — and a frozen copy is only safe if drift is DETECTED rather than inherited. This
 * suite is that detector.
 *
 * ## Why the transformation is not reimplemented in SQL
 *
 * Three JS-vs-PostgreSQL divergences, each of which silently corrupts term text:
 *   - JS `\s` includes NBSP (U+00A0) and U+FEFF; POSIX `[[:space:]]` in the C locale does not.
 *   - JS `.trim()` strips NBSP and BOM; `btrim(x)` strips spaces only.
 *   - JS `String.replace` with a non-global regex strips ONE prefix; the SQL equivalent must be
 *     anchored and non-global to match, which is easy to get subtly wrong.
 * Fixture 16 (NBSP) is the case a SQL port gets wrong. That is why the recommended design reuses
 * the canonical function rather than translating it.
 *
 * Run: npx tsx --conditions=react-server verify/verify-terms-split.mts
 * Exit: 0 all passed, 1 any failure.
 */
import { splitGroupTerms } from "../src/app/(app)/sales/_shared/document-terms";

// -------------------------------------------------------------------------------------------------
// The FROZEN transformation. This is the exact text AUD-08.2 would vendor into the migration data
// step. It is deliberately a byte-for-byte restatement of the canonical implementation rather than a
// clever equivalent — a migration is the wrong place to be clever, and a restatement is reviewable
// by eye against the original.
// -------------------------------------------------------------------------------------------------
export function FROZEN_splitGroupTerms(content: string | null | undefined): string[] {
  return (content ?? "")
    .split(/\r?\n/)
    .map((s) => s.replace(/^\s*\d+[.)]\s*/, "").trim())
    .filter(Boolean);
}

type Fixture = { n: number; label: string; input: string | null | undefined; expected: string[] };

const NBSP = " ";

const FIXTURES: Fixture[] = [
  { n: 1, label: "null content", input: null, expected: [] },
  { n: 2, label: "undefined content", input: undefined, expected: [] },
  { n: 3, label: "empty string", input: "", expected: [] },
  { n: 4, label: "whitespace only", input: "   ", expected: [] },
  { n: 5, label: "LF separator", input: "A\nB", expected: ["A", "B"] },
  { n: 6, label: "CRLF separator", input: "A\r\nB", expected: ["A", "B"] },
  // A bare CR is NOT a separator: the split pattern is /\r?\n/, so \r only counts when it precedes
  // \n. The CR survives INSIDE the term because .trim() only strips at the ends.
  { n: 7, label: "bare CR is not a separator", input: "A\rB", expected: ["A\rB"] },
  { n: 8, label: "blank lines dropped", input: "A\n\n\nB", expected: ["A", "B"] },
  { n: 9, label: "leading/trailing whitespace and a trailing newline", input: "  A  \n B \n", expected: ["A", "B"] },
  // The one fixture that already exists in the repository (scripts/tests/terms-groups.e2e.ts:39),
  // carried over verbatim so this suite is a superset of what was already asserted.
  { n: 10, label: "existing repo fixture: numbering + blank + trailing space", input: "1. Alpha\n\n2) Beta\n  Gamma  ", expected: ["Alpha", "Beta", "Gamma"] },
  { n: 11, label: "no space required after the delimiter", input: "10.Term", expected: ["Term"] },
  // Non-global replace: only the FIRST prefix is stripped.
  { n: 12, label: "only the first numeric prefix is stripped", input: "1. 2. Term", expected: ["2. Term"] },
  // Existing behaviour, pinned deliberately and NOT fixed: a baseline migration is not the place to
  // change a transformation that has already been applied to live data.
  { n: 13, label: "decimal-looking prefix is mangled (pinned, not fixed)", input: "1.2 Term", expected: ["2 Term"] },
  { n: 14, label: "delimiter must follow the digits immediately", input: "1 . Term", expected: ["1 . Term"] },
  { n: 15, label: "bullets are preserved", input: "- Term", expected: ["- Term"] },
  // JS .trim() strips NBSP; PostgreSQL btrim(x) does not. This is the SQL-port trap.
  { n: 16, label: "NBSP is trimmed (the SQL-port trap)", input: `${NBSP}A`, expected: ["A"] },
  { n: 17, label: "ordering preserved, never sorted", input: "C\nA\nB", expected: ["C", "A", "B"] },
  {
    n: 18,
    label: "500-line volume, order preserved",
    input: Array.from({ length: 500 }, (_, i) => `Term ${i + 1}`).join("\n"),
    expected: Array.from({ length: 500 }, (_, i) => `Term ${i + 1}`),
  },
];

let passed = 0;
let failed = 0;

function show(v: unknown): string {
  return JSON.stringify(v);
}

function check(name: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed++;
    console.log(`PASS  ${name}`);
  } else {
    failed++;
    console.log(`FAIL  ${name}${detail ? `  -> ${detail}` : ""}`);
  }
}

console.log("── AUD-08.1 / E16 — terms transformation fixtures ──\n");

// --- Part 1: the canonical function matches every fixture. -----------------------------------
for (const f of FIXTURES) {
  const actual = splitGroupTerms(f.input);
  const ok = JSON.stringify(actual) === JSON.stringify(f.expected);
  const label = f.n === 18 ? `${f.label} (len ${actual.length})` : f.label;
  check(
    `F${String(f.n).padStart(2, "0")} canonical: ${label}`,
    ok,
    ok ? undefined : `expected ${show(f.expected).slice(0, 120)} got ${show(actual).slice(0, 120)}`,
  );
}

// --- Part 2: the FROZEN copy is indistinguishable from the canonical function. ----------------
for (const f of FIXTURES) {
  const canonical = splitGroupTerms(f.input);
  const frozen = FROZEN_splitGroupTerms(f.input);
  const ok = JSON.stringify(canonical) === JSON.stringify(frozen);
  check(
    `F${String(f.n).padStart(2, "0")} frozen copy agrees: ${f.label}`,
    ok,
    ok ? undefined : `canonical ${show(canonical).slice(0, 80)} vs frozen ${show(frozen).slice(0, 80)}`,
  );
}

// --- Part 3: randomised agreement. A fixture set proves the cases someone thought of; this
// probes the ones nobody did. Seeded so a failure is reproducible.
let seed = 20260930;
function rnd(): number {
  // xorshift — deterministic, and good enough to shuffle fragments.
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
  return Math.abs(seed) / 2147483647;
}
const FRAGMENTS = ["A", "Term", "1.", "2)", "10.", "-", " ", "\t", NBSP, "\r", "", "1.2", "3 .", "x\ry", "Ωmega", "2."];
let randomMismatch = 0;
for (let i = 0; i < 2000; i++) {
  const lines: string[] = [];
  const lineCount = 1 + Math.floor(rnd() * 5);
  for (let l = 0; l < lineCount; l++) {
    let line = "";
    const parts = 1 + Math.floor(rnd() * 4);
    for (let p = 0; p < parts; p++) line += FRAGMENTS[Math.floor(rnd() * FRAGMENTS.length)];
    lines.push(line);
  }
  const input = lines.join(rnd() < 0.3 ? "\r\n" : "\n");
  if (JSON.stringify(splitGroupTerms(input)) !== JSON.stringify(FROZEN_splitGroupTerms(input))) {
    randomMismatch++;
    if (randomMismatch <= 3) console.log(`      mismatch on input ${show(input)}`);
  }
}
check(`randomised agreement over 2000 generated inputs (seed 20260930)`, randomMismatch === 0, randomMismatch === 0 ? undefined : `${randomMismatch} mismatches`);

// --- Part 4: properties the AUD-08.2 data step relies on. -------------------------------------
check("no fixture output contains an empty string", FIXTURES.every((f) => splitGroupTerms(f.input).every((t) => t.length > 0)));
check("output is always an array (never null/undefined)", FIXTURES.every((f) => Array.isArray(splitGroupTerms(f.input))));
check(
  "output order is the input order for a plain multi-line value",
  JSON.stringify(splitGroupTerms("z\ny\nx")) === JSON.stringify(["z", "y", "x"]),
);
check(
  "a value with no content at all yields [] — the data step must store '[]'::jsonb, not NULL",
  splitGroupTerms(null).length === 0 && splitGroupTerms("").length === 0,
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log("TERMS SPLIT VERIFICATION FAIL");
  process.exit(1);
}
console.log("TERMS SPLIT VERIFICATION PASS");
