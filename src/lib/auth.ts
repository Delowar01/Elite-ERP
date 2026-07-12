import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";

const SESSION_COOKIE = "elite_erp_session";
const secret = () => new TextEncoder().encode(process.env.AUTH_SECRET ?? "dev-insecure-fallback-secret");

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export type SessionPayload = {
  userId: number;
  orgId: number;
};

export async function signSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (typeof payload.userId !== "number" || typeof payload.orgId !== "number") return null;
    return { userId: payload.userId, orgId: payload.orgId };
  } catch {
    return null;
  }
}

export { SESSION_COOKIE };
