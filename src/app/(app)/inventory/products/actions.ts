"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, productsTable } from "@/db";
import { requireSession, requireRole } from "@/lib/session";
import { tenantScope } from "@/lib/tenant";
import { logActivity } from "@/lib/activity";

export type ActionState = { error?: string } | undefined;

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

  const quantityOnHand = Number(formData.get("quantityOnHand") ?? 0);
  const [row] = await db
    .insert(productsTable)
    .values({ orgId: session.orgId, ...fields, quantityOnHand })
    .returning({ id: productsTable.id });

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

  const result = await db
    .update(productsTable)
    .set(fields)
    .where(and(eq(productsTable.id, id), tenantScope(session.orgId, productsTable)))
    .returning({ id: productsTable.id });
  if (!result.length) return { error: "Product not found." };

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

export async function adjustStockAction(id: number, delta: number, reason: string) {
  const session = await requireSession();
  const [product] = await db
    .select()
    .from(productsTable)
    .where(and(eq(productsTable.id, id), tenantScope(session.orgId, productsTable)))
    .limit(1);
  if (!product) throw new Error("Product not found");

  const newQty = product.quantityOnHand + delta;
  if (newQty < 0) throw new Error("Stock cannot go negative");

  await db.update(productsTable).set({ quantityOnHand: newQty }).where(eq(productsTable.id, id));
  await logActivity(session, {
    type: "stock_adjustment",
    description: `${product.name} (${product.sku}) adjusted by ${delta > 0 ? "+" : ""}${delta}: ${reason}`,
    entityType: "product",
    entityId: id,
  });
  revalidatePath(`/inventory/products/${id}`);
  revalidatePath("/inventory/products");
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
  const session = await requireRole("owner", "admin");
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
