import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { orgsTable } from "./orgs";
import { usersTable } from "./users";

// File attachments on document creation pages (Terms, Notes & Attachments → Add Attachment).
// Tenant-scoped. documentType is the sequence slug ("quotation", "sales_invoice", …) and
// documentId points at that document's row. Files are stored on disk (public/uploads) and served
// through the existing uploads route; only metadata lives here.
export const documentAttachmentsTable = pgTable("document_attachments", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id")
    .notNull()
    .references(() => orgsTable.id, { onDelete: "cascade" }),
  documentType: text("document_type").notNull(),
  documentId: integer("document_id").notNull(),
  fileName: text("file_name").notNull(),
  fileUrl: text("file_url").notNull(),
  contentType: text("content_type"),
  sizeBytes: integer("size_bytes"),
  uploadedById: integer("uploaded_by_id")
    .notNull()
    .references(() => usersTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type DocumentAttachment = typeof documentAttachmentsTable.$inferSelect;
