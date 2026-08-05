import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "client-connected.spec.ts",
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3112",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm.cmd run dev -- --port 3112",
    url: "http://localhost:3112",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }],
});
