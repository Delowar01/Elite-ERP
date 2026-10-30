"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, inventoryMovementsTable, productsTable, type InventoryItemType } from "@/db";
import { requireSession, requireRole } from "@/lib/session";
import { tenantScope } from "@/lib/tenant";
import { logActivity } from "@/lib/activity";
import { getLocale } from "@/lib/i18n/server";
import { adjustStock, isInventoryRefusal, itemTypeChangeRefusal, parseUnitCost, recordOpeningStock, refusalText } from "@/lib/inventory-costing";

export type ActionState = { error?: string } | undefined;

/** ACC-01: the form's item type; anything but "service" is a stock item, as every product was before. */
function readItemType(formData: FormData): InventoryItemType {
  return formData.get("itemType") === "service" ? "service" : "stock";
}

function readProductFields(formData: FormData) {
  const sku = String(formData.get("sku") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  return {
    sku,
    name,
    description: String(formData.get("description") ?? "").trim() || null,
    unit: String(formData.get("unit") ?? "pcs").trim() || "pcs",
    unitPrice: String(formData.get("unitPrice") ?? "0"),
    costPrice: formData.get("costPrice") ? String(formData.get("costPrice")) : null,
    taxRatePercent: String(formData.get("taxRatePercent") ?? "15"),
    reorderLevel: Number(formData.get("reorderLevel") ?? 0),
  };
}

export async function createProductAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  const fields = readProductFields(formData);
  if (!fields.sku || !fields.name) return { error: "SKU and name are required." };

  const [existing] = await db
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(and(eq(productsTable.orgId, session.orgId), eq(productsTable.sku, fields.sku)))
    .limit(1);
  if (existing) return { error: `SKU "${fields.sku}" is already in use.` };

  // ACC-01: opening stock is a valued receipt, never a bare number — it needs its unit cost, and it
  // posts Dr 1200 Inventory / Cr 3000 Owner's Equity. A service carries no stock at all.
  const itemType = readItemType(formData);
  const openingQuantity = Number(formData.get("quantityOnHand") ?? 0);
  let row: { id: number };
  try {
    row = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(productsTable)
        .values({ orgId: session.orgId, ...fields, itemType, quantityOnHand: 0 })
        .returning({ id: productsTable.id });
      if (openingQuantity !== 0) {
        await recordOpeningStock(
          tx,
          { orgId: session.orgId, userId: session.userId, baseCurrency: session.orgCurrency, date: new Date().toISOString().slice(0, 10) },
          { productId: created.id, quantity: openingQuantity, unitCost: parseUnitCost(String(formData.get("openingUnitCost") ?? "")) },
        );
      }
      return created;
    });
  } catch (e) {
    if (isInventoryRefusal(e)) return { error: refusalText(e, await getLocale()) };
    throw e;
  }

  await logActivity(session, {
    type: "product.created",
    description: `Created product "${fields.name}" (${fields.sku})`,
    entityType: "product",
    entityId: row.id,
  });

  revalidatePath("/inventory/products");
  redirect(`/inventory/products/${row.id}`);
}

export async function updateProductAction(id: number, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  const fields = readProductFields(formData);
  if (!fields.sku || !fields.name) return { error: "SKU and name are required." };

  // ACC-01: the item type changes only while the product has no stock and no stock history.
  const itemType = readItemType(formData);
  const result = await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ itemType: productsTable.itemType })
      .from(productsTable)
      .where(and(eq(productsTable.id, id), tenantScope(session.orgId, productsTable)));
    if (!current) return { error: "Product not found." } as const;
    if (current.itemType !== itemType) {
      const refusal = await itemTypeChangeRefusal(tx, session.orgId, id);
      if (refusal) return { error: refusalText(refusal, await getLocale()) } as const;
    }
    await tx
      .update(productsTable)
      .set({ ...fields, itemType })
      .where(and(eq(productsTable.id, id), tenantScope(session.orgId, productsTable)));
    return {} as const;
  });
  if ("error" in result) return { error: result.error };

  await logActivity(session, {
    type: "product.updated",
    description: `Updated product "${fields.name}"`,
    entityType: "product",
    entityId: id,
  });

  revalidatePath("/inventory/products");
  revalidatePath(`/inventory/products/${id}`);
  return { error: undefined };
}

export async function toggleProductActiveAction(id: number, isActive: boolean) {
  const session = await requireSession();
  await db
    .update(productsTable)
    .set({ isActive })
    .where(and(eq(productsTable.id, id), tenantScope(session.orgId, productsTable)));
  await logActivity(session, {
    type: isActive ? "product.activated" : "product.deactivated",
    description: `Marked product ${isActive ? "active" : "inactive"}`,
    entityType: "product",
    entityId: id,
  });
  revalidatePath("/inventory/products");
  revalidatePath(`/inventory/products/${id}`);
}

// ACC-01: an adjustment is a valued stock movement with its own journal entry — an increase at the
// unit cost the user enters (Dr 1200 / Cr 5000), a decrease at weighted-average cost
// (Dr 5000 / Cr 1200). It returns its refusal instead of throwing: a thrown server-action error
// reaches a production browser without its message.
export async function adjustStockAction(id: number, delta: number, reason: string, unitCost?: string): Promise<{ error?: string }> {
  const session = await requireSession();
  const [product] = await db
    .select()
    .from(productsTable)
    .where(and(eq(productsTable.id, id), tenantScope(session.orgId, productsTable)))
    .limit(1);
  if (!product) return { error: "Product not found." };

  try {
    await db.transaction((tx) =>
      adjustStock(
        tx,
        { orgId: session.orgId, userId: session.userId, baseCurrency: session.orgCurrency, date: new Date().toISOString().slice(0, 10) },
        { productId: id, delta, unitCost: delta > 0 ? parseUnitCost(unitCost) : null, reason },
      ),
    );
  } catch (e) {
    if (isInventoryRefusal(e)) return { error: refusalText(e, await getLocale()) };
    throw e;
  }
  await logActivity(session, {
    type: "stock_adjustment",
    description: `${product.name} (${product.sku}) adjusted by ${delta > 0 ? "+" : ""}${delta}: ${reason}`,
    entityType: "product",
    entityId: id,
  });
  revalidatePath(`/inventory/products/${id}`);
  revalidatePath("/inventory/products");
  revalidatePath("/finance/ledger");
  revalidatePath("/finance/reports");
  return {};
}

async function setRecordState(id: number, recordState: "active" | "archived" | "deleted", type: string, description: string) {
  const session = await requireSession();
  const result = await db
    .update(productsTable)
    .set({ recordState })
    .where(and(eq(productsTable.id, id), tenantScope(session.orgId, productsTable, { includeArchived: true, includeDeleted: true })))
    .returning({ id: productsTable.id });
  if (!result.length) return { error: "Product not found." };

  await logActivity(session, { type, description, entityType: "product", entityId: id });
  revalidatePath("/inventory/products");
  revalidatePath("/inventory/products/recycle-bin");
  revalidatePath(`/inventory/products/${id}`);
  return { error: undefined };
}

export async function archiveProductAction(id: number) {
  return setRecordState(id, "archived", "product.archived", "Archived product");
}

export async function unarchiveProductAction(id: number) {
  return setRecordState(id, "active", "product.unarchived", "Unarchived product");
}

export async function deleteProductAction(id: number) {
  return setRecordState(id, "deleted", "product.deleted", "Moved product to Recycle Bin");
}

export async function restoreProductAction(id: number) {
  return setRecordState(id, "active", "product.restored", "Restored product from Recycle Bin");
}

export async function permanentlyDeleteProductAction(id: number) {
  // Owner-only, matching the lifecycle rule for documents. A permanently-deleted client or product
  // may have posted transactions behind it, which is at least as destructive as erasing a draft.
  const session = await requireRole("owner");
  // ACC-01: a product with stock history keeps it — its movements are the audit trail behind the
  // ledger's 1200 Inventory lines, so the row they reference cannot go.
  const [history] = await db
    .select({ id: inventoryMovementsTable.id })
    .from(inventoryMovementsTable)
    .where(and(eq(inventoryMovementsTable.orgId, session.orgId), eq(inventoryMovementsTable.productId, id)))
    .limit(1);
  if (history) return { error: "This product has stock history, so it cannot be permanently deleted." };
  const result = await db
    .delete(productsTable)
    .where(and(eq(productsTable.id, id), eq(productsTable.orgId, session.orgId), eq(productsTable.recordState, "deleted")))
    .returning({ id: productsTable.id });
  if (!result.length) return { error: "Product not found in Recycle Bin." };

  await logActivity(session, {
    type: "product.permanently-deleted",
    description: "Permanently deleted product",
    entityType: "product",
    entityId: id,
  });
  revalidatePath("/inventory/products/recycle-bin");
  return { error: undefined };
}
