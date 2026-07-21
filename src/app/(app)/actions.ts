"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, SESSION_COOKIE_CLEAR, verifySessionToken } from "@/lib/auth";
import { revokeCurrentSession } from "@/lib/security/session-store";

// Idempotent: safe to call with no session (a second logout just clears + redirects again).
export async function logoutAction() {
  const cookieStore = await cookies();
  // Revoke the server-side session row so the token can't be replayed after logout.
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    const payload = await verifySessionToken(token);
    if (payload?.jti) await revokeCurrentSession(payload.jti, "logout");
  }
  // Explicit Max-Age=0 with the SAME attributes issueSession() used, so the __Host- cookie is
  // actually dropped by the browser (a bare delete() may omit Secure and silently no-op).
  cookieStore.set(SESSION_COOKIE, "", SESSION_COOKIE_CLEAR);
  redirect("/login");
}
