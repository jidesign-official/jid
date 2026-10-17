import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { readPackage } from "../../src/lib/admin/package";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==",
  "base64",
);
const modelFiles = ["jd017_e_web.glb", "jd019_b_web.glb"];

for (const withModels of [false, true]) {
  test(`browser exports complete ${withModels ? "two-model" : "no-model"} package with text and image rows`, async ({
    page,
  }, testInfo) => {
    const id = withModels ? "jd997" : "jd996";
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${basePath}/admin/`);
    // SSR fields can accept typing before React owns their state. Prove the
    // workspace is interactive through a reversible real navigation first.
    const nav = page.getByRole("navigation", { name: "관리 도구 메뉴" });
    await nav.getByRole("button", { name: "프로젝트 목록", exact: true }).click();
    await expect(page.getByRole("heading", { name: "프로젝트 목록." })).toBeVisible();
    await nav.getByRole("button", { name: "편집기", exact: true }).click();
    await page.getByLabel("프로젝트 ID", { exact: true }).fill(id);
    await page
      .getByLabel("프로젝트 제목", { exact: true })
      .fill(`CMS QA ONLY ${id} — not for publication`);
    await expect(page.getByLabel("프로젝트 ID", { exact: true })).toHaveValue(id);
    await page
      .getByRole("combobox", { name: "카테고리", exact: true })
      .selectOption(withModels ? "Product" : "UX/UI");
    await page
      .getByLabel("대표 이미지 업로드")
      .setInputFiles({ name: "cover.png", mimeType: "image/png", buffer: png });
    await page
      .getByRole("button", { name: "제목 블록 추가", exact: true })
      .click();
    await page.getByLabel("제목 내용").fill("Two images, one story");
    await page
      .getByRole("button", { name: "본문 블록 추가", exact: true })
      .click();
    await page
      .getByLabel("본문 내용")
      .fill("First line\nSecond line <script>window.cmsInjected=true</script>");
    await page
      .getByRole("button", { name: "이미지 블록 추가", exact: true })
      .click();
    await page.getByLabel("블록 이미지 업로드").setInputFiles([
      { name: "first.png", mimeType: "image/png", buffer: png },
      { name: "second.png", mimeType: "image/png", buffer: png },
    ]);
    await page.getByLabel("이미지 1 대체 텍스트").fill("First CMS image");
    await page.getByLabel("이미지 1 캡션").fill("First caption");
    await page.getByLabel("이미지 2 대체 텍스트").fill("Second CMS image");
    await page.getByLabel("이미지 2 캡션").fill("Second caption");
    await page.getByLabel("블록 3 열 수").selectOption("2");
    await page
      .getByRole("button", { name: "이미지 2 위로", exact: true })
      .click();
    await expect(page.getByLabel("이미지 1 캡션")).toHaveValue(
      "Second caption",
    );
    await page
      .getByRole("button", { name: "블록 3 위로", exact: true })
      .click();
    if (withModels) {
      await page
        .getByLabel("3D 모델 업로드")
        .setInputFiles(
          modelFiles.map((file) =>
            path.join(process.cwd(), "public/images/glb", file),
          ),
        );
      await page
        .getByRole("button", { name: "모델 2 위로", exact: true })
        .click();
    }
    await expect(
      page.getByRole("button", { name: "ZIP 내보내기", exact: true }),
    ).toBeEnabled();
    if (!withModels) {
      await page.getByRole("button", { name: /전체 미리보기/ }).click();
      const preview = page.getByRole("region", { name: "프로젝트 미리보기" });
      await expect(
        preview.getByRole("heading", { name: "Two images, one story" }),
      ).toBeVisible();
      await expect(preview.locator("figure img")).toHaveCount(2);
      await expect(preview.locator("canvas")).toHaveCount(0);
      expect(
        await page.evaluate(
          () => (window as Window & { cmsInjected?: boolean }).cmsInjected,
        ),
      ).toBeUndefined();
    }
    const pending = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "ZIP 내보내기", exact: true })
      .click();
    const download = await pending;
    expect(download.suggestedFilename()).toBe(`${id}.zip`);
    const bytes = await fs.readFile((await download.path())!);
    const restored = await readPackage(new File([bytes], `${id}.zip`));
    expect(restored.manifest.project).toMatchObject({
      id,
      category: withModels ? "Product" : "UX/UI",
    });
    expect(restored.manifest.blocks.map((b) => b.type)).toEqual([
      "heading",
      "images",
      "paragraph",
    ]);
    expect(restored.manifest.blocks[1]).toMatchObject({
      type: "images",
      columns: 2,
      images: [
        { alt: "Second CMS image", caption: "Second caption" },
        { alt: "First CMS image", caption: "First caption" },
      ],
    });
    expect(restored.manifest.models).toHaveLength(withModels ? 2 : 0);
    if (withModels) {
      for (const [index, originalName] of [...modelFiles].reverse().entries()) {
        const original = await fs.readFile(
          path.join(process.cwd(), "public/images/glb", originalName),
        );
        const asset = restored.manifest.assets.find(
          (a) => a.id === restored.manifest.models[index],
        )!;
        expect(asset.sha256).toBe(
          createHash("sha256").update(original).digest("hex"),
        );
        expect(
          Buffer.from(await restored.files.get(asset.id)!.arrayBuffer()),
        ).toEqual(original);
      }
    }
    if (process.env.ADMIN_QA_DIR) {
      const directory = path.join(
        process.env.ADMIN_QA_DIR,
        "browser-packages",
        testInfo.project.name.replace(/\W/g, "-"),
      );
      await fs.mkdir(directory, { recursive: true });
      await download.saveAs(path.join(directory, `${id}.zip`));
    }
    expect(errors).toEqual([]);
  });
}
