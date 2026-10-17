import { ADMIN_PAGE_PATH } from "../helpers/admin-route";
import { test, expect } from "@playwright/test";
import { validateGlb, inspectAsset } from "../../src/lib/admin/package";
import fs from "node:fs/promises";

function glb(targetCount: number, vertexCount = 3): Uint8Array {
  const root = {
    asset: { version: "2.0" },
    accessors: [0, 1].map(() => ({
      componentType: 5126,
      count: vertexCount,
      type: "VEC3",
    })),
    meshes: [
      {
        primitives: [
          {
            attributes: { POSITION: 0 },
            targets: Array.from({ length: targetCount }, () => ({
              POSITION: 1,
            })),
          },
        ],
      },
    ],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };
  const json = Buffer.from(JSON.stringify(root));
  const padded = Buffer.concat([
    json,
    Buffer.alloc((4 - (json.length % 4)) % 4, 32),
  ]);
  const head = Buffer.alloc(20);
  head.write("glTF");
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(20 + padded.length, 8);
  head.writeUInt32LE(padded.length, 12);
  head.write("JSON", 16);
  return Buffer.concat([head, padded]);
}

test("approved static-only upload policy rejects ordinary and repeated morph-target GLBs before loading", async () => {
  for (const data of [glb(1), glb(256, 999999)]) {
    expect(data.length).toBeLessThan(10000);
    expect(() => validateGlb(data)).toThrow(/모프|morph/i);
    await expect(
      inspectAsset(
        new File([Uint8Array.from(data)], "morph.glb"),
        "morph-model",
      ),
    ).rejects.toThrow(/모프|morph/i);
  }
});

test("browser rejects morph uploads while leaving the editor usable for a static GLB", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(ADMIN_PAGE_PATH);
  await page.getByLabel("3D 모델 업로드").setInputFiles({
    name: "unsupported-morph.glb",
    mimeType: "model/gltf-binary",
    buffer: Buffer.from(glb(256, 999999)),
  });
  await expect(
    page.locator("[data-admin-shell]").getByRole("alert"),
  ).toContainText(/모프|morph/i);
  await expect(
    page.getByText("unsupported-morph.glb", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByLabel("3D 모델 업로드")
    .setInputFiles("public/images/glb/jd017_e_web.glb");
  await expect(
    page.getByText("jd017_e_web.glb", { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator("[data-admin-shell]").getByRole("alert"),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("static model restriction is disclosed in the upload hint and opened manual", async ({
  page,
}) => {
  await page.goto(ADMIN_PAGE_PATH);
  const modelSection = page
    .getByRole("heading", { name: /3D 모델/ })
    .locator("xpath=ancestor::section[1]");
  for (const text of [
    "키프레임",
    "스켈레톤",
    "회전·확대",
    "기본 삼각형",
    "반복 참조",
    "64MiB",
    "샘플러",
    "GPU 메모리",
    "메타데이터",
    "원본 복사량",
  ]) {
    await expect(modelSection).toContainText(text);
  }
  await expect(modelSection).toContainText(
    "처리량 수치는 실제 GPU 메모리 상한이 아닙니다.",
  );
  await expect(modelSection).toContainText(
    "바이너리 영역과 이미지 원본 복사량도 합산해 GLB당 별도로 64MiB 이하로 제한합니다.",
  );
  await page
    .getByRole("button", { name: "업로드 매뉴얼", exact: true })
    .click();
  const manual = page.getByRole("dialog");
  for (const text of [
    "키프레임",
    "스켈레톤",
    "회전·확대",
    "기존 프로젝트의 원본 GLB",
    "기본 삼각형",
    "반복 참조",
    "64MiB",
    "샘플러",
    "GPU 메모리",
    "메타데이터",
    "원본 복사량",
    "Strip/Fan·선·점",
    "초안 불러오기",
  ]) {
    await expect(manual).toContainText(text);
  }
  await expect(manual).toContainText("실제 GPU 메모리 용량을 뜻하지 않습니다.");
  await expect(manual).toContainText(
    "복제 작업량을 별도로 64MiB로 제한합니다.",
  );
  await page.keyboard.press("Escape");
  await expect(manual).not.toBeVisible();
});

test("empty morph metadata and unchanged static original models remain accepted", async () => {
  expect(() => validateGlb(glb(0))).not.toThrow();
  for (const name of ["jd017_e_web.glb", "jd019_b_web.glb"]) {
    const data = await fs.readFile(`public/images/glb/${name}`);
    expect(() => validateGlb(data)).not.toThrow();
  }
});
