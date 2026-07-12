"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, vendorsTable } from "@/db";
import { requireSession } from "@/lib/session";

export type ActionState = { error?: string } | undefined;

function readVendorFields(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  return {
    name,
    email: String(formData.get("email") ?? "").trim() || null,
    phone: String(formData.get("phone") ?? "").trim() || null,
    address: String(formData.get("address") ?? "").trim() || null,
    taxId: String(formData.get("taxId") ?? "").trim() || null,
    notes: String(formData.get("notes") ?? "").trim() || null,
  };
}

export async function createVendorAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  const fields = readVendorFields(formData);
  if (!fields.name) return { error: "Name is required." };

  const [row] = await db
    .insert(vendorsTable)
    .values({ orgId: session.orgId, ...fields })
    .returning({ id: vendorsTable.id });

  revalidatePath("/purchasing/vendors");
  redirect(`/purchasing/vendors/${row.id}`);
}

export async function updateVendorAction(id: number, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await requireSession();
  const fields = readVendorFields(formData);
  if (!fields.name) return { error: "Name is required." };

  await db
    .update(vendorsTable)
    .set(fields)
    .where(and(eq(vendorsTable.id, id), eq(vendorsTable.orgId, session.orgId)));

  revalidatePath("/purchasing/vendors");
  revalidatePath(`/purchasing/vendors/${id}`);
  return { error: undefined };
}
