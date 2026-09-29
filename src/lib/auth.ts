import { SignJWT, jwtVerify } from "jose";
import type { NextRequest } from "next/server";

export const SESSION_COOKIE = "policy_session";
const SESSION_DURATION_SECONDS = 60 * 60 * 12;

function getJwtSecret() {
  const serviceKey = process.env.SUPABASE_SECRET_KEY;
  if (!serviceKey || new TextEncoder().encode(serviceKey).length < 32) {
    throw new Error("SUPABASE_SECRET_KEY must contain at least 32 bytes.");
  }
  return new TextEncoder().encode(`company-policy-session:v1:${serviceKey}`);
}

export async function createSessionToken(user: { id: string; email: string }) {
  return new SignJWT({ email: user.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION_SECONDS}s`)
    .sign(getJwtSecret());
}

export async function verifySessionToken(token: string) {
  const { payload } = await jwtVerify(token, getJwtSecret(), {
    algorithms: ["HS256"],
  });
  if (!payload.sub || typeof payload.email !== "string") {
    throw new Error("Invalid session token.");
  }
  return { id: payload.sub, email: payload.email };
}

export async function getRequestUser(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  try {
    return await verifySessionToken(token);
  } catch {
    return null;
  }
}

export const sessionDurationSeconds = SESSION_DURATION_SECONDS;