import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

function sourceText(root: string): string {
  return readdirSync(root)
    .flatMap((name) => {
      const path = join(root, name);
      return statSync(path).isDirectory()
        ? [sourceText(path)]
        : [".ts", ".tsx", ".js"].includes(extname(path))
          ? [readFileSync(path, "utf8")]
          : [];
    })
    .join("\n");
}

describe("browser secret boundary", () => {
  it("keeps privileged environment names out of browser and public code", () => {
    const clientSurface = [
      sourceText(resolve(process.cwd(), "src")),
      sourceText(resolve(process.cwd(), "public")),
    ].join("\n");

    for (const secretName of [
      "SUPABASE_SERVICE_ROLE_KEY",
      "STRIPE_RESTRICTED_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "MERCADO_PAGO_CLIENT_SECRET",
      "MERCADO_PAGO_WEBHOOK_SECRET",
      "WHATSAPP_ACCESS_TOKEN",
      "WHATSAPP_APP_SECRET",
    ]) {
      expect(clientSurface, `${secretName} leaked into client surface`).not.toContain(secretName);
    }
  });
});
