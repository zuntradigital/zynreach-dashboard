import "server-only";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME } from "./guards";

const isProduction = process.env.NODE_ENV === "production";

export async function setSessionCookie(rawToken: string, expiresAt: Date): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "strict",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);
}
