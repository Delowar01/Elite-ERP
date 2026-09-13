import "server-only";
import { db, documentAttachmentsTable } from "@/db";

// Persist the attachments staged on a creation page once the document row exists. Called inside the
// create/update transaction. Only accepts URLs the upload action produced, so a client can't inject
// an arbitrary path.
//
// The accepted shape is whatever storeBlob() returns for the "attachments" folder:
//   /uploads/organizations/{orgId}/attachments/{orgId}-{ts}-{16 hex}.{png|jpg|pdf}
// This filter used to require the pre-Blob, local-filesystem prefix `/uploads/attachments/`, which
// no upload has produced since storage moved to Vercel Blob. It matched nothing, so every staged
// attachment was dropped here in silence — no row, no error, on create AND update, for all five
// document types. The prefix is now built from the CALLER'S orgId rather than being a constant, so
// it also binds each row to the acting tenant: a forged path pointing at another organization's
// folder no longer satisfies it, which the old constant prefix could not check at all.
export type AttachmentInput = { fileName: string; fileUrl: string; contentType?: string; sizeBytes?: number };

type Tx = { insert: typeof db.insert };

// Mirrors the server-generated name the upload route also enforces, so only a path this application
// minted is accepted — a well-formed prefix with a hand-written filename is still refused.
const ATTACHMENT_FILE_RE = /^(\d+)-\d+-[0-9a-f]{16}\.(png|jpg|pdf)$/;

function acceptedAttachmentUrl(fileUrl: string | undefined, orgId: number): boolean {
  if (!fileUrl) return false;
  const prefix = `/uploads/organizations/${orgId}/attachments/`;
  if (!fileUrl.startsWith(prefix)) return false;
  const name = fileUrl.slice(prefix.length);
  const m = ATTACHMENT_FILE_RE.exec(name);
  return m !== null && Number(m[1]) === orgId;
}

export async function persistDocumentAttachments(
  tx: Tx,
  orgId: number,
  userId: number,
  documentType: string,
  documentId: number,
  attachments: AttachmentInput[] | undefined,
): Promise<void> {
  if (!attachments || attachments.length === 0) return;
  const rows = attachments
    .filter((a) => acceptedAttachmentUrl(a.fileUrl, orgId))
    .map((a) => ({
      orgId,
      documentType,
      documentId,
      fileName: (a.fileName || "attachment").slice(0, 200),
      fileUrl: a.fileUrl,
      contentType: a.contentType ?? null,
      sizeBytes: a.sizeBytes ?? null,
      uploadedById: userId,
    }));
  if (rows.length) await tx.insert(documentAttachmentsTable).values(rows);
}
