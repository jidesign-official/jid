import { ADMIN_PAGE_PATH } from "../helpers/admin-route";
import { test, expect } from "@playwright/test";
import { getAssetPath } from "../../src/lib/basePath";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

test("local browser preview blob URLs are preserved without turning them into network paths", () => {
  const source = "blob:https://jid.kr/00000000-0000-4000-8000-000000000001";
  expect(getAssetPath(source)).toBe(source);
  expect(getAssetPath("/images/home/intro.webm")).toBe(
    `${basePath}/images/home/intro.webm`,
  );
  expect(getAssetPath("https://example.com/image.png")).toBe(
    "https://example.com/image.png",
  );
});

test("admin is explicitly public, noindex and uses GitHub instead of collecting credentials", async ({
  page,
}) => {
  const response = await page.goto(ADMIN_PAGE_PATH);
  expect(response?.status()).toBe(200);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    /noindex/,
  );
  await expect(page.locator("[data-admin-shell]")).toHaveCount(1);
  await expect(
    page
      .locator("header")
      .filter({
        has: page.getByRole("navigation", { name: "Global Navigation" }),
      }),
  ).toHaveCount(0);
  await expect(page.locator("footer")).toHaveCount(0);
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.locator("body")).toContainText(/공개/);
  await expect(page.locator("body")).toContainText(/GitHub/);
});

test("the public website keeps its existing global navigation and footer", async ({
  page,
}) => {
  await page.goto(`${basePath}/about/`);
  await expect(
    page.getByRole("navigation", { name: "Global Navigation" }),
  ).toHaveCount(1);
  await expect(page.locator("footer")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "From Imagination to Intuition",
  );
});
