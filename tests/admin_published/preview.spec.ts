import { ADMIN_PAGE_PATH } from "../helpers/admin-route";
import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { createHash } from "node:crypto";


test("offline GLB previews have distinct names and render both exact original Blob models", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Object.assign(window, {
      cmsPreviewDraws: new Map<HTMLCanvasElement, number>(),
      cmsBlobHashes: [],
    });
    const draw = WebGL2RenderingContext.prototype.drawElements;
    WebGL2RenderingContext.prototype.drawElements = function (...args) {
      draw.apply(this, args);
      const counts = (
        window as unknown as { cmsPreviewDraws: Map<HTMLCanvasElement, number> }
      ).cmsPreviewDraws;
      counts.set(
        this.canvas as HTMLCanvasElement,
        (counts.get(this.canvas as HTMLCanvasElement) ?? 0) + 1,
      );
    };
    const fetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await fetch(...args);
      const input = args[0];
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.startsWith("blob:"))
        void response
          .clone()
          .arrayBuffer()
          .then(async (bytes) => {
            if (new TextDecoder().decode(bytes.slice(0, 4)) !== "glTF") return;
            const digest = await crypto.subtle.digest("SHA-256", bytes);
            (
              window as unknown as { cmsBlobHashes: string[] }
            ).cmsBlobHashes.push(
              Array.from(new Uint8Array(digest))
                .map((v) => v.toString(16).padStart(2, "0"))
                .join(""),
            );
          });
      return response;
    };
  });
  await page.goto(ADMIN_PAGE_PATH);
  await page
    .getByLabel("프로젝트 ZIP 가져오기")
    .setInputFiles(path.join(process.cwd(), "admin-submissions/jd997.zip"));
  await expect(page.getByRole("status")).toContainText("ZIP을 가져왔습니다");
  await page.getByRole("button", { name: /전체 미리보기/ }).click();
  const preview = page.getByRole("region", { name: "프로젝트 미리보기" });
  const viewers = preview.getByRole("region", { name: /3D 모델$/ });
  await expect(viewers).toHaveCount(2);
  const names = await viewers.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("aria-label")),
  );
  expect(new Set(names).size).toBe(2);
  for (let index = 0; index < 2; index++) {
    const viewer = viewers.nth(index);
    await viewer.scrollIntoViewIfNeeded();
    await expect(viewer).toHaveAttribute("data-state", "ready", {
      timeout: 100000,
    });
    const canvas = viewer.locator("canvas");
    await expect
      .poll(() =>
        canvas.evaluate(
          (node) =>
            (
              window as unknown as {
                cmsPreviewDraws: Map<HTMLCanvasElement, number>;
              }
            ).cmsPreviewDraws.get(node as HTMLCanvasElement) ?? 0,
        ),
      )
      .toBeGreaterThan(0);
    await canvas.screenshot({
      path: testInfo.outputPath(`blob-preview-${index + 1}.png`),
    });
  }
  const expected = ["jd017_e_web.glb", "jd019_b_web.glb"]
    .map((file) =>
      createHash("sha256")
        .update(fs.readFileSync(path.join("public/images/glb", file)))
        .digest("hex"),
    )
    .sort();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { cmsBlobHashes: string[] }).cmsBlobHashes.sort(),
      ),
    )
    .toEqual(expected);
  expect(errors).toEqual([]);
});
