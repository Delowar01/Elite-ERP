import "server-only";
import { db, documentAttachmentsTable } from "@/db";

// Persist the attachments staged on a creation page once the document row exists. Called inside the
// create/update transaction. Only accepts URLs the upload action produced (uploads/attachments),
// so a client can't inject an arbitrary path.
export type AttachmentInput = { fileName: string; fileUrl: string; contentType?: string; sizeBytes?: number };

type Tx = { insert: typeof db.insert };

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
    .filter((a) => a.fileUrl && a.fileUrl.startsWith("/uploads/attachments/"))
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
