import { test, expect } from "@playwright/test";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

test("footer keeps the logo without duplicate JiD text and uses the exact new slogan in both themes", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${basePath}/about/`);
  const footer = page.getByRole("contentinfo");
  await expect(footer.getByText("JiD", { exact: true })).toHaveCount(0);
  await expect(footer.getByText("From Imagination to Intuition", { exact: true })).toHaveCount(1);
  await expect(footer).not.toContainText("디테일과 비주얼로 전하는 최고의 디지털 경험");
  const logo = footer.getByRole("link", { name: "JiD 홈", exact: true });
  await expect(logo).toHaveAttribute("href", `${basePath}/`);
  await expect(logo.locator('img[alt="JiD"]')).toHaveCount(2);
  await expect(logo.locator('img[alt="JiD"]:visible')).toHaveCount(1);
  await page.getByRole("button", { name: "다크 모드로 전환", exact: true }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await footer.scrollIntoViewIfNeeded();
    await expect(logo.locator('img[alt="JiD"]:visible')).toHaveCount(1);
    const visible = logo.locator('img[alt="JiD"]:visible');
    await expect.poll(() => visible.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    await expect(footer.getByText("From Imagination to Intuition", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await footer.screenshot({ path: testInfo.outputPath(`footer-slogan-dark-${width}.png`) });
  }
  expect(errors).toEqual([]);
});

test("footer centers the JiD copyright and removes social links", async ({ page }, testInfo) => {
  await page.goto(`${basePath}/`, { waitUntil: "domcontentloaded" });
  const footer = page.getByRole("contentinfo");
  for (const name of ["Behance", "Dribbble", "LinkedIn", "Instagram"]) {
    await expect(footer.getByRole("link", { name, exact: true })).toHaveCount(0);
  }
  const copyright = footer.getByText(/^Copyright © \d{4} JiD\. All rights reserved\.$/);
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await footer.scrollIntoViewIfNeeded();
    await expect(copyright).toBeVisible();
    await expect.poll(async () => {
      const [f, c] = await Promise.all([footer.boundingBox(), copyright.boundingBox()]);
      return !!f && !!c && Math.abs(c.x + c.width / 2 - f.x - f.width / 2) <= 1;
    }).toBe(true);
    expect(await copyright.evaluate((el) => getComputedStyle(el).textAlign)).toBe("center");
    for (const name of ["About Us", "Portfolio", "Contact"]) {
      await expect(footer.getByRole("link", { name, exact: true })).toBeVisible();
    }
    await expect(footer.getByRole("button", { name: "페이지 맨 위로 이동" })).toBeVisible();
    await footer.screenshot({ path: testInfo.outputPath(`footer-JiD-${width}.png`) });
  }
});
