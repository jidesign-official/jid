import { defineConfig } from "@playwright/test";
import path from "node:path";
import os from "node:os";

const qa = process.env.ABOUT_CONTENT_QA_ROOT || path.join(os.tmpdir(), "jid-about-content");

// Functional Node tests only: no browser fixtures, web server, or build.
export default defineConfig({
  testDir: __dirname,
  testMatch: "content.spec.ts",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["json", { outputFile: path.join(qa, "results.json") }]],
  outputDir: path.join(qa, "artifacts"),
});
