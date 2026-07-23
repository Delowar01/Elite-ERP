// Shared line-item column configuration for the Edit Columns / Configure Columns feature.
// Pure module (no client/server directives) so the SAME types, defaults, formula evaluator and
// validation run on both the client (live modal) and the server (authoritative save validation).

export type FieldType = "text" | "number" | "formula";
// data    = bound to a real line-item field (editable input)
// computed= derived from the line (read-only display)
// input   = line-level value stored in custom_fields (editable input)
// formula = custom calculated column (read-only display, evaluated safely)
// actions = the locked trailing actions column
export type ColumnKind = "data" | "computed" | "input" | "formula" | "actions";

export type ColumnDef = {
  key: string;
  label: string;
  visible: boolean;
  widthPct: number;
  kind: ColumnKind;
  /** true for the 4 fields the document totals depend on — cannot be hidden or removed. */
  required?: boolean;
  /** true for the Actions column — cannot be renamed, hidden, reordered, or removed. */
  locked?: boolean;
  /** true for user-added custom columns — can be edited/removed. */
  custom?: boolean;
  fieldType?: FieldType;
  formula?: string;
};

export const ACTIONS_KEY = "actions";
export const REQUIRED_KEYS = ["description", "quantity", "unitPrice", "taxRatePercent"];
export const WIDTH_OPTIONS = [5, 6, 7, 8, 9, 10, 12, 14, 15, 18, 20, 22, 25, 30, 35, 40];
export const MAX_TOTAL_WIDTH = 100;

// Default column set for the full line-item table (all 5 in-scope document types share it).
export const DEFAULT_COLUMNS: ColumnDef[] = [
  { key: "description", label: "Item Description", visible: true, widthPct: 22, kind: "data", required: true },
  { key: "taxRatePercent", label: "VAT %", visible: true, widthPct: 5, kind: "data", required: true },
  { key: "quantity", label: "Qty", visible: true, widthPct: 6, kind: "data", required: true },
  { key: "unit", label: "Unit", visible: true, widthPct: 6, kind: "data" },
  { key: "unitPrice", label: "Unit Price", visible: true, widthPct: 9, kind: "data", required: true },
  { key: "amount", label: "Amount", visible: true, widthPct: 9, kind: "computed" },
  { key: "vatAmount", label: "VAT Amt", visible: true, widthPct: 7, kind: "computed" },
  { key: "discPercent", label: "Disc %", visible: false, widthPct: 6, kind: "input", fieldType: "number" },
  { key: "discAmount", label: "Disc Amt", visible: false, widthPct: 9, kind: "computed" },
  { key: "total", label: "Total", visible: true, widthPct: 9, kind: "computed" },
  { key: ACTIONS_KEY, label: "Actions", visible: true, widthPct: 5, kind: "actions", locked: true },
];

export const BUILTIN_KEYS = new Set(DEFAULT_COLUMNS.map((c) => c.key));

// The reference variables a per-line formula / computed value can use.
export function lineVars(qty: number, unitPrice: number, vat: number, discPercent: number): Record<string, number> {
  const amount = qty * unitPrice;
  return {
    quantity: qty,
    unit_price: unitPrice,
    unitprice: unitPrice,
    vat: vat,
    discount: discPercent,
    disc: discPercent,
    amount,
  };
}

// ---- Safe formula evaluator (tokenizer + shunting-yard, no eval/Function) ----
type Tok = { t: "num"; v: number } | { t: "op"; v: string } | { t: "lp" } | { t: "rp" } | { t: "var"; v: string };

function tokenize(src: string): Tok[] | null {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t") { i++; continue; }
    if (c >= "0" && c <= "9" || c === ".") {
      let j = i + 1;
      while (j < src.length && (src[j] >= "0" && src[j] <= "9" || src[j] === ".")) j++;
      const num = Number(src.slice(i, j));
      if (Number.isNaN(num)) return null;
      toks.push({ t: "num", v: num }); i = j; continue;
    }
    if (c === "{") {
      const end = src.indexOf("}", i);
      if (end === -1) return null;
      const name = src.slice(i + 1, end).trim().toLowerCase().replace(/\s+/g, "_");
      if (!/^[a-z_][a-z0-9_]*$/.test(name)) return null;
      toks.push({ t: "var", v: name }); i = end + 1; continue;
    }
    if ("+-*/".includes(c)) { toks.push({ t: "op", v: c }); i++; continue; }
    if (c === "(") { toks.push({ t: "lp" }); i++; continue; }
    if (c === ")") { toks.push({ t: "rp" }); i++; continue; }
    return null; // any other character is rejected — no identifiers, no JS
  }
  return toks;
}

const PREC: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2 };

function toRpn(toks: Tok[]): Tok[] | null {
  const out: Tok[] = [];
  const ops: Tok[] = [];
  let prevValue = false; // for unary-minus detection
  for (let k = 0; k < toks.length; k++) {
    const tk = toks[k];
    if (tk.t === "num" || tk.t === "var") { out.push(tk); prevValue = true; continue; }
    if (tk.t === "op") {
      if (tk.v === "-" && !prevValue) { out.push({ t: "num", v: 0 }); } // unary minus -> 0 - x
      while (ops.length) {
        const top = ops[ops.length - 1];
        if (top.t === "op" && PREC[top.v] >= PREC[tk.v]) out.push(ops.pop()!);
        else break;
      }
      ops.push(tk); prevValue = false; continue;
    }
    if (tk.t === "lp") { ops.push(tk); prevValue = false; continue; }
    if (tk.t === "rp") {
      let found = false;
      while (ops.length) { const top = ops.pop()!; if (top.t === "lp") { found = true; break; } out.push(top); }
      if (!found) return null;
      prevValue = true; continue;
    }
  }
  while (ops.length) { const top = ops.pop()!; if (top.t === "lp" || top.t === "rp") return null; out.push(top); }
  return out;
}

function evalRpn(rpn: Tok[], vars: Record<string, number>): number | null {
  const st: number[] = [];
  for (const tk of rpn) {
    if (tk.t === "num") st.push(tk.v);
    else if (tk.t === "var") { const val = vars[tk.v]; if (val === undefined) return null; st.push(val); }
    else if (tk.t === "op") {
      const b = st.pop(); const a = st.pop();
      if (a === undefined || b === undefined) return null;
      let r: number;
      if (tk.v === "+") r = a + b; else if (tk.v === "-") r = a - b; else if (tk.v === "*") r = a * b;
      else { if (b === 0) return 0; r = a / b; }
      st.push(r);
    }
  }
  if (st.length !== 1) return null;
  return Number.isFinite(st[0]) ? st[0] : null;
}

// Validate a formula string against the allowed variable names. Returns an error message or null.
export function validateFormula(formula: string, allowedVars: string[]): string | null {
  if (!formula.trim()) return null; // empty formula is allowed (a plain custom column)
  const toks = tokenize(formula);
  if (!toks) return "Formula contains invalid characters. Use numbers, + - * / ( ) and {field} references.";
  if (toks.length === 0) return "Formula is empty.";
  for (const tk of toks) {
    if (tk.t === "var" && !allowedVars.includes(tk.v)) {
      return `Unknown field {${tk.v}}. Allowed: ${allowedVars.map((v) => `{${v}}`).join(", ")}.`;
    }
  }
  const rpn = toRpn(toks);
  if (!rpn) return "Formula has unbalanced parentheses or invalid syntax.";
  // dry-run with 1s to catch structural errors
  const probe: Record<string, number> = {};
  for (const v of allowedVars) probe[v] = 1;
  if (evalRpn(rpn, probe) === null) return "Formula could not be evaluated.";
  return null;
}

// Evaluate a formula for a specific line. Returns null on any problem (rendered as "—").
export function evalFormula(formula: string, vars: Record<string, number>): number | null {
  const toks = tokenize(formula);
  if (!toks || toks.length === 0) return null;
  const rpn = toRpn(toks);
  if (!rpn) return null;
  return evalRpn(rpn, vars);
}

export const ALLOWED_FORMULA_VARS = ["quantity", "unit_price", "vat", "discount", "amount"];

// ---- Config validation (shared client + server) ----
export function validateColumns(cols: ColumnDef[]): string | null {
  if (!Array.isArray(cols) || cols.length === 0) return "No columns configured.";
  // Actions must exist, be last and locked.
  const actionsIdx = cols.findIndex((c) => c.key === ACTIONS_KEY);
  if (actionsIdx === -1) return "The Actions column is required.";
  if (actionsIdx !== cols.length - 1) return "The Actions column must stay at the end.";
  // Unique keys + unique labels (case-insensitive) among all columns.
  const keys = new Set<string>();
  const labels = new Set<string>();
  for (const c of cols) {
    if (keys.has(c.key)) return `Duplicate column key "${c.key}".`;
    keys.add(c.key);
    const lbl = (c.label || "").trim();
    if (c.key !== ACTIONS_KEY && !lbl) return "Column labels cannot be empty.";
    const lc = lbl.toLowerCase();
    if (lc && labels.has(lc)) return `Duplicate column name "${lbl}".`;
    if (lc) labels.add(lc);
    if (!WIDTH_OPTIONS.includes(c.widthPct)) return `Invalid width for "${lbl || c.key}".`;
    if (c.custom) {
      if (!["text", "number", "formula"].includes(c.fieldType || "")) return `Invalid field type for "${lbl}".`;
      if (c.fieldType === "formula") {
        const err = validateFormula(c.formula || "", ALLOWED_FORMULA_VARS);
        if (err) return `"${lbl}": ${err}`;
      }
    }
  }
  // Required calc fields must be present and visible (totals depend on them).
  for (const rk of REQUIRED_KEYS) {
    const c = cols.find((x) => x.key === rk);
    if (!c) return `The "${rk}" column is required and cannot be removed.`;
    if (!c.visible) return `The "${c.label}" column is required by the totals and cannot be hidden.`;
  }
  // Visible widths must fit within the available table width.
  const sum = cols.filter((c) => c.visible).reduce((a, c) => a + c.widthPct, 0);
  if (sum > MAX_TOTAL_WIDTH) return `Visible column widths total ${sum}% — they must not exceed ${MAX_TOTAL_WIDTH}%.`;
  return null;
}

// Merge a stored config with the current defaults: keep known builtins' saved order/label/width/
// visibility, append any new builtins, drop unknown builtins, keep custom columns, force Actions
// last and required columns visible. Always returns a valid, renderable config.
export function resolveColumns(stored: unknown): ColumnDef[] {
  const defaults = DEFAULT_COLUMNS.map((c) => ({ ...c }));
  if (!Array.isArray(stored)) return defaults;
  const byKey = new Map(defaults.map((c) => [c.key, c]));
  const out: ColumnDef[] = [];
  const seen = new Set<string>();
  for (const raw of stored as ColumnDef[]) {
    if (!raw || typeof raw.key !== "string" || raw.key === ACTIONS_KEY || seen.has(raw.key)) continue;
    if (byKey.has(raw.key)) {
      const base = byKey.get(raw.key)!;
      out.push({
        ...base,
        label: typeof raw.label === "string" && raw.label.trim() ? raw.label : base.label,
        visible: base.required ? true : !!raw.visible,
        widthPct: WIDTH_OPTIONS.includes(raw.widthPct) ? raw.widthPct : base.widthPct,
      });
      seen.add(raw.key);
    } else if (raw.custom && typeof raw.label === "string" && raw.label.trim()) {
      out.push({
        key: raw.key,
        label: raw.label,
        visible: !!raw.visible,
        widthPct: WIDTH_OPTIONS.includes(raw.widthPct) ? raw.widthPct : 10,
        kind: raw.fieldType === "formula" ? "formula" : "input",
        custom: true,
        fieldType: (["text", "number", "formula"].includes(raw.fieldType || "") ? raw.fieldType : "text") as FieldType,
        formula: typeof raw.formula === "string" ? raw.formula : "",
      });
      seen.add(raw.key);
    }
  }
  // append any builtins not present in the stored config (e.g. added in a later version)
  for (const d of defaults) {
    if (d.key !== ACTIONS_KEY && !seen.has(d.key)) out.push({ ...d });
  }
  out.push({ ...byKey.get(ACTIONS_KEY)! });
  return out;
}
