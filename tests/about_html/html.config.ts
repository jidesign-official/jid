import { defineConfig } from "@playwright/test";
import path from "node:path";

const qa = process.env.ABOUT_HTML_QA_ROOT || path.join(process.env.TMPDIR || process.cwd(), "jid-about-html-node");

// Functional Node tests only: no browser, server, build or shared artifacts.
export default defineConfig({
  testDir: __dirname,
  testMatch: "html.spec.ts",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["json", { outputFile: path.join(qa, "results.json") }]],
  outputDir: path.join(qa, "artifacts"),
});