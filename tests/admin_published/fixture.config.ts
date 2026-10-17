import { defineConfig } from "@playwright/test";
import base from "../../playwright.config";

// Run only after importing test-only jd996/jd997 packages. Never publish them.
export default defineConfig({
  ...base,
  testDir: ".",
  testMatch: "published.spec.ts",
  testIgnore: [],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  reporter: "list",
  webServer: undefined,
});
