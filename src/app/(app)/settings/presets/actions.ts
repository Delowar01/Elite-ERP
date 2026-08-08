"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import {
  db,
  taxPresetsTable,
  paymentTermPresetsTable,
  unitsTable,
  departmentsTable,
  productCategoriesTable,
  leaveTypesTable,
  expenseCategoriesTable,
  noteTemplatesTable,
  termsConditionsGroupsTable,
  productBundlesTable,
  productBundleItemsTable,
  documentSequencesTable,
  bankAccountsTable,
  orgsTable,
} from "@/db";
import { requireRole } from "@/lib/session";
import { logActivity } from "@/lib/activity";

export type ActionResult = { error?: string };

const PATH = "/settings/presets";

// ---- the 7 "simple" presets: a name + at most one extra field, no soft delete (deleting a
// preset that's already referenced by a document just leaves that document's stored text/value
// unchanged — presets are a picklist source, not a foreign key the rest of the schema depends on).

export async function createTaxPresetAction(name: string, ratePercent: string): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");
  if (!name.trim()) return { error: "Name is required." };
  const rate = Number(ratePercent);
  if (Number.isNaN(rate) || rate < 0 || rate > 100) return { error: "Rate must be between 0 and 100." };
  await db.insert(taxPresetsTable).values({ orgId: session.orgId, name: name.trim(), ratePercent: ratePercent });
  revalidatePath(PATH);
  return {};
}
export async function updateTaxPresetAction(id: number, name: string, ratePercent: string): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");
  if (!name.trim()) return { error: "Name is required." };
  const rate = Number(ratePercent);
  if (Number.isNaN(rate) || rate < 0 || rate > 100) return { error: "Rate must be between 0 and 100." };
  const result = await db
    .update(taxPresetsTable)
    .set({ name: name.trim(), ratePercent })
    .where(and(eq(taxPresetsTable.id, id), eq(taxPresetsTable.orgId, session.orgId)))
    .returning({ id: taxPresetsTable.id });
  if (!result.length) return { error: "Not found." };
  revalidatePath(PATH);
  return {};
}
export async function deleteTaxPresetAction(id: number): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");
  await db.delete(taxPresetsTable).where(and(eq(taxPresetsTable.id, id), eq(taxPresetsTable.orgId, session.orgId)));
  revalidatePath(PATH);
  return {};
}

export async function createPaymentTermAction(name: string, netDays: string): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");
  if (!name.trim()) return { error: "Name is required." };
  const days = Number(netDays);
  if (Number.isNaN(days) || days < 0) return { error: "Net days must be a positive number." };
  await db.insert(paymentTermPresetsTable).values({ orgId: session.orgId, name: name.trim(), netDays: days });
  revalidatePath(PATH);
  return {};
}
export async function updatePaymentTermAction(id: number, name: string, netDays: string): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");
  if (!name.trim()) return { error: "Name is required." };
  const days = Number(netDays);
  if (Number.isNaN(days) || days < 0) return { error: "Net days must be a positive number." };
  const result = await db
    .update(paymentTermPresetsTable)
    .set({ name: name.trim(), netDays: days })
    .where(and(eq(paymentTermPresetsTable.id, id), eq(paymentTermPresetsTable.orgId, session.orgId)))
    .returning({ id: paymentTermPresetsTable.id });
  if (!result.length) return { error: "Not found." };
  revalidatePath(PATH);
  return {};
}
export async function deletePaymentTermAction(id: number): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");
  await db
    .delete(paymentTermPresetsTable)
    .where(and(eq(paymentTermPresetsTable.id, id), eq(paymentTermPresetsTable.orgId, session.orgId)));
  revalidatePath(PATH);
  return {};
}

export async function createUnitAction(name: string, abbreviation: string): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");
  if (!name.trim() || !abbreviation.trim()) return { error: "Name and abbreviation are required." };
  await db.insert(unitsTable).values({ orgId: session.orgId, name: name.trim(), abbreviation: abbreviation.trim() });
  revalidatePath(PATH);
  return {};
}
export async function updateUnitAction(id: number, name: string, abbreviation: string): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");
  if (!name.trim() || !abbreviation.trim()) return { error: "Name and abbreviation are required." };
  const result = await db
    .update(unitsTable)
    .set({ name: name.trim(), abbreviation: abbreviation.trim() })
    .where(and(eq(unitsTable.id, id), eq(unitsTable.orgId, session.orgId)))
    .returning({ id: unitsTable.id });
  if (!result.length) return { error: "Not found." };
  revalidatePath(PATH);
  return {};
}
export async function deleteUnitAction(id: number): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");
  await db.delete(unitsTable).where(and(eq(unitsTable.id, id), eq(unitsTable.orgId, session.orgId)));
  revalidatePath(PATH);
  return {};
}

export async function createDepartmentAction(name: string): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");
  if (!name.trim()) return { error: "Name is required." };
  await db.insert(departmentsTable).values({ orgId: session.orgId, name: name.trim() });
  revalidatePath(PATH);
  return {};
}
export async function updateDepartmentAction(id: number, name: string): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");
  if (!name.trim()) return { error: "Name is required." };
  const result = await db
    .update(departmentsTable)
    .set({ name: name.trim() })
    .where(and(eq(departmentsTable.id, id), eq(departmentsTable.orgId, session.orgId)))
    .returning({ id: departmentsTable.id });
  if (!result.length) return { error: "Not found." };
  revalidatePath(PATH);
  return {};
}
export async function deleteDepartmentAction(id: number): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");
  await db.delete(departmentsTable).where(and(eq(departmentsTable.id, id), eq(departmentsTable.orgId, session.orgId)));
  revalidatePath(PATH);
  return {};
}

export async function createProductCategoryAction(name: string): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");
  if (!name.trim()) return { error: "Name is required." };
  await db.insert(productCategoriesTable).values({ orgId: session.orgId, name: name.trim() });
  revalidatePath(PATH);
  return {};
}
export async function updateProductCategoryAction(id: number, name: string): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");
  if (!name.trim()) return { error: "Name is required." };
  const result = await db
    .update(productCategoriesTable)
    .set({ name: name.trim() })
    .where(and(eq(productCategoriesTable.id, id), eq(productCategoriesTable.orgId, session.orgId)))
    .returning({ id: productCategoriesTable.id });
  if (!result.length) return { error: "Not found." };
  revalidatePath(PATH);
  return {};
}
export async function deleteProductCategoryAction(id: number): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");
  await db
    .delete(productCategoriesTable)
    .where(and(eq(productCategoriesTable.id, id), eq(productCategoriesTable.orgId, session.orgId)));
  revalidatePath(PATH);
  return {};
}

export async function createLeaveTypeAction(name: string, daysPerYear: string): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");
  if (!name.trim()) return { error: "Name is required." };
  const days = daysPerYear.trim() === "" ? null : Number(daysPerYear);
  if (days !== null && (Number.isNaN(days) || days < 0)) return { error: "Days/year must be a positive number." };
  await db.insert(leaveTypesTable).values({ orgId: session.orgId, name: name.trim(), daysPerYear: days });
  revalidatePath(PATH);
  return {};
}
export async function updateLeaveTypeAction(id: number, name: string, daysPerYear: string): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");
  if (!name.trim()) return { error: "Name is required." };
  const days = daysPerYear.trim() === "" ? null : Number(daysPerYear);
  if (days !== null && (Number.isNaN(days) || days < 0)) return { error: "Days/year must be a positive number." };
  const result = await db
    .update(leaveTypesTable)
    .set({ name: name.trim(), daysPerYear: days })
    .where(and(eq(leaveTypesTable.id, id), eq(leaveTypesTable.orgId, session.orgId)))
    .returning({ id: leaveTypesTable.id });
  if (!result.length) return { error: "Not found." };
  revalidatePath(PATH);
  return {};
}
export async function deleteLeaveTypeAction(id: number): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");
  await db.delete(leaveTypesTable).where(and(eq(leaveTypesTable.id, id), eq(leaveTypesTable.orgId, session.orgId)));
  revalidatePath(PATH);
  return {};
}


/**
 * Expense Categories is hidden.
 *
 * Nothing consumes it. The only reads of expense_categories are the preset editor rendering itself
 * and seed-org inserting three defaults per org — there is no Expenses module, and expensesTable
 * (finance.ts) is referenced by nothing at all. It is also orphaned by schema rather than merely by
 * omission: expenses.category is free text, not a foreign key to this table, so shipping Expenses
 * would not consume these rows as things currently stand. Offering an editor for a list that
 * changes nothing is a promise the app does not keep.
 *
 * The table, its rows and this code all stay. Hiding is reversible; dropping data is not, and if an
 * Expenses module arrives this is a starting point rather than something to rebuild. Restoring the
 * feature means flipping this flag back, restoring the tab, and — the actual work — deciding how
 * expenses reference a category.
 *
 * The actions below refuse rather than merely being unreachable from the UI. A server action stays
 * callable whether or not anything renders a button for it, so hiding the tab alone would leave a
 * live write path behind a hidden door — the same "hidden in the UI, not actually restricted" shape
 * catalogued in the Roles & Permissions work.
 */
const EXPENSE_CATEGORIES_ENABLED = false;
const EXPENSE_CATEGORIES_DISABLED = "Expense categories are not available.";

export async function createExpenseCategoryAction(name: string): Promise<ActionResult> {
  if (!EXPENSE_CATEGORIES_ENABLED) return { error: EXPENSE_CATEGORIES_DISABLED };
  const session = await requireRole("owner", "admin");
  if (!name.trim()) return { error: "Name is required." };
  await db.insert(expenseCategoriesTable).values({ orgId: session.orgId, name: name.trim() });
  revalidatePath(PATH);
  return {};
}
export async function updateExpenseCategoryAction(id: number, name: string): Promise<ActionResult> {
  if (!EXPENSE_CATEGORIES_ENABLED) return { error: EXPENSE_CATEGORIES_DISABLED };
  const session = await requireRole("owner", "admin");
  if (!name.trim()) return { error: "Name is required." };
  const result = await db
    .update(expenseCategoriesTable)
    .set({ name: name.trim() })
    .where(and(eq(expenseCategoriesTable.id, id), eq(expenseCategoriesTable.orgId, session.orgId)))
    .returning({ id: expenseCategoriesTable.id });
  if (!result.length) return { error: "Not found." };
  revalidatePath(PATH);
  return {};
}
export async function deleteExpenseCategoryAction(id: number): Promise<ActionResult> {
  if (!EXPENSE_CATEGORIES_ENABLED) return { error: EXPENSE_CATEGORIES_DISABLED };
  const session = await requireRole("owner", "admin");
  await db
    .delete(expenseCategoriesTable)
    .where(and(eq(expenseCategoriesTable.id, id), eq(expenseCategoriesTable.orgId, session.orgId)));
  revalidatePath(PATH);
  return {};
}

// ---- Note Templates: name + document type + content + isDefault ----

const DOC_TYPE_OPTIONS = ["quotation", "sales_order", "proforma_invoice", "sales_invoice", "delivery_challan"] as const;

export async function saveNoteTemplateAction(input: {
  id?: number;
  name: string;
  documentType: string | null;
  content: string;
  isDefault: boolean;
}): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");
  if (!input.name.trim()) return { error: "Name is required." };
  if (!input.content.trim()) return { error: "Content is required." };
  if (input.documentType && !DOC_TYPE_OPTIONS.includes(input.documentType as (typeof DOC_TYPE_OPTIONS)[number])) {
    return { error: "Invalid document type." };
  }

  await db.transaction(async (tx) => {
    // At most one default per (orgId, documentType) — clear any existing default first.
    if (input.isDefault && input.documentType) {
      await tx
        .update(noteTemplatesTable)
        .set({ isDefault: false })
        .where(and(eq(noteTemplatesTable.orgId, session.orgId), eq(noteTemplatesTable.documentType, input.documentType)));
    }
    if (input.id) {
      await tx
        .update(noteTemplatesTable)
        .set({
          name: input.name.trim(),
          documentType: input.documentType,
          content: input.content.trim(),
          isDefault: input.isDefault,
        })
        .where(and(eq(noteTemplatesTable.id, input.id), eq(noteTemplatesTable.orgId, session.orgId)));
    } else {
      await tx.insert(noteTemplatesTable).values({
        orgId: session.orgId,
        name: input.name.trim(),
        documentType: input.documentType,
        content: input.content.trim(),
        isDefault: input.isDefault,
      });
    }
  });

  revalidatePath(PATH);
  revalidatePath("/settings/organization");
  return {};
}
export async function deleteNoteTemplateAction(id: number): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");
  await db
    .delete(noteTemplatesTable)
    .where(and(eq(noteTemplatesTable.id, id), eq(noteTemplatesTable.orgId, session.orgId)));
  revalidatePath(PATH);
  revalidatePath("/settings/organization");
  return {};
}

// ---- Terms & Conditions Groups: name + document type + content + isDefault ----
// Same shape/rules as Note Templates. Consumed by document create forms to pre-fill / insert
// the default (or chosen) terms into the document's notes. purchase_order is included since POs
// also carry terms.

const TERMS_DOC_TYPE_OPTIONS = ["quotation", "sales_order", "proforma_invoice", "sales_invoice", "delivery_challan", "purchase_order"] as const;

export async function saveTermsGroupAction(input: {
  id?: number;
  name: string;
  documentType: string | null;
  terms: string[];
  isDefault: boolean;
}): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");
  if (!input.name.trim()) return { error: "Name is required." };
  // Structured storage: keep each term's own multiline text and order; drop empty terms.
  const terms = (Array.isArray(input.terms) ? input.terms : []).map((s) => s.trim()).filter(Boolean);
  if (terms.length === 0) return { error: "At least one term is required." };
  if (input.documentType && !TERMS_DOC_TYPE_OPTIONS.includes(input.documentType as (typeof TERMS_DOC_TYPE_OPTIONS)[number])) {
    return { error: "Invalid document type." };
  }

  await db.transaction(async (tx) => {
    // At most one default per (orgId, documentType).
    if (input.isDefault && input.documentType) {
      await tx
        .update(termsConditionsGroupsTable)
        .set({ isDefault: false })
        .where(and(eq(termsConditionsGroupsTable.orgId, session.orgId), eq(termsConditionsGroupsTable.documentType, input.documentType)));
    }
    if (input.id) {
      const updated = await tx
        .update(termsConditionsGroupsTable)
        .set({ name: input.name.trim(), documentType: input.documentType, terms, isDefault: input.isDefault })
        .where(and(eq(termsConditionsGroupsTable.id, input.id), eq(termsConditionsGroupsTable.orgId, session.orgId)))
        .returning({ id: termsConditionsGroupsTable.id });
      if (!updated.length) throw new Error("Not found.");
    } else {
      await tx.insert(termsConditionsGroupsTable).values({
        orgId: session.orgId,
        name: input.name.trim(),
        documentType: input.documentType,
        terms,
        isDefault: input.isDefault,
      });
    }
  });

  revalidatePath(PATH);
  return {};
}
export async function deleteTermsGroupAction(id: number): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");
  await db
    .delete(termsConditionsGroupsTable)
    .where(and(eq(termsConditionsGroupsTable.id, id), eq(termsConditionsGroupsTable.orgId, session.orgId)));
  revalidatePath(PATH);
  return {};
}

// ---- Product Bundles: name + line items (product + quantity) ----

export async function createBundleAction(name: string): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");
  if (!name.trim()) return { error: "Name is required." };
  await db.insert(productBundlesTable).values({ orgId: session.orgId, name: name.trim() });
  revalidatePath(PATH);
  return {};
}
export async function updateBundleAction(id: number, name: string): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");
  if (!name.trim()) return { error: "Name is required." };
  const result = await db
    .update(productBundlesTable)
    .set({ name: name.trim() })
    .where(and(eq(productBundlesTable.id, id), eq(productBundlesTable.orgId, session.orgId)))
    .returning({ id: productBundlesTable.id });
  if (!result.length) return { error: "Not found." };
  revalidatePath(PATH);
  return {};
}
export async function deleteBundleAction(id: number): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");
  await db
    .delete(productBundlesTable)
    .where(and(eq(productBundlesTable.id, id), eq(productBundlesTable.orgId, session.orgId)));
  revalidatePath(PATH);
  return {};
}
export async function addBundleItemAction(bundleId: number, productId: number, quantity: string): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");
  const qty = Number(quantity);
  if (Number.isNaN(qty) || qty <= 0) return { error: "Quantity must be a positive number." };
  const [bundle] = await db
    .select({ id: productBundlesTable.id })
    .from(productBundlesTable)
    .where(and(eq(productBundlesTable.id, bundleId), eq(productBundlesTable.orgId, session.orgId)));
  if (!bundle) return { error: "Bundle not found." };
  await db.insert(productBundleItemsTable).values({ bundleId, productId, quantity });
  revalidatePath(PATH);
  return {};
}
export async function removeBundleItemAction(itemId: number, bundleId: number): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");
  const [bundle] = await db
    .select({ id: productBundlesTable.id })
    .from(productBundlesTable)
    .where(and(eq(productBundlesTable.id, bundleId), eq(productBundlesTable.orgId, session.orgId)));
  if (!bundle) return { error: "Bundle not found." };
  await db.delete(productBundleItemsTable).where(eq(productBundleItemsTable.id, itemId));
  revalidatePath(PATH);
  return {};
}

// ---- Document Numbering: prefix + next number + padding per document type ----

export async function updateSequenceAction(
  id: number,
  prefix: string,
  nextNumber: string,
  padding: string,
): Promise<ActionResult> {
  const session = await requireRole("owner", "admin");
  const next = Number(nextNumber);
  const pad = Number(padding);
  if (!prefix.trim()) return { error: "Prefix is required." };
  if (Number.isNaN(next) || next < 1) return { error: "Next number must be at least 1." };
  if (Number.isNaN(pad) || pad < 1 || pad > 10) return { error: "Padding must be between 1 and 10." };

  const result = await db
    .update(documentSequencesTable)
    .set({ prefix: prefix.trim(), nextNumber: next, padding: pad })
    .where(and(eq(documentSequencesTable.id, id), eq(documentSequencesTable.orgId, session.orgId)))
    .returning({ id: documentSequencesTable.id });
  if (!result.length) return { error: "Not found." };

  await logActivity(session, {
    type: "document-sequence.updated",
    description: `Updated numbering: ${prefix.trim()}`,
    entityType: "document_sequence",
    entityId: id,
  });
  revalidatePath(PATH);
  return {};
}

// ---- Default Bank Accounts (Preset Management) ----
// Stores an ordered list of bank_accounts.id on the org. These pre-fill the Bank Account section of
// NEW documents. Changing them never alters documents already saved (those hold their own snapshot).
export async function updateDefaultBankAccountsAction(ids: number[]): Promise<{ error?: string }> {
  const session = await requireRole("owner", "admin");
  const clean = Array.isArray(ids) ? ids.filter((x) => Number.isInteger(x)) : [];
  // Keep only accounts that belong to this org (tenant isolation), preserving the given order.
  const owned = clean.length
    ? await db
        .select({ id: bankAccountsTable.id })
        .from(bankAccountsTable)
        .where(and(eq(bankAccountsTable.orgId, session.orgId)))
    : [];
  const ownedSet = new Set(owned.map((r) => r.id));
  const ordered: number[] = [];
  for (const id of clean) if (ownedSet.has(id) && !ordered.includes(id)) ordered.push(id);

  await db
    .update(orgsTable)
    .set({ defaultBankAccountIds: ordered, updatedAt: new Date() })
    .where(eq(orgsTable.id, session.orgId));
  revalidatePath("/settings/presets");
  return {};
}
