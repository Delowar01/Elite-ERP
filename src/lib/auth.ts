import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";

// __Host- prefix in production: forces Secure + Path=/ + no Domain at the browser level,
// closing subdomain/fixation tricks. Plain name in dev — __Host- cookies are rejected on http.
const SESSION_COOKIE = process.env.NODE_ENV === "production" ? "__Host-elite_erp_session" : "elite_erp_session";

// Fail fast: a missing AUTH_SECRET must never silently fall back to a known string —
// that would let anyone forge a session token for any user (security audit, High #1).
const secret = () => {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET environment variable is not set");
  return new TextEncoder().encode(value);
};

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export type SessionPayload = {
  userId: number;
  orgId: number;
  jti?: string; // server-side session id (Stage 11) — enables revocation. Optional for legacy tokens.
};

export async function signSessionToken(payload: SessionPayload): Promise<string> {
  const builder = new SignJWT({ userId: payload.userId, orgId: payload.orgId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d");
  if (payload.jti) builder.setJti(payload.jti);
  return builder.sign(secret());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (typeof payload.userId !== "number" || typeof payload.orgId !== "number") return null;
    return { userId: payload.userId, orgId: payload.orgId, jti: typeof payload.jti === "string" ? payload.jti : undefined };
  } catch {
    return null;
  }
}

// Options used to DELETE the session cookie. Must match how issueSession() sets it so the browser
// actually drops it — including the __Host- prefix's Secure + Path=/ + no-Domain requirements.
export const SESSION_COOKIE_CLEAR = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 0,
};

export { SESSION_COOKIE };
