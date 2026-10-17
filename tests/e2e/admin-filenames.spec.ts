import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import type { AdminAsset, AdminPackage } from "../../src/lib/admin/types";

function fixture() {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==",
    "base64",
  );
  const text = JSON.stringify({ asset: { version: "2.0" } });
  const json = Buffer.from(
    text.padEnd(Math.ceil(Buffer.byteLength(text) / 4) * 4, " "),
  );
  const glb = Buffer.alloc(20 + json.length);
  glb.write("glTF");
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(glb.length, 8);
  glb.writeUInt32LE(json.length, 12);
  glb.writeUInt32LE(0x4e4f534a, 16);
  json.copy(glb, 20);
  const files = new Map<string, Uint8Array>();
  const asset = (
    id: string,
    ext: string,
    kind: "image" | "model",
  ): AdminAsset => {
    const bytes = kind === "image" ? png : glb;
    files.set(id, new Uint8Array(bytes));
    return {
      id,
      path: `assets/${id}.${ext}`,
      name: `원본 사진 · ${id}.${ext}`,
      kind,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
      ...(kind === "image" ? { width: 1, height: 1 } : {}),
    };
  };
  const manifest: AdminPackage = {
    schemaVersion: 1,
    project: {
      id: "jd046",
      title: "한글 프로젝트",
      category: "Product",
      thumbnail: "cover",
    },
    blocks: [
      {
        id: "gallery",
        type: "images",
        columns: 2,
        images: [
          { assetId: "second", alt: "둘째 원본 먼저", caption: "설명 1" },
          { assetId: "first", alt: "첫째 원본 나중", caption: "설명 2" },
        ],
      },
    ],
    models: ["model-b", "model-a"],
    assets: [
      asset("first", "png", "image"),
      asset("model-a", "glb", "model"),
      asset("cover", "png", "image"),
      asset("second", "png", "image"),
      asset("model-b", "glb", "model"),
    ],
  };
  return { manifest, files };
}
function freezeDeep(value: unknown): void {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
}
const paths = (manifest: AdminPackage) =>
  Object.fromEntries(manifest.assets.map((asset) => [asset.id, asset.path]));
const canonical = async (manifest: AdminPackage): Promise<AdminPackage> =>
  (await import("../../src/lib/admin/filenames")).withCanonicalAssetFilenames(
    manifest,
  );

test("newfilenames: cover, ordered body images and ordered models receive canonical paths", async () => {
  const { manifest } = fixture();
  expect(paths(await canonical(manifest))).toEqual({
    first: "assets/jd046_body_02.png",
    "model-a": "assets/jd046_model_02.glb",
    cover: "assets/jd046_thumbs.png",
    second: "assets/jd046_body_01.png",
    "model-b": "assets/jd046_model_01.glb",
  });
});

test("newfilenames: reject non-string, unsafe, aliased and overlong project IDs", async () => {
  const ids: unknown[] = [
    undefined,
    null,
    46,
    {},
    "",
    "../jd046",
    "jd046/../jd047",
    "JD046",
    " jd046",
    "jd046 ",
    "jd046\n",
    "jd46",
    "jd046_한글",
    "jd046_a-b",
    `jd046_${"a".repeat(80)}`,
  ];
  for (const id of ids) {
    const { manifest } = fixture();
    manifest.project.id = id as string;
    await expect(
      canonical(manifest),
      `ID ${JSON.stringify(id)}`,
    ).rejects.toThrow(/프로젝트 ID|파일명/);
  }
});

test("newfilenames: reject unreferenced assets, unknown references and role/kind mismatches", async () => {
  const mutations: ((manifest: AdminPackage) => void)[] = [
    (manifest) => {
      manifest.models.pop();
    },
    (manifest) => {
      manifest.project.thumbnail = "missing";
    },
    (manifest) => {
      manifest.project.thumbnail = "model-a";
    },
    (manifest) => {
      manifest.models = ["first", "model-a", "model-b"];
    },
    (manifest) => {
      if (manifest.blocks[0].type === "images")
        manifest.blocks[0].images[0].assetId = "model-a";
    },
    (manifest) => {
      manifest.assets[0].kind = "model";
    },
    (manifest) => {
      manifest.models.push("model-a");
    },
    (manifest) => {
      manifest.assets.push({ ...manifest.assets[0] });
    },
  ];
  for (const mutate of mutations) {
    const { manifest } = fixture();
    mutate(manifest);
    await expect(canonical(manifest)).rejects.toThrow();
  }
});

test("newfilenames: reject unsafe original paths, aliases, unknown extensions and mismatched extensions", async () => {
  for (const path of [
    "../cover.png",
    "/assets/cover.png",
    "assets/sub/cover.png",
    "assets/../cover.png",
    "assets/cover.PNG",
    "assets/cover.svg",
    "assets/cover.glb",
    "assets/cover.png?x",
    "assets/cover.png\n",
    "assets/cover%2epng",
    "assets/cover\\\\file.png",
  ]) {
    const { manifest } = fixture();
    manifest.assets.find((asset) => asset.id === "cover")!.path = path;
    await expect(canonical(manifest), path).rejects.toThrow();
  }
  const { manifest } = fixture();
  manifest.assets.find((asset) => asset.id === "model-a")!.path =
    "assets/model-a.png";
  await expect(canonical(manifest)).rejects.toThrow();
});

test("newfilenames: all fields and real binary Maps survive unchanged, with an independent clone", async () => {
  const { manifest, files } = fixture();
  const before = structuredClone(manifest);
  const bytesBefore = new Map(
    [...files].map(([id, bytes]) => [id, new Uint8Array(bytes)]),
  );
  const entriesBefore = [...files];
  freezeDeep(manifest);
  const result = await canonical(manifest);
  expect(manifest).toEqual(before);
  expect(result).not.toBe(manifest);
  expect(result.project).not.toBe(manifest.project);
  expect(result.blocks).not.toBe(manifest.blocks);
  expect(result.models).not.toBe(manifest.models);
  expect(result.assets).not.toBe(manifest.assets);
  expect(result.assets.map((asset) => ({ ...asset, path: "" }))).toEqual(
    before.assets.map((asset) => ({ ...asset, path: "" })),
  );
  expect({ ...result, assets: before.assets }).toEqual(before);
  for (const [id, bytes] of entriesBefore) {
    expect(files.get(id)).toBe(bytes);
    expect(bytes).toEqual(bytesBefore.get(id));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      result.assets.find((asset) => asset.id === id)!.sha256,
    );
  }
  result.project.title = "독립 복사본";
  if (result.blocks[0].type === "images")
    result.blocks[0].images[0].caption = "복사본 설명";
  expect(manifest).toEqual(before);
  expect(await canonical(await canonical(before))).toEqual(
    await canonical(before),
  );
});

test("newfilenames: first occurrence follows block order then image order, including reorders", async () => {
  const { manifest } = fixture();
  manifest.blocks = [
    { id: "text", type: "heading", level: 2, text: "제목" },
    {
      id: "one",
      type: "images",
      columns: 4,
      images: [{ assetId: "first", alt: "처음", caption: "1" }],
    },
    { id: "divider", type: "divider" },
    {
      id: "two",
      type: "images",
      columns: 1,
      images: [
        { assetId: "second", alt: "다음", caption: "2" },
        { assetId: "first", alt: "다시", caption: "3" },
      ],
    },
  ];
  expect(paths(await canonical(manifest)).first).toBe(
    "assets/jd046_body_01.png",
  );
  [manifest.blocks[1], manifest.blocks[3]] = [
    manifest.blocks[3],
    manifest.blocks[1],
  ];
  expect(paths(await canonical(manifest)).first).toBe(
    "assets/jd046_body_02.png",
  );
  const leading = manifest.blocks[1];
  if (leading.type === "images") leading.images.reverse();
  expect(paths(await canonical(manifest)).first).toBe(
    "assets/jd046_body_01.png",
  );
  manifest.models.reverse();
  expect(paths(await canonical(manifest))["model-a"]).toBe(
    "assets/jd046_model_01.glb",
  );
});

test("newfilenames: shared cover and repeated body assets reuse one path without index gaps", async () => {
  const { manifest } = fixture();
  const block = manifest.blocks[0];
  if (block.type !== "images") throw new Error("fixture");
  block.images = ["cover", "second", "second", "cover", "first", "second"].map(
    (assetId, i) => ({ assetId, alt: `장면 ${i}`, caption: `설명 ${i}` }),
  );
  const result = await canonical(manifest);
  expect(paths(result)).toMatchObject({
    cover: "assets/jd046_thumbs.png",
    second: "assets/jd046_body_01.png",
    first: "assets/jd046_body_02.png",
  });
  expect(result.assets).toHaveLength(5);
  expect(result.blocks).toEqual(manifest.blocks);
  expect(
    new Set(result.assets.map((asset) => asset.path.toLowerCase())).size,
  ).toBe(result.assets.length);
});

test("newfilenames: preserve every supported extension and enforce the exact 80-character basename boundary", async () => {
  for (const ext of ["png", "jpg", "jpeg", "webp"]) {
    const { manifest } = fixture();
    // Naming-only inputs: binary/signature validation belongs to the caller.
    manifest.models = [];
    manifest.assets = manifest.assets.filter((asset) => asset.kind === "image");
    for (const asset of manifest.assets)
      asset.path = `assets/${asset.id}.${ext}`;
    manifest.project.id = `jd046_${"a".repeat(80 - "jd046_".length - `_body_01.${ext}`.length)}`;
    const result = await canonical(manifest);
    expect(paths(result).first.split("/")[1]).toHaveLength(80);
    expect(paths(result).cover).toBe(
      `assets/${manifest.project.id}_thumbs.${ext}`,
    );
    manifest.project.id += "a";
    await expect(canonical(manifest)).rejects.toThrow(/80/);
  }
});

test("newfilenames: distinct case and prototype-like asset IDs cannot collide in generated names", async () => {
  for (const [first, second] of [
    ["Asset", "asset"],
    ["__proto__", "constructor"],
  ]) {
    const { manifest } = fixture();
    manifest.assets.find((asset) => asset.id === "first")!.id = first;
    manifest.assets.find((asset) => asset.id === "second")!.id = second;
    if (manifest.blocks[0].type === "images") {
      manifest.blocks[0].images[0].assetId = second;
      manifest.blocks[0].images[1].assetId = first;
    }
    const result = await canonical(manifest);
    expect(
      new Set(result.assets.map((asset) => asset.path.toLowerCase())).size,
    ).toBe(5);
    expect(result.assets.find((asset) => asset.id === first)!.path).toBe(
      "assets/jd046_body_02.png",
    );
  }
  const { manifest } = fixture();
  manifest.assets.find((asset) => asset.id === "second")!.path =
    "assets/FIRST.png";
  await expect(canonical(manifest)).rejects.toThrow(/중복/);
});
