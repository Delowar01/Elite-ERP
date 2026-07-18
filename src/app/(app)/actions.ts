"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { revokeCurrentSession } from "@/lib/security/session-store";

export async function logoutAction() {
  const cookieStore = await cookies();
  // Revoke the server-side session row so the token can't be replayed after logout.
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    const payload = await verifySessionToken(token);
    if (payload?.jti) await revokeCurrentSession(payload.jti, "logout");
  }
  cookieStore.delete(SESSION_COOKIE);
  redirect("/login");
}
