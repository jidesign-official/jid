import { test, expect } from "@playwright/test";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const title = "Wireless Stethoscope_UNC";
const projectIds = ["jd004_a", "jd004_b"];

for (const id of projectIds) {
  test(`${id}: renamed title reaches the detail heading, browser metadata and original thumbnail`, async ({ page }) => {
    await page.goto(`${basePath}/portfolio/${id}/`);
    await expect(page.getByRole("heading", { level: 1, name: title, exact: true })).toHaveCount(1);
    await expect(page).toHaveTitle(`${title} - JiD`);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content", `${title} 제품 디자인 포트폴리오 상세 페이지입니다.`,
    );
    const thumbnail = page.locator(`img[src="${basePath}/images/portfolio/${id}/${id}_thumbs.png"]`);
    await expect(thumbnail).toHaveCount(1);
    await expect(thumbnail).toHaveAttribute("alt", title);
    await expect(page.getByRole("link", { name: "포트폴리오 목록으로 돌아가기", exact: false })).toHaveAttribute("href", `${basePath}/portfolio/`);
  });
}

test("both renamed list cards keep their original detail routes and thumbnail paths", async ({ page }) => {
  await page.goto(`${basePath}/portfolio/`);
  const found = new Set<string>();
  for (let pageNumber = 1; pageNumber <= 4; pageNumber++) {
    for (const id of projectIds) {
      const link = page.locator(`a[href="${basePath}/portfolio/${id}/"]`);
      if (await link.count() === 0) continue;
      await expect(link).toHaveCount(1);
      await expect(link.getByRole("heading", { name: title, exact: true })).toHaveCount(1);
      await expect(link).toHaveAccessibleName(`${title} ${title}`);
      await expect(link.getByRole("img", { name: title, exact: true })).toHaveAttribute(
        "src", `${basePath}/images/portfolio/${id}/${id}_thumbs.png`,
      );
      await expect(link).not.toContainText("UNC-디지털체중계");
      found.add(id);
    }
    if (pageNumber === 4) break;
    const firstCard = page.locator(`a[href^="${basePath}/portfolio/jd"]`).first();
    const previousHref = await firstCard.getAttribute("href");
    await page.getByRole("button", { name: String(pageNumber + 1), exact: true }).click();
    await expect(firstCard).not.toHaveAttribute("href", previousHref!);
  }
  expect([...found].sort()).toEqual(projectIds);
  await expect(page.locator(`a[href="${basePath}/portfolio/jd004/"], a[href="${basePath}/portfolio/jd004"]`)).toHaveCount(0);
});
