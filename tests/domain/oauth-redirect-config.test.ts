import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const config = readFileSync(join(process.cwd(), "supabase", "config.toml"), "utf8");
const callbackPatterns = Array.from(
  config.matchAll(/"(https?:\/\/[^"\s]+\/auth\/callback\*\*)"/g),
  (match) => match[1],
);

function isAllowedByLocalConfig(url: string): boolean {
  return callbackPatterns.some((pattern) => url.startsWith(pattern.slice(0, -2)));
}

describe("OAuth redirect configuration", () => {
  it.each([
    "http://localhost:3000/auth/callback?next=%2Fgestor&provider=google",
    "http://localhost:3000/auth/callback?next=%2Fonboarding&provider=google",
    "http://localhost:3000/auth/callback?next=%2Fcliente%2Fagendar&barbearia=barbearia-central&provider=google",
    "http://127.0.0.1:3000/auth/callback?next=%2Fgestor&provider=google",
    "https://losbarberos-app.vercel.app/auth/callback?next=%2Fgestor&provider=google",
  ])("allows callback with runtime query parameters: %s", (url) => {
    expect(isAllowedByLocalConfig(url)).toBe(true);
  });
});
