import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { readPackage } from "../../src/lib/admin/package";
import legacy from "../../public/images/portfolio/portfolio_data.json";

const prefix = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const fixtures = ["jd996", "jd997"];

for (const [index, id] of fixtures.entries()) {
  test(`real uploaded ${id} static route preserves shared cover, escaped body, row order and optional models`, async ({
    page,
    request,
  }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const zip = await fs.readFile(
      path.join(process.cwd(), "admin-submissions", `${id}.zip`),
    );
    const data = await readPackage(new File([zip], `${id}.zip`));
    const response = await page.goto(`${prefix}/portfolio/${id}/`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      data.manifest.project.title,
    );
    const image = page.getByRole("img", {
      name: data.manifest.project.title,
      exact: true,
    });
    await expect(image).toBeVisible();
    await expect
      .poll(() =>
        image.evaluate(
          (node: HTMLImageElement) => node.complete && node.naturalWidth > 0,
        ),
      )
      .toBe(true);
    const imageUrl = (await image.getAttribute("src"))!;
    const thumbnailAsset = data.manifest.assets.find(
      (a) => a.id === data.manifest.project.thumbnail,
    )!;
    const imageResponse = await request.get(imageUrl);
    expect(imageResponse.status()).toBe(200);
    expect(await imageResponse.body()).toEqual(
      Buffer.from(await data.files.get(thumbnailAsset.id)!.arrayBuffer()),
    );
    const box = (await image.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(1024);
    expect(Math.abs(box.width - box.height)).toBeLessThan(1);
    const imageBlocks = page.locator('[data-columns="2"]');
    await expect(imageBlocks).toHaveCount(1);
    const images = imageBlocks.locator("figure img");
    await expect(images).toHaveCount(2);
    expect(
      await images.evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("alt")),
      ),
    ).toEqual(["Second CMS image", "First CMS image"]);
    await expect(imageBlocks.locator("figcaption")).toHaveText([
      "Second caption",
      "First caption",
    ]);
    for (const entry of await images.all()) {
      await entry.scrollIntoViewIfNeeded();
      await expect
        .poll(() =>
          entry.evaluate(
            (node: HTMLImageElement) => node.complete && node.naturalWidth > 0,
          ),
        )
        .toBe(true);
      await expect(entry).toHaveCSS("object-fit", "contain");
    }
    const positions = await images.evaluateAll((nodes) =>
      nodes.map((node) => {
        const r = node.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width };
      }),
    );
    if (Number(testInfo.project.use.viewport?.width) >= 768) {
      expect(Math.abs(positions[0].y - positions[1].y)).toBeLessThan(1);
      expect(positions[1].x).toBeGreaterThan(positions[0].x + positions[0].w);
    } else {
      expect(Math.abs(positions[0].x - positions[1].x)).toBeLessThan(1);
      expect(positions[1].y).toBeGreaterThan(positions[0].y);
    }
    await expect(
      page.getByText(
        "First line\nSecond line <script>window.cmsInjected=true</script>",
        { exact: true },
      ),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => (window as Window & { cmsInjected?: boolean }).cmsInjected,
      ),
    ).toBeUndefined();
    await expect(page.getByRole("region", { name: /3D 모델$/ })).toHaveCount(
      index === 1 ? 2 : 0,
    );
    if (!index) {
      await expect(page.locator("canvas")).toHaveCount(0);
      await expect(page.getByRole("heading", { name: /3D/ })).toHaveCount(0);
    }
    const originalWidth = await page.evaluate(() => window.innerWidth);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await image.scrollIntoViewIfNeeded();
    await expect
      .poll(async () => (await image.boundingBox())!.width)
      .toBe(1024);
    await page.setViewportSize({ width: originalWidth, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await expect(
      page.getByRole("link", { name: /프로젝트 문의하기/ }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test("combined catalog lists all protected69 and both packages, with the same cover source and UX/UI filter", async ({
  page,
}) => {
  await page.goto(`${prefix}/portfolio/`);
  await expect(
    page.getByRole("button", { name: "모든 프로젝트 (71)", exact: true }),
  ).toBeVisible();
  const cards = page.locator(`section a[href^="${prefix}/portfolio/jd"]`);
  const seen: string[] = [];
  for (let number = 0; number < 4; number++) {
    await expect(cards).toHaveCount(number === 3 ? 11 : 20);
    seen.push(
      ...(await cards.evaluateAll((nodes) =>
        nodes.map(
          (node) =>
            node.getAttribute("href")!.split("/").filter(Boolean).at(-1)!,
        ),
      )),
    );
    if (number < 3)
      await page.getByRole("button", { name: "다음", exact: true }).click();
  }
  expect([...seen].sort()).toEqual(
    [...legacy.map((project) => project.id), ...fixtures].sort(),
  );
  expect(new Set(seen).size).toBe(71);
  await page.getByRole("button", { name: "UX/UI (1)", exact: true }).click();
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toHaveAttribute(
    "href",
    `${prefix}/portfolio/jd996/`,
  );
  const source = await cards.first().locator("img").getAttribute("src");
  await cards.first().click();
  await expect(
    page.getByRole("img", {
      name: "CMS QA ONLY jd996 — not for publication",
      exact: true,
    }),
  ).toHaveAttribute("src", source!);
});
