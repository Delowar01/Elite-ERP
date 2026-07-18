"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { usersTable, orgsTable } from "@/db/schema";
import { hashPassword, verifyPassword, signSessionToken, SESSION_COOKIE } from "@/lib/auth";
import { checkLoginRateLimit, clearLoginRateLimit } from "@/lib/rate-limit";
import { seedOrgDefaults } from "@/lib/seed-org";

const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export type ActionState = { error?: string } | undefined;

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) return { error: "Email and password are required." };

  // Rate-limit before touching the database: 5 attempts per email per 15 minutes
  // (security audit, Medium #4). A successful login clears the counter.
  const waitMinutes = checkLoginRateLimit(email);
  if (waitMinutes !== null) {
    return { error: `Too many login attempts. Try again in ${waitMinutes} min.` };
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (!user || !user.isActive) return { error: "Invalid email or password." };

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) return { error: "Invalid email or password." };
  clearLoginRateLimit(email);

  await db.update(usersTable).set({ lastLoginAt: new Date() }).where(eq(usersTable.id, user.id));

  const token = await signSessionToken({ userId: user.id, orgId: user.orgId });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });

  redirect("/dashboard");
}

export async function registerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const orgName = String(formData.get("orgName") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!orgName || !name || !email || !password) return { error: "All fields are required." };
  if (password.length < 8) return { error: "Password must be at least 8 characters." };

  const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (existing) return { error: "An account with this email already exists." };

  const passwordHash = await hashPassword(password);

  const { userId, orgId } = await db.transaction(async (tx) => {
    const [org] = await tx.insert(orgsTable).values({ name: orgName }).returning();
    const [user] = await tx
      .insert(usersTable)
      .values({ orgId: org.id, email, passwordHash, name, role: "owner" })
      .returning();
    await seedOrgDefaults(tx, org.id);
    return { userId: user.id, orgId: org.id };
  });

  const token = await signSessionToken({ userId, orgId });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });

  redirect("/dashboard");
}
