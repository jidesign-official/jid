import { test, expect } from "@playwright/test";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

for (const motion of ["no-preference", "reduce"] as const) {
  test(`video hero is square on mobile, unchanged on desktop, and flows directly into projects (${motion})`, async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: motion });
    await page.goto(`${basePath}/`);
    const hero = page.getByRole("region", { name: "JiD 소개 영상" });
    const cards = page.getByRole("region", { name: "대표 프로젝트" });
    for (const viewport of [{ width: 390, height: 844 }, { width: 390, height: 1100 }, { width: 320, height: 568 }, { width: 767, height: 844 }, { width: 768, height: 844 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => window.scrollTo(0, 0));
      await expect(page.locator(".pin-spacer")).toHaveCount(0);
      await expect.poll(async () => {
        const [h, c, v, control] = await Promise.all([hero.boundingBox(), cards.boundingBox(), hero.locator("video").boundingBox(), hero.getByRole("button").boundingBox()]);
        if (!h || !c || !v || !control) return false;
        return Math.abs(c.y - h.y - h.height) <= 1
          && Math.abs(v.y - h.y) <= 1 && Math.abs(v.height - h.height) <= 1
          && control.y + control.height <= h.y + h.height;
      }).toBe(true);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      const size = await hero.boundingBox();
      if (viewport.width < 768) {
        expect(Math.abs(size!.height - size!.width)).toBeLessThanOrEqual(1);
        expect(await hero.locator("video").evaluate((el) => getComputedStyle(el).objectFit)).toBe("cover");
      } else {
        expect(size!.height).toBeCloseTo(Math.max(280, Math.min(viewport.width * 0.5625, viewport.height - 44)), 0);
      }
      await hero.screenshot({ path: testInfo.outputPath(`video-hero-${viewport.width}x${viewport.height}-${motion}.png`) });
    }
  });
}
