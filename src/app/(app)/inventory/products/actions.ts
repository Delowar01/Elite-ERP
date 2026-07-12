"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, productsTable, activityLogsTable } from "@/db";
import { requireSession } from "@/lib/session";

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

  revalidatePath("/inventory/products");
  redirect(`/inventory/products/${row.id}`);
}

export async function updateProductAction(id: number, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  const fields = readProductFields(formData);
  if (!fields.sku || !fields.name) return { error: "SKU and name are required." };

  await db
    .update(productsTable)
    .set(fields)
    .where(and(eq(productsTable.id, id), eq(productsTable.orgId, session.orgId)));

  revalidatePath("/inventory/products");
  revalidatePath(`/inventory/products/${id}`);
  return { error: undefined };
}

export async function adjustStockAction(id: number, delta: number, reason: string) {
  const session = await requireSession();
  const [product] = await db
    .select()
    .from(productsTable)
    .where(and(eq(productsTable.id, id), eq(productsTable.orgId, session.orgId)))
    .limit(1);
  if (!product) throw new Error("Product not found");

  const newQty = product.quantityOnHand + delta;
  if (newQty < 0) throw new Error("Stock cannot go negative");

  await db.update(productsTable).set({ quantityOnHand: newQty }).where(eq(productsTable.id, id));
  await db.insert(activityLogsTable).values({
    orgId: session.orgId,
    type: "stock_adjustment",
    description: `${product.name} (${product.sku}) adjusted by ${delta > 0 ? "+" : ""}${delta}: ${reason}`,
    userId: session.userId,
    userName: session.name,
  });
  revalidatePath(`/inventory/products/${id}`);
  revalidatePath("/inventory/products");
}
