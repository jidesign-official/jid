import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { AdminProject } from "../../src/lib/admin/types";

const prefix = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
type Probe = {
  requested: boolean;
  draws: number;
  pixels: number;
  colors: number;
  edgePixels: number;
  width: number;
  height: number;
};

for (const [index, originalFile] of [
  "jd019_b_web.glb",
  "jd017_e_web.glb",
].entries()) {
  test(`CMS generated model ${index + 1} renders the exact original GLB through the production loader`, async ({
    page,
  }, testInfo) => {
    const project = (
      JSON.parse(fs.readFileSync(".generated/admin-projects.json", "utf8")) as {
        projects: AdminProject[];
      }
    ).projects.find((p) => p.id === "jd997")!;
    expect(project.models).toHaveLength(2);
    const assetUrl = new URL(
      `${prefix}${project.models[index]}`,
      testInfo.project.use.baseURL,
    ).href;
    const original = fs.readFileSync(
      path.join("public/images/glb", originalFile),
    );
    const errors: string[] = [];
    const requests: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (/\.glb(?:\?|$)/i.test(request.url())) requests.push(request.url());
    });
    await page.addInitScript(() => {
      const probe: Probe = {
        requested: false,
        draws: 0,
        pixels: 0,
        colors: 0,
        edgePixels: 0,
        width: 0,
        height: 0,
      };
      Object.assign(window, { cmsProbe: probe, cmsTarget: null });
      const draw = WebGL2RenderingContext.prototype.drawElements;
      WebGL2RenderingContext.prototype.drawElements = function (...args) {
        draw.apply(this, args);
        if (
          this.canvas !==
          (window as unknown as { cmsTarget: HTMLCanvasElement | null })
            .cmsTarget
        )
          return;
        probe.draws++;
        if (!probe.requested) return;
        probe.requested = false;
        queueMicrotask(() => {
          const width = this.drawingBufferWidth,
            height = this.drawingBufferHeight;
          const rgba = new Uint8Array(width * height * 4);
          this.readPixels(
            0,
            0,
            width,
            height,
            this.RGBA,
            this.UNSIGNED_BYTE,
            rgba,
          );
          let pixels = 0,
            edgePixels = 0;
          const colors = new Set<number>();
          for (let offset = 0; offset < rgba.length; offset += 4) {
            if (!rgba[offset + 3]) continue;
            pixels++;
            const x = (offset / 4) % width,
              y = Math.floor(offset / 4 / width);
            if (x < 3 || x > width - 4 || y < 3 || y > height - 4) edgePixels++;
            colors.add(
              (rgba[offset] << 16) | (rgba[offset + 1] << 8) | rgba[offset + 2],
            );
          }
          Object.assign(probe, {
            width,
            height,
            pixels,
            colors: colors.size,
            edgePixels,
          });
        });
      };
    });
    const network = await page.context().newCDPSession(page);
    await network.send("Network.enable", {
      maxTotalBufferSize: 128 * 1024 * 1024,
      maxResourceBufferSize: 64 * 1024 * 1024,
    });
    let requestId: string | undefined;
    network.on("Network.responseReceived", (event) => {
      if (event.response.url === assetUrl) requestId = event.requestId;
    });
    const sameLoaderBytes = new Promise<Buffer>((resolve, reject) =>
      network.on("Network.loadingFinished", (event) => {
        if (event.requestId !== requestId) return;
        void network
          .send("Network.getResponseBody", { requestId: event.requestId })
          .then(
            (result) =>
              resolve(
                Buffer.from(
                  result.body,
                  result.base64Encoded ? "base64" : "utf8",
                ),
              ),
            reject,
          );
      }),
    ).then(
      (bytes) => ({ bytes, error: null }),
      (error) => ({ bytes: Buffer.alloc(0), error: String(error) }),
    );
    await page.goto(`${prefix}/portfolio/jd997/`);
    const viewers = page.getByRole("region", { name: /3D 모델$/ });
    await expect(viewers).toHaveCount(2);
    const region = viewers.nth(index);
    await region.scrollIntoViewIfNeeded();
    await expect(region).toHaveAttribute("data-state", "ready", {
      timeout: 100_000,
    });
    const captured = await sameLoaderBytes;
    expect(captured.error).toBeNull();
    expect(captured.bytes).toEqual(original);
    await network.detach();
    const canvas = region.locator("canvas");
    await canvas.evaluate((element) => {
      Object.assign(window, { cmsTarget: element });
      (window as unknown as { cmsProbe: Probe }).cmsProbe.requested = true;
    });
    await expect
      .poll(
        () =>
          page.evaluate(
            () => (window as unknown as { cmsProbe: Probe }).cmsProbe.pixels,
          ),
        { timeout: 20000 },
      )
      .toBeGreaterThan(500);
    const probe = await page.evaluate(
      () => (window as unknown as { cmsProbe: Probe }).cmsProbe,
    );
    expect(probe.draws).toBeGreaterThan(0);
    expect(probe.colors).toBeGreaterThan(20);
    expect(probe.edgePixels).toBe(0);
    expect(errors).toEqual([]);
    expect(requests.filter((url) => url === assetUrl)).toHaveLength(1);
    const allowed = project.models.map(
      (url) => new URL(`${prefix}${url}`, testInfo.project.use.baseURL).href,
    );
    expect(requests.every((url) => allowed.includes(url))).toBe(true);
    await region.getByRole("button", { name: /자동 회전/ }).click();
    await expect(
      region.getByRole("button", { name: /자동 회전/ }),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(
      viewers
        .nth(index === 0 ? 1 : 0)
        .getByRole("button", { name: /자동 회전/ }),
    ).toHaveAttribute("aria-pressed", "true");
    const screenshotPath = testInfo.outputPath(`cms-${index + 1}-rendered.png`);
    await canvas.screenshot({ path: screenshotPath });
    fs.writeFileSync(
      testInfo.outputPath(`cms-${index + 1}-evidence.json`),
      JSON.stringify(
        {
          projectId: project.id,
          index,
          originalFile,
          assetUrl,
          sha256: createHash("sha256").update(original).digest("hex"),
          sameLoaderBytesVerified: true,
          probe,
          requests,
          errors,
          screenshotPath,
        },
        null,
        2,
      ),
    );
  });
}
