import "server-only";
import { and, eq, or, isNull, asc } from "drizzle-orm";
import { db, noteTemplatesTable, termsConditionsGroupsTable } from "@/db";

export type ContentPreset = { id: number; name: string; content: string; isDefault: boolean };
export type DocumentContentPresets = { noteTemplates: ContentPreset[]; termsGroups: ContentPreset[] };

// Loads the org's Note Templates and Terms & Conditions Groups that apply to a document type
// (its own type OR "any"), so document create forms can offer them and pre-fill the default.
// Tenant-scoped. Consumed by the sales/purchasing create pages.
export async function getDocumentContentPresets(orgId: number, docType: string): Promise<DocumentContentPresets> {
  const [noteTemplates, termsGroups] = await Promise.all([
    db
      .select({ id: noteTemplatesTable.id, name: noteTemplatesTable.name, content: noteTemplatesTable.content, isDefault: noteTemplatesTable.isDefault })
      .from(noteTemplatesTable)
      .where(and(eq(noteTemplatesTable.orgId, orgId), or(eq(noteTemplatesTable.documentType, docType), isNull(noteTemplatesTable.documentType))))
      .orderBy(asc(noteTemplatesTable.name)),
    db
      .select({ id: termsConditionsGroupsTable.id, name: termsConditionsGroupsTable.name, content: termsConditionsGroupsTable.content, isDefault: termsConditionsGroupsTable.isDefault })
      .from(termsConditionsGroupsTable)
      .where(and(eq(termsConditionsGroupsTable.orgId, orgId), or(eq(termsConditionsGroupsTable.documentType, docType), isNull(termsConditionsGroupsTable.documentType))))
      .orderBy(asc(termsConditionsGroupsTable.name)),
  ]);
  return { noteTemplates, termsGroups };
}
