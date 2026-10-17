import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import {
  inspectAsset,
  createPackage,
  readPackage,
  type PackageData,
} from "../../src/lib/admin/package";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==",
  "base64",
);

test("ZIP naming retains a supplied JPEG extension without reencoding the image", async () => {
  const original = await fs.readFile(
    "public/images/portfolio/jd038/jd038_2.jpg",
  );
  const { asset, blob } = await inspectAsset(
    new File([original], "직접 준비한 대표.JPEG"),
    "jpeg-cover",
  );
  const archive = await createPackage(
    {
      schemaVersion: 1,
      project: {
        id: "jd046",
        title: "JPEG source",
        category: "Product",
        thumbnail: asset.id,
      },
      assets: [asset],
      blocks: [],
      models: [],
    },
    new Map([[asset.id, blob]]),
  );
  const restored = await readPackage(new File([archive], "jd046.zip"));
  expect(restored.manifest.assets[0].path).toBe("assets/jd046_thumbs.jpeg");
  expect(restored.manifest.assets[0].name).toBe("직접 준비한 대표.JPEG");
  expect(
    Buffer.from(await restored.files.get(asset.id)!.arrayBuffer()),
  ).toEqual(original);
});

test("actual ZIP export applies role filenames while preserving all original bytes and metadata", async () => {
  const source = [
    await inspectAsset(new File([png], "원래 대표 이미지.png"), "cover-uuid"),
    await inspectAsset(new File([png], "원래 본문 A.png"), "body-a"),
    await inspectAsset(new File([png], "원래 본문 B.png"), "body-b"),
    await inspectAsset(
      new File(
        [await fs.readFile("public/images/glb/jd017_e_web.glb")],
        "기존 모델.glb",
      ),
      "model-a",
    ),
  ];
  const data: PackageData = {
    manifest: {
      schemaVersion: 1,
      project: {
        id: "jd046",
        title: "Filename contract",
        category: "Product",
        thumbnail: "cover-uuid",
      },
      blocks: [
        {
          id: "one",
          type: "images",
          columns: 2,
          images: [
            {
              assetId: "body-b",
              alt: "B",
              caption: "second uploaded, first displayed",
            },
            {
              assetId: "body-a",
              alt: "A",
              caption: "first uploaded, second displayed",
            },
          ],
        },
      ],
      models: ["model-a"],
      assets: source.map((item) => item.asset),
    },
    files: new Map(source.map((item) => [item.asset.id, item.blob])),
  };
  const before = structuredClone(data.manifest);
  const archive = await createPackage(data.manifest, data.files);
  const restored = await readPackage(new File([archive], "jd046.zip"));
  expect(
    restored.manifest.assets.map((asset) => [asset.id, asset.path]),
  ).toEqual([
    ["cover-uuid", "assets/jd046_thumbs.png"],
    ["body-a", "assets/jd046_body_02.png"],
    ["body-b", "assets/jd046_body_01.png"],
    ["model-a", "assets/jd046_model_01.glb"],
  ]);
  expect(data.manifest).toEqual(before);
  expect(restored.manifest.project).toEqual(before.project);
  expect(restored.manifest.blocks).toEqual(before.blocks);
  expect(restored.manifest.models).toEqual(before.models);
  for (const original of source) {
    const returned = restored.manifest.assets.find(
      (asset) => asset.id === original.asset.id,
    )!;
    expect({ ...returned, path: original.asset.path }).toEqual(original.asset);
    expect(
      Buffer.from(await restored.files.get(original.asset.id)!.arrayBuffer()),
    ).toEqual(Buffer.from(await original.blob.arrayBuffer()));
  }
});
