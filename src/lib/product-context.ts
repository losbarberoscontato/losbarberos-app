import { cookies } from "next/headers";
import type { NextResponse } from "next/server";

export type ProductKey = "los-barberos" | "le-gras";
export const PRODUCT_CONTEXT_COOKIE = "display_product";

export function parseProductKey(value: unknown): ProductKey | null {
  return value === "los-barberos" || value === "le-gras" ? value : null;
}

export async function getSelectedProductKey(): Promise<ProductKey> {
  const store = await cookies();
  return parseProductKey(store.get(PRODUCT_CONTEXT_COOKIE)?.value) ?? "los-barberos";
}

export function setProductContextCookie(response: NextResponse, productKey: ProductKey): void {
  response.cookies.set(PRODUCT_CONTEXT_COOKIE, productKey, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}
