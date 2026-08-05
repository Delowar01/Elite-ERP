import "server-only";
import { and, eq } from "drizzle-orm";
import { db, customersTable } from "@/db";
import { tenantScope } from "@/lib/tenant";
import { normalizeClientFields, type ClientFieldValues } from "@/lib/clients/client-fields";
import { CLIENT_IMPORT_SPEC } from "./spec";

// Batch client import. One spreadsheet row = one client. Everything here is scoped to a single org:
// existing clients are read through `tenantScope`, and every write carries the session's orgId.
// Each client is committed in its own transaction, so one bad row can never hold back the rest.

/** One mapped row: spec field key -> raw cell value. */
export type MappedRow = Record<string, string>;

/** What to do when an imported row matches a client the organization already has. */
export type DuplicateMode = "skip" | "update";
export const DEFAULT_DUPLICATE_MODE: DuplicateMode = "skip";
export function isDuplicateMode(v: unknown): v is DuplicateMode {
  return v === "skip" || v === "update";
}

/**
 * Identifiers used to recognize a client the org already has, strongest first. A name on its own is
 * the weakest signal and is only used when the row carries no stronger identifier at all — a shared
 * name plus a different VAT number is a different client, not a duplicate.
 */
const MATCH_KEYS = [
  { key: "vatNumber", label: "VAT Number", norm: (v: string) => v.replace(/[\s-]/g, "").toUpperCase() },
  { key: "taxId", label: "Commercial Registration Number", norm: (v: string) => v.replace(/[\s-]/g, "").toUpperCase() },
  { key: "email", label: "Email", norm: (v: string) => v.trim().toLowerCase() },
  { key: "phone", label: "Phone", norm: (v: string) => v.replace(/\D/g, "") },
  { key: "name", label: "Client Name", norm: (v: string) => v.trim().toLowerCase().replace(/\s+/g, " ") },
] as const;

type MatchKeyName = (typeof MATCH_KEYS)[number]["key"];

/** All identifier values a record offers, as "field:value" strings. */
function identityKeys(v: Partial<Record<MatchKeyName, string | null>>): { key: string; label: string; field: MatchKeyName }[] {
  const out: { key: string; label: string; field: MatchKeyName }[] = [];
  for (const m of MATCH_KEYS) {
    const raw = (v[m.key] ?? "").toString();
    if (!raw.trim()) continue;
    const n = m.norm(raw);
    if (n) out.push({ key: `${m.key}:${n}`, label: m.label, field: m.key });
  }
  return out;
}

/** Strong = anything but a bare name match. */
const isStrong = (field: MatchKeyName) => field !== "name";

type IdentityRow = { id: number; name: string; email: string | null; phone: string | null; taxId: string | null; vatNumber: string | null };

/**
 * Do a spreadsheet row and an existing client disagree on any identifier they BOTH carry? Used to
 * stop a name-only match from merging two different companies that happen to share a name — if one
 * side leaves an identifier blank there is nothing to disagree about, so it is not a contradiction.
 */
function contradicts(row: Partial<Record<MatchKeyName, string | null>>, existing: IdentityRow): boolean {
  for (const m of MATCH_KEYS) {
    if (!isStrong(m.key)) continue;
    const a = (row[m.key] ?? "").toString().trim();
    const b = (existing[m.key] ?? "").toString().trim();
    if (!a || !b) continue;
    if (m.norm(a) !== m.norm(b)) return true;
  }
  return false;
}

export type RowDraft = {
  /** 0-based index into the uploaded data rows. */
  index: number;
  fields?: ClientFieldValues;
  errors: string[];
  /** Existing client this row resolves to, when one was found. */
  matchId?: number;
  matchName?: string;
  matchedOn?: string;
  action: "create" | "update" | "skip" | "error";
};

export type RowPreview = {
  /** 1-based row number in the uploaded file, counting the header row. */
  row: number;
  name: string;
  email: string;
  phone: string;
  action: RowDraft["action"];
  matchedOn: string;
  matchName: string;
  ok: boolean;
  errors: string[];
};

export type ClientPreviewSummary = {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  newClients: number;
  matchingClients: number;
  willCreate: number;
  willUpdate: number;
  willSkip: number;
};

export type ClientPreviewResult = {
  summary: ClientPreviewSummary;
  rows: RowPreview[];
  /** [rowIndex, messages] — feeds the downloadable invalid-rows file. */
  rowErrors: [number, string[]][];
};

/** Fields the importer is allowed to write, in the order they appear in the template. */
const FIELD_KEYS = CLIENT_IMPORT_SPEC.fields.map((f) => f.key);

/** Map a spreadsheet row onto the normalizer's input shape (Country -> countryCode). */
function toInput(row: MappedRow): Record<string, string> {
  const o: Record<string, string> = {};
  for (const k of FIELD_KEYS) o[k] = (row[k] ?? "").trim();
  o.countryCode = o.country ?? "";
  return o;
}

/**
 * Validate every row against the org's existing clients and against the rest of the file.
 * Nothing is written. `mode` only affects what each matching row is *going* to do.
 */
export async function validateClientImport(
  orgId: number,
  rows: MappedRow[],
  mode: DuplicateMode = DEFAULT_DUPLICATE_MODE,
): Promise<{ drafts: RowDraft[]; result: ClientPreviewResult }> {
  // Existing clients for THIS org only — archived and deleted rows included, so an import can never
  // silently recreate a client sitting in the Recycle Bin.
  const existing = await db
    .select({
      id: customersTable.id, name: customersTable.name, email: customersTable.email,
      phone: customersTable.phone, taxId: customersTable.taxId, vatNumber: customersTable.vatNumber,
    })
    .from(customersTable)
    .where(tenantScope(orgId, customersTable, { includeArchived: true, includeDeleted: true }));

  // identifier -> existing client. Earlier (stronger) keys win when two clients collide on one.
  const byIdentity = new Map<string, IdentityRow>();
  for (const c of existing) {
    for (const { key } of identityKeys(c)) if (!byIdentity.has(key)) byIdentity.set(key, c);
  }

  const seenInFile = new Map<string, number>(); // identifier -> first row number that used it
  const drafts: RowDraft[] = [];

  for (let i = 0; i < rows.length; i++) {
    const draft: RowDraft = { index: i, errors: [], action: "error" };
    const { errors, fields } = normalizeClientFields(toInput(rows[i]));
    draft.errors.push(...errors);
    draft.fields = fields;

    if (fields) {
      const rowIds = fields as Partial<Record<MatchKeyName, string | null>>;
      const keys = identityKeys(rowIds);
      const strong = keys.filter((k) => isStrong(k.field));
      const nameKey = keys.find((k) => k.field === "name");

      // Duplicate inside the uploaded file — importing both would create two records for one client.
      const fileKeys = strong.length ? strong : keys;
      for (const k of fileKeys) {
        const firstRow = seenInFile.get(k.key);
        if (firstRow !== undefined) {
          draft.errors.push(`Same ${k.label} as row ${firstRow} of this file — remove the duplicate row.`);
          break;
        }
      }
      if (!draft.errors.length) for (const k of fileKeys) if (!seenInFile.has(k.key)) seenInFile.set(k.key, i + 2);

      // Existing client in this organization: strongest identifier first.
      for (const k of strong) {
        const hit = byIdentity.get(k.key);
        if (hit) { draft.matchId = hit.id; draft.matchName = hit.name; draft.matchedOn = k.label; break; }
      }
      // Name is the last resort, and only when the two records do not disagree on an identifier they
      // both carry — a shared name with a different VAT number is a different client, not a duplicate.
      if (!draft.matchId && nameKey) {
        const hit = byIdentity.get(nameKey.key);
        if (hit && !contradicts(rowIds, hit)) {
          draft.matchId = hit.id; draft.matchName = hit.name; draft.matchedOn = nameKey.label;
        }
      }
    }

    if (draft.errors.length || !fields) draft.action = "error";
    else if (draft.matchId) draft.action = mode === "update" ? "update" : "skip";
    else draft.action = "create";

    drafts.push(draft);
  }

  const rowsPreview: RowPreview[] = drafts.map((d) => ({
    row: d.index + 2, // +2 = 1-based data row under the header row
    name: (rows[d.index].name ?? "").trim(),
    email: (rows[d.index].email ?? "").trim(),
    phone: (rows[d.index].phone ?? "").trim(),
    action: d.action,
    matchedOn: d.matchedOn ?? "",
    matchName: d.matchName ?? "",
    ok: d.action !== "error",
    errors: d.errors,
  }));

  const matching = drafts.filter((d) => d.action !== "error" && d.matchId).length;
  return {
    drafts,
    result: {
      summary: {
        totalRows: rows.length,
        validRows: drafts.filter((d) => d.action !== "error").length,
        invalidRows: drafts.filter((d) => d.action === "error").length,
        newClients: drafts.filter((d) => d.action === "create").length,
        matchingClients: matching,
        willCreate: drafts.filter((d) => d.action === "create").length,
        willUpdate: drafts.filter((d) => d.action === "update").length,
        willSkip: drafts.filter((d) => d.action === "skip").length,
      },
      rows: rowsPreview,
      rowErrors: drafts.filter((d) => d.errors.length).map((d) => [d.index, d.errors] as [number, string[]]),
    },
  };
}

export type ClientCommitOutcome = {
  created: number;
  updated: number;
  skipped: number;
  duplicates: number;
  failed: number;
  total: number;
  /** Ids of the clients this run created or updated, for activity logging. */
  touchedIds: number[];
  errors: [number, string[]][];
};

/** Only the columns the row actually filled in — a blank cell must never erase existing data. */
function nonEmptyFields(fields: ClientFieldValues): ClientFieldValues {
  const out: ClientFieldValues = {};
  for (const [k, v] of Object.entries(fields)) {
    if (k === "clientType") continue; // defaulted, not something a blank cell should overwrite
    if (v !== null && String(v).trim() !== "") out[k] = v;
  }
  return out;
}

/**
 * Import the rows. Everything is re-validated here — the client's preview is never trusted — and each
 * client is written in its own transaction so a failure leaves no partial record and does not stop
 * the remaining rows.
 */
export async function commitClientImport(
  orgId: number,
  rows: MappedRow[],
  mode: DuplicateMode = DEFAULT_DUPLICATE_MODE,
): Promise<ClientCommitOutcome> {
  const { drafts } = await validateClientImport(orgId, rows, mode);

  const outcome: ClientCommitOutcome = {
    created: 0, updated: 0, skipped: 0, duplicates: 0, failed: 0, total: rows.length,
    touchedIds: [], errors: [],
  };

  for (const d of drafts) {
    if (d.action === "error" || !d.fields) {
      outcome.failed++;
      outcome.errors.push([d.index, d.errors.length ? d.errors : ["Row could not be imported."]]);
      continue;
    }
    if (d.action === "skip") {
      outcome.skipped++;
      outcome.duplicates++;
      continue;
    }

    try {
      if (d.action === "update" && d.matchId) {
        const patch = nonEmptyFields(d.fields);
        await db.transaction(async (tx) => {
          const res = await tx
            .update(customersTable)
            .set(patch)
            .where(and(eq(customersTable.id, d.matchId!), tenantScope(orgId, customersTable, { includeArchived: true, includeDeleted: true })))
            .returning({ id: customersTable.id });
          if (!res.length) throw new Error("Client not found in this organization.");
        });
        outcome.updated++;
        outcome.duplicates++;
        outcome.touchedIds.push(d.matchId);
      } else {
        const created = await db.transaction(async (tx) => {
          const [row] = await tx
            .insert(customersTable)
            .values({ orgId, ...d.fields, name: String(d.fields!.name) })
            .returning({ id: customersTable.id });
          return row;
        });
        outcome.created++;
        outcome.touchedIds.push(created.id);
      }
    } catch (err) {
      outcome.failed++;
      outcome.errors.push([d.index, [err instanceof Error ? err.message : String(err)]]);
    }
  }

  return outcome;
}
