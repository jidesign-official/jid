import { defineConfig } from "@playwright/test";
import base from "../e2e/model-viewer.config";

export default defineConfig({
  ...base,
  testDir: ".",
  testMatch: ["models.spec.ts", "preview.spec.ts"],
  testIgnore: [],
  webServer: undefined,
});
