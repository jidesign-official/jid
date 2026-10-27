import { test, expect } from "@playwright/test";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

test.describe("JiD E2E Tests", () => {
  test("Home page loads properly", async ({ page }) => {
    await page.goto(`${basePath}/`);
    await expect(page).toHaveTitle("JiD - Portfolio");
    await expect(page.locator("nav")).toBeVisible();
  });

  test("portfolio cards use equal grid gaps and reveal titles with a bounded hover treatment", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${basePath}/portfolio/`);

    const grid = page.locator("[data-portfolio-grid]");
    const card = grid.locator('a[href^="/portfolio/jd"]').first();
    const image = card.locator("img");
    const overlay = card.locator("div.absolute.inset-0");

    await expect(card).toBeVisible();
    await expect(card.locator("h3")).toHaveText(/.+/);
    await expect.poll(() => card.evaluate((element) => {
      const transform = new DOMMatrix(getComputedStyle(element).transform);
      return Math.abs(transform.m42);
    })).toBeLessThan(0.1);
    const initialState = await page.evaluate(() => {
      const grid = document.querySelector<HTMLElement>("[data-portfolio-grid]")!;
      const overlay = document.querySelector<HTMLElement>("[data-portfolio-grid] div.absolute.inset-0")!;
      return {
        columnGap: getComputedStyle(grid).columnGap,
        rowGap: getComputedStyle(grid).rowGap,
        overlayOpacity: getComputedStyle(overlay).opacity,
      };
    });
    expect(initialState.columnGap).toBe(initialState.rowGap);
    expect(initialState.overlayOpacity).toBe("0");

    const before = await card.boundingBox();
    await card.hover();
    await expect.poll(() => overlay.evaluate((element) => getComputedStyle(element).opacity)).toBe("1");
    const hoveredState = await image.evaluate((element) => ({
      scale: getComputedStyle(element).scale,
      filter: getComputedStyle(element).filter,
    }));
    expect(hoveredState.scale).toBe("1.05");
    expect(hoveredState.filter).toContain("blur");
    const after = await card.boundingBox();
    expect(after).not.toBeNull();
    expect(before).not.toBeNull();
    expect(after!.width).toBeCloseTo(before!.width, 1);
    expect(after!.height).toBeCloseTo(before!.height, 1);
  });


  test("Portfolio detail page loads and lightbox opens on image click", async ({ page }) => {
    await page.goto(`${basePath}/portfolio/jd001`);
    
    // Check main title
    await expect(page.locator("h1")).toBeVisible();

    // Check detail images
    const detailImage = page.locator("img[alt*='상세 이미지']").first();
    if (await detailImage.isVisible()) {
      await detailImage.click();
      // Lightbox modal should appear
      await expect(page.getByRole("button", { name: "닫기" })).toBeVisible();
      // Close lightbox
      await page.getByRole("button", { name: "닫기" }).click();
    }
  });

  test("Contact page renders contact form and location info", async ({ page }) => {
    await page.goto(`${basePath}/contact`);
    await expect(page.getByRole("heading", { name: "Contact Us" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "프로젝트 문의하기" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "이메일 문의" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "위치 & 운영시간" })).toBeVisible();
  });
});
