import { defineConfig } from "@playwright/test";
import path from "node:path";

const qa = process.env.PORTFOLIO_SETTINGS_QA_ROOT || path.join(process.env.RUNNER_TEMP || process.env.TMPDIR || path.resolve(__dirname, "../../test-results"), "portfolio-settings");

export default defineConfig({
  testDir: __dirname,
  testMatch: "settings.spec.ts",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["json", { outputFile: path.join(qa, "backend-latest.json") }]],
  outputDir: path.join(qa, "backend-test-results"),
});
