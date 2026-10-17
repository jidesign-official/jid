import { ADMIN_PAGE_PATH } from "../helpers/admin-route";
import { test, expect } from "@playwright/test";
import { zipSync, strToU8 } from "fflate";
import { readFile } from "node:fs/promises";
import {
  createPackage,
  inspectAsset,
  readPackage,
} from "../../src/lib/admin/package";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==",
  "base64",
);
test("public editor requires a real cover and supports ordered multi-image blocks, draft and ZIP", async ({
  page,
}, testInfo) => {
  await page.goto(ADMIN_PAGE_PATH);
  await expect(page.getByText("공개 편집기", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "ZIP 내보내기", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("프로젝트 ID", { exact: true }).fill("jd046");
  await page
    .getByLabel("프로젝트 제목", { exact: true })
    .fill("공개 편집기 테스트");
  await page
    .getByLabel("대표 이미지 업로드")
    .setInputFiles({ name: "cover.png", mimeType: "image/png", buffer: png });
  await page
    .getByRole("button", { name: "이미지 블록 추가", exact: true })
    .click();
  await page.getByLabel("블록 이미지 업로드").setInputFiles([
    { name: "one.png", mimeType: "image/png", buffer: png },
    { name: "two.png", mimeType: "image/png", buffer: png },
  ]);
  await expect(page.getByLabel("이미지 1 대체 텍스트")).toBeVisible();
  await page.getByLabel("이미지 1 대체 텍스트").fill("첫 번째 제품");
  await page.getByLabel("블록 1 열 수").selectOption("3");
  await page.getByRole("button", { name: "이미지 2 위로" }).click();
  await expect(page.getByLabel("이미지 2 대체 텍스트")).toHaveValue(
    "첫 번째 제품",
  );
  await page.getByRole("button", { name: "초안 저장", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("저장");
  await page.reload();
  await page
    .getByRole("button", { name: /초안 불러오기/ })
    .first()
    .click();
  await expect(page.getByLabel("프로젝트 제목", { exact: true })).toHaveValue(
    "공개 편집기 테스트",
  );
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "ZIP 내보내기", exact: true }).click();
  const exported = await download;
  expect(exported.suggestedFilename()).toBe("jd046.zip");
  const packageBytes = await readFile((await exported.path())!);
  const restored = await readPackage(new File([packageBytes], "jd046.zip"));
  expect(restored.manifest.blocks[0]).toMatchObject({
    type: "images",
    columns: 3,
    images: [{ alt: "" }, { alt: "첫 번째 제품" }],
  });
  expect(restored.manifest.assets).toHaveLength(3);
  if (process.env.ADMIN_QA_DIR)
    await exported.saveAs(
      `${process.env.ADMIN_QA_DIR}/editor-jd046-${testInfo.project.name.replace(/\W/g, "-")}.zip`,
    );
  await page.getByRole("button", { name: "게시 안내", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "GitHub에 ZIP 업로드" }),
  ).toHaveAttribute(
    "href",
    "https://github.com/jidesign-official/jid/upload/main/admin-submissions",
  );
});
for (const blockId of ["cover", "models"]) {
  test(`imported image block ID ${blockId} uploads to the block, never the cover or models`, async ({
    page,
  }) => {
    const { asset, blob } = await inspectAsset(
      new File([png], "original.png"),
      "original",
    );
    const manifest = {
      schemaVersion: 1 as const,
      project: {
        id: "jd046",
        title: "Upload target regression",
        category: "Product" as const,
        thumbnail: asset.id,
      },
      blocks: [
        {
          id: blockId,
          type: "images" as const,
          columns: 1 as const,
          images: [{ assetId: asset.id, alt: "Original image", caption: "" }],
        },
      ],
      models: [],
      assets: [asset],
    };
    const archive = await createPackage(manifest, new Map([[asset.id, blob]]));
    await page.goto(ADMIN_PAGE_PATH);
    await page.getByLabel("프로젝트 ZIP 가져오기").setInputFiles({
      name: "jd046.zip",
      mimeType: "application/zip",
      buffer: Buffer.from(await archive.arrayBuffer()),
    });
    await expect(page.getByLabel("프로젝트 제목", { exact: true })).toHaveValue(
      manifest.project.title,
    );
    const cover = page.getByAltText("프로젝트 대표 이미지 미리보기", {
      exact: true,
    });
    await expect(cover).toHaveAttribute("src", /^blob:/);
    const coverUrl = await cover.getAttribute("src");
    await page
      .getByLabel("블록 이미지 업로드")
      .setInputFiles({ name: "added.png", mimeType: "image/png", buffer: png });
    await expect(page.getByLabel("이미지 2 대체 텍스트")).toBeVisible();
    await expect(cover).toHaveAttribute("src", coverUrl!);
    await expect(
      page.locator("[data-admin-shell]").getByRole("alert"),
    ).toHaveCount(0);
    const download = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "ZIP 내보내기", exact: true })
      .click();
    const restored = await readPackage(
      new File([await readFile((await (await download).path())!)], "jd046.zip"),
    );
    expect(restored.manifest.project.thumbnail).toBe(asset.id);
    expect(restored.manifest.models).toEqual([]);
    expect(restored.manifest.blocks[0]).toMatchObject({
      id: blockId,
      images: [{ assetId: asset.id }, { alt: "" }],
    });
  });
}

test("editor muted text meets AA on all gallery surfaces and stays light under dark preference", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(ADMIN_PAGE_PATH);
  const contrast = await page
    .locator("[data-admin-shell]")
    .evaluate((shell) => {
      const probe = document.createElement("span");
      shell.appendChild(probe);
      const rgb = (token: string) => {
        probe.style.color = `var(${token})`;
        return getComputedStyle(probe)
          .color.match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number);
      };
      const luminance = (rgb: number[]) =>
        rgb
          .map((value) => {
            const channel = value / 255;
            return channel <= 0.04045
              ? channel / 12.92
              : ((channel + 0.055) / 1.055) ** 2.4;
          })
          .reduce(
            (sum, channel, i) => sum + channel * [0.2126, 0.7152, 0.0722][i],
            0,
          );
      const muted = luminance(rgb("--muted"));
      const ratios = ["--bg", "--surface", "--stage"].map((token) => {
        const background = luminance(rgb(token));
        return (
          (Math.max(muted, background) + 0.05) /
          (Math.min(muted, background) + 0.05)
        );
      });
      probe.remove();
      return ratios;
    });
  for (const ratio of contrast) expect(ratio).toBeGreaterThanOrEqual(4.5);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect
    .poll(() =>
      page
        .locator("[data-admin-shell]")
        .evaluate((shell) =>
          getComputedStyle(shell).getPropertyValue("--muted").trim(),
        ),
    )
    .toBe("#707070");
  await expect(page.locator("[data-admin-shell]")).toHaveCSS("color-scheme", "light");
  await expect(page.locator("[data-admin-shell]")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("account links are GitHub authorization, not local authentication", async ({
  page,
}) => {
  await page.goto(ADMIN_PAGE_PATH);
  await page.getByRole("button", { name: "계정 · 권한", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "GitHub 로그인" }),
  ).toHaveAttribute("href", /github.com\/login/);
  await expect(
    page.getByRole("heading", {
      name: "저장소 전체 쓰기 권한에 주의하세요",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator("input[type=password]")).toHaveCount(0);
});
test("reject corrupt upload and responsive page stays in viewport", async ({
  page,
}) => {
  await page.goto(ADMIN_PAGE_PATH);
  await page.getByLabel("대표 이미지 업로드").setInputFiles({
    name: "fake.png",
    mimeType: "image/png",
    buffer: Buffer.from("not png"),
  });
  await expect(
    page.locator("[data-admin-shell]").getByRole("alert"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "ZIP 내보내기", exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
// A malformed archive must never become a plausible empty project in the editor.
test("invalid ZIP reports a useful error", async ({ page }) => {
  await page.goto(ADMIN_PAGE_PATH);
  await page.getByLabel("프로젝트 ZIP 가져오기").setInputFiles({
    name: "jd046.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(zipSync({ "project.json": strToU8("{}") })),
  });
  await expect(
    page.locator("[data-admin-shell]").getByRole("alert"),
  ).toBeVisible();
});
test("unavailable draft storage remains explicit and does not prevent ZIP backup", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, "indexedDB", {
      value: undefined,
      configurable: true,
    }),
  );
  await page.goto(ADMIN_PAGE_PATH);
  await expect(
    page.getByText(/브라우저 초안 저장소를 사용할 수 없습니다/),
  ).toBeVisible();
  await page
    .getByLabel("프로젝트 제목", { exact: true })
    .fill("로컬 저장 불가");
  await page
    .getByLabel("대표 이미지 업로드")
    .setInputFiles({ name: "cover.png", mimeType: "image/png", buffer: png });
  await expect(
    page.getByRole("button", { name: "ZIP 내보내기", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "초안 저장", exact: true }).click();
  await expect(
    page.locator("[data-admin-shell]").getByRole("alert"),
  ).toContainText("ZIP으로 백업");
});
