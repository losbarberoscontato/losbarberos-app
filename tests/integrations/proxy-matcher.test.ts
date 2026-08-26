import { describe, expect, it } from "vitest";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config } from "@/proxy";

describe("matcher do proxy", () => {
  it.each([
    "/_next/static/chunk.js",
    "/_next/image?url=%2Flogo.png&w=64&q=75",
    "/_next/webpack-hmr",
    "/__nextjs_original-stack-frames",
  ])("ignora endpoint interno %s", (url) => {
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url })).toBe(false);
  });

  it.each(["/", "/entrar", "/gestor", "/cliente/agendar"])(
    "mantém rota de aplicação %s coberta",
    (url) => {
      expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url })).toBe(true);
    },
  );
});
