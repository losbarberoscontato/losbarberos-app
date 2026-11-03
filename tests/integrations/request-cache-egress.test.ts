// @vitest-environment node
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, it } from "vitest";

it("RSC real deduplica leitura sem misturar requests, produtos, logout ou permissões", async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ["--conditions=react-server", "scripts/verify-egress-request-cache.mjs"], { timeout: 30_000 });
  const result = JSON.parse(stdout.trim());
  expect(result).toMatchObject({ sdkReadsWithoutMemo: 18, sdkReadsWithMemo: 6, crossRequestIsolation: "passed", products: 4, logoutAndPermissions: "passed" });
}, 40_000);
