import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==",
  "base64",
);
function smallModel(mode: number): Buffer {
  const document = {
    asset: { version: "2.0" },
    buffers: [{ byteLength: 36 }],
    bufferViews: [{ buffer: 0, byteLength: 36 }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: "VEC3",
        min: [0, 0, 0],
        max: [1, 1, 0],
      },
    ],
    meshes: [{ primitives: [{ mode, attributes: { POSITION: 0 } }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };
  const raw = Buffer.from(JSON.stringify(document));
  const json = Buffer.concat([raw, Buffer.alloc(-raw.length & 3, 32)]);
  const head = Buffer.alloc(20);
  head.write("glTF");
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(20 + json.length + 8 + 36, 8);
  head.writeUInt32LE(json.length, 12);
  head.write("JSON", 16);
  const chunk = Buffer.alloc(8);
  chunk.writeUInt32LE(36);
  chunk.write("BIN\0", 4);
  const data = Buffer.alloc(36);
  data.writeFloatLE(1, 12);
  data.writeFloatLE(1, 28);
  return Buffer.concat([head, json, chunk, data]);
}
for (const mode of [5, 6]) {
  test(`persisted mode${mode} draft cannot replace an already-open safe preview`, async ({
    page,
  }) => {
    const model = smallModel(mode);
    expect(model.length).toBeLessThan(1000);
    const title = `Rejected draft ${mode}`;
    const id = `legacy-mode-${mode}`;
    const asset = (
      key: string,
      kind: "image" | "model",
      bytes: Buffer,
      name: string,
    ) => ({
      id: key,
      kind,
      name,
      path: `assets/${name}`,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      ...(kind === "image" ? { width: 1, height: 1 } : {}),
    });
    const manifest = {
      schemaVersion: 1,
      project: { id: "jd046", title, category: "Product", thumbnail: "cover" },
      blocks: [],
      models: ["bad-model"],
      assets: [
        asset("cover", "image", png, "cover.png"),
        asset("bad-model", "model", model, `mode${mode}.glb`),
      ],
    };
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("dialog", (dialog) => void dialog.accept());
    await page.addInitScript(() => {
      const original = URL.createObjectURL;
      (
        window as typeof window & { rejectedModelURLs: string[] }
      ).rejectedModelURLs = [];
      URL.createObjectURL = function (blob: Blob | MediaSource) {
        const url = original.call(URL, blob);
        if (blob instanceof Blob && blob.type === "model/gltf-binary")
          (
            window as typeof window & { rejectedModelURLs: string[] }
          ).rejectedModelURLs.push(url);
        return url;
      };
    });
    await page.goto(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/admin/`);
    await page.evaluate(
      async ({ id, title, manifest, coverBytes, modelBytes }) => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const req = indexedDB.open("jid-public-editor-v1", 1);
          req.onupgradeneeded = () => {
            if (!req.result.objectStoreNames.contains("drafts"))
              req.result.createObjectStore("drafts", { keyPath: "id" });
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction("drafts", "readwrite");
          tx.objectStore("drafts").put({
            id,
            title,
            projectId: "jd046",
            updatedAt: Date.now(),
            manifest,
            files: [
              [
                "cover",
                { data: Uint8Array.from(coverBytes).buffer, type: "image/png" },
              ],
              [
                "bad-model",
                {
                  data: Uint8Array.from(modelBytes).buffer,
                  type: "model/gltf-binary",
                },
              ],
            ],
          });
          tx.oncomplete = () => resolve();
          tx.onerror = tx.onabort = () => reject(tx.error);
        });
        db.close();
      },
      { id, title, manifest, coverBytes: [...png], modelBytes: [...model] },
    );
    await page.reload();
    await page
      .getByLabel("프로젝트 제목", { exact: true })
      .fill("Safe current project");
    await page
      .getByLabel("대표 이미지 업로드")
      .setInputFiles({
        name: "current-cover.png",
        mimeType: "image/png",
        buffer: png,
      });
    await page.getByRole("button", { name: /전체 미리보기/ }).click();
    const preview = page.getByRole("region", { name: "프로젝트 미리보기" });
    await expect(preview).toBeVisible();
    await expect(
      preview.getByRole("heading", {
        name: "Safe current project",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: `초안 불러오기 ${title}`, exact: true })
      .click();
    const alert = page.locator("[data-admin-shell]").getByRole("alert");
    await expect(alert).toContainText(/TRIANGLES|삼각형/);
    await expect(alert).toContainText("보존");
    await expect(page.getByLabel("프로젝트 제목", { exact: true })).toHaveValue(
      "Safe current project",
    );
    await expect(
      preview.getByRole("heading", {
        name: "Safe current project",
        exact: true,
      }),
    ).toBeVisible();
    await expect(preview.locator("canvas")).toHaveCount(0);
    expect(
      await page.evaluate(
        () =>
          (window as typeof window & { rejectedModelURLs: string[] })
            .rejectedModelURLs,
      ),
    ).toEqual([]);
    const preserved = await page.evaluate(async (id) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open("jid-public-editor-v1", 1);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const record = await new Promise<{
        title: string;
        files: [string, { data: ArrayBuffer }][];
      }>((resolve, reject) => {
        const req = db
          .transaction("drafts", "readonly")
          .objectStore("drafts")
          .get(id);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      db.close();
      return {
        title: record.title,
        bytes: [
          ...new Uint8Array(
            record.files.find(([key]) => key === "bad-model")![1].data,
          ),
        ],
      };
    }, id);
    expect(preserved.title).toBe(title);
    expect(Buffer.from(preserved.bytes)).toEqual(model);
    expect(errors).toEqual([]);
  });
}
