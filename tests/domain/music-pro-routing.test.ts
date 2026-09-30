import { describe, expect, it } from "vitest";
import { parseProductKey } from "@/lib/product-context";
import { productBillingPath, productLoginPath } from "@/lib/product-routes";
import { systemLoginHref } from "@/lib/system-auth";

describe("MusicPro product routing", () => {
  it("recognizes its product key and keeps entry and billing routes isolated", () => {
    expect(parseProductKey("music-pro")).toBe("music-pro");
    expect(productLoginPath("music-pro")).toBe("/music-pro/entrar");
    expect(productBillingPath("music-pro")).toBe("/music-pro/regularizacao");
    expect(systemLoginHref("signup", "/onboarding", "music-pro")).toBe(
      "/music-pro/entrar?modo=cadastro&next=%2Fonboarding",
    );
  });
});
