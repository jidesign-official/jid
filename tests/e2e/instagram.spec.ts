import { test, expect } from "@playwright/test";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const instagram = "https://www.instagram.com/jidesign.official";

test("header Instagram icon uses the exact requested profile URL in a protected new tab", async ({ page }) => {
  await page.goto(`${basePath}/`);
  const link = page.getByRole("link", { name: "Instagram", exact: true });
  await expect(link).toHaveCount(1);
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", instagram);
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", /\bnoreferrer\b/);
  await expect(link.locator("svg")).toHaveCount(1);
});

test("clicking Instagram opens the requested profile without contacting the external service", async ({ context, page }) => {
  let requested = "";
  await context.route("https://www.instagram.com/**", (route) => {
    requested = route.request().url();
    return route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>External navigation test</title>" });
  });
  await page.goto(`${basePath}/`);
  const opened = context.waitForEvent("page");
  await page.getByRole("link", { name: "Instagram", exact: true }).click();
  const popup = await opened;
  await expect(popup).toHaveURL(instagram);
  expect(requested).toBe(instagram);
  await popup.close();
});
