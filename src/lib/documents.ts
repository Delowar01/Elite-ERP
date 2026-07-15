import "server-only";
import { and, eq } from "drizzle-orm";
import { db, documentSequencesTable, type Tx } from "@/db";
import type { DOCUMENT_TYPES } from "@/db/schema";

type DocumentType = (typeof DOCUMENT_TYPES)[number];

// Increment-then-use inside the caller's transaction, so two concurrent creates never collide
// on the same number — this is the single source of truth for every document number in the app.
export async function nextDocumentNumber(tx: Tx, orgId: number, documentType: DocumentType): Promise<string> {
  const [seq] = await tx
    .select()
    .from(documentSequencesTable)
    .where(and(eq(documentSequencesTable.orgId, orgId), eq(documentSequencesTable.documentType, documentType)))
    .for("update");

  if (!seq) throw new Error(`No document sequence configured for ${documentType}.`);

  await tx
    .update(documentSequencesTable)
    .set({ nextNumber: seq.nextNumber + 1 })
    .where(eq(documentSequencesTable.id, seq.id));

  return `${seq.prefix}${String(seq.nextNumber).padStart(seq.padding, "0")}`;
}

// Read-only preview of the number a new document will get — for display on create screens only.
// Not authoritative: the real allocation happens transactionally in nextDocumentNumber() on submit.
export async function previewNextDocumentNumber(orgId: number, documentType: DocumentType): Promise<string> {
  const [seq] = await db
    .select()
    .from(documentSequencesTable)
    .where(and(eq(documentSequencesTable.orgId, orgId), eq(documentSequencesTable.documentType, documentType)));
  if (!seq) return "—";
  return `${seq.prefix}${String(seq.nextNumber).padStart(seq.padding, "0")}`;
}
