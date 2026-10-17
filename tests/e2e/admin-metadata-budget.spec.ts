import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { zipSync } from "fflate";
import {
  createPackage,
  inspectAsset,
  readPackage,
  validateGlb,
} from "../../src/lib/admin/package";
import type { AdminPackage } from "../../src/lib/admin/types";

// Validator-only fixtures. NEVER import GLTFLoader or enter a browser/GPU here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mutable untrusted JSON fixtures.
type Document = Record<string, any>;
const cover = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==",
  "base64",
);
const imageUri = `data:image/png;base64,${cover.toString("base64")}`;
const budgetError = /metadata.*(?:work|processing)|메타데이터.*처리량/i;
function document(): Document {
  return {
    asset: { version: "2.0" },
    accessors: [{ componentType: 5126, type: "VEC3", count: 3 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };
}
function jsonGlb(text: string): Buffer {
  const json = Buffer.from(text),
    padded = Buffer.concat([json, Buffer.alloc(-json.length & 3, 32)]),
    header = Buffer.alloc(20);
  header.write("glTF");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + padded.length, 8);
  header.writeUInt32LE(padded.length, 12);
  header.write("JSON", 16);
  return Buffer.concat([header, padded]);
}
function glb(root: Document): Buffer {
  return jsonGlb(JSON.stringify(root));
}
async function packet(data: Buffer) {
  const inspected = await inspectAsset(
    new File([Uint8Array.from(cover)], "cover.png"),
    "cover",
  );
  const manifest: AdminPackage = {
    schemaVersion: 1,
    project: {
      id: "jd046",
      title: "Metadata budget",
      category: "Product",
      thumbnail: "cover",
    },
    blocks: [],
    models: ["model"],
    assets: [
      inspected.asset,
      {
        id: "model",
        path: "assets/model.glb",
        name: "model.glb",
        kind: "model",
        bytes: data.length,
        sha256: createHash("sha256").update(data).digest("hex"),
      },
    ],
  };
  const files = new Map<string, Blob>([
    ["cover", inspected.blob],
    ["model", new Blob([Uint8Array.from(data)])],
  ]);
  const zip = zipSync({
    "project.json": Buffer.from(JSON.stringify(manifest)),
    [inspected.asset.path]: cover,
    "assets/model.glb": data,
  });
  return {
    manifest,
    files,
    file: new File([Uint8Array.from(zip)], "jd046.zip"),
  };
}
function amplification(kind: string): Document {
  const root = document(),
    payload = "x".repeat(1024 * 1024);
  if (kind.startsWith("mesh")) {
    root.meshes[0][kind === "mesh-extras" ? "extras" : "extensions"] =
      kind === "mesh-extras" ? { payload } : { UNKNOWN_retained: { payload } };
    root.nodes = Array.from({ length: 4096 }, () => ({ mesh: 0 }));
    root.scenes = [{ nodes: root.nodes.map((_: unknown, i: number) => i) }];
  } else {
    root.images = [{ uri: imageUri, extras: { payload } }];
    root.textures = [{ source: 0 }];
    if (kind === "image-transform")
      root.extensionsUsed = ["KHR_texture_transform"];
    root.materials = Array.from({ length: 1024 }, () => ({
      pbrMetallicRoughness: {
        baseColorTexture: {
          index: 0,
          ...(kind === "image-texCoord"
            ? { texCoord: 1 }
            : { extensions: { KHR_texture_transform: { offset: [0.25, 0] } } }),
        },
      },
    }));
    root.meshes[0].primitives = root.materials.map(
      (_: unknown, material: number) => ({
        attributes: { POSITION: 0 },
        material,
      }),
    );
  }
  return root;
}
for (const kind of [
  "mesh-extras",
  "mesh-unknown-extension",
  "image-texCoord",
  "image-transform",
]) {
  for (const entry of ["validate", "inspect", "create", "read"]) {
    test(`metadata B1/B2 ${kind} rejects before loader at ${entry}`, async () => {
      const data = glb(amplification(kind));
      expect(data.length).toBeLessThan(1300000);
      if (entry === "validate")
        expect(() => validateGlb(data)).toThrow(budgetError);
      else if (entry === "inspect")
        await expect(
          inspectAsset(new File([Uint8Array.from(data)], "probe.glb"), "model"),
        ).rejects.toThrow(budgetError);
      else {
        const input = await packet(data);
        if (entry === "create")
          await expect(
            createPackage(input.manifest, input.files),
          ).rejects.toThrow(budgetError);
        else await expect(readPackage(input.file)).rejects.toThrow(budgetError);
      }
    });
  }
}

const maximum = 64 * 1024 * 1024;
function accountingBytes(root: Document): number {
  // Independent fixture oracle: exact-path view, not production code.
  const view = JSON.parse(JSON.stringify(root));
  if (typeof view.asset?.generator === "string") view.asset.generator = "";
  for (const field of ["images", "buffers"])
    for (const item of view[field] ?? [])
      if (typeof item.uri === "string") item.uri = "";
  const text = JSON.stringify(view);
  const tokens = [
    ...text.matchAll(
      /"(?:[^"\\]|\\.)*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
    ),
  ];
  return (
    Buffer.byteLength(text) +
    32 * tokens.filter(([token]) => /^-?\d/.test(token)).length
  );
}
function atBoundary(root: Document, clones: number): Document {
  root.extras = { ...root.extras, payload: "" };
  root.extras.payload = "x".repeat(
    Math.floor(maximum / clones) - accountingBytes(root),
  );
  expect(accountingBytes(root)).toBe(Math.floor(maximum / clones));
  return root;
}
async function acceptedEverywhere(data: Buffer) {
  expect(() => validateGlb(data)).not.toThrow();
  const inspected = await inspectAsset(
    new File([Uint8Array.from(data)], "valid.glb"),
    "model",
  );
  expect(Buffer.from(await inspected.blob.arrayBuffer())).toEqual(data);
  const input = await packet(data),
    exported = await createPackage(input.manifest, input.files);
  for (const file of [input.file, new File([exported], "jd046.zip")]) {
    const result = await readPackage(file);
    expect(Buffer.from(await result.files.get("model")!.arrayBuffer())).toEqual(
      data,
    );
  }
}
test("metadata exactly 64MiB and next representable +16 work bytes at every entrypoint", async () => {
  // C=1 +9 default +4 texture +2 images =16; no graph/material definitions.
  const root = atBoundary(
    {
      asset: { version: "2.0" },
      images: [{ uri: imageUri }, { uri: imageUri }],
      textures: [{ source: 0 }],
    },
    16,
  );
  expect(accountingBytes(root) * 16).toBe(maximum);
  await acceptedEverywhere(glb(root));
  root.extras.payload += "x";
  expect(accountingBytes(root) * 16).toBe(maximum + 16);
  const data = glb(root),
    input = await packet(data);
  expect(() => validateGlb(data)).toThrow(budgetError);
  await expect(
    inspectAsset(new File([Uint8Array.from(data)], "over.glb"), "model"),
  ).rejects.toThrow(budgetError);
  await expect(createPackage(input.manifest, input.files)).rejects.toThrow(
    budgetError,
  );
  await expect(readPackage(input.file)).rejects.toThrow(budgetError);
});
test("metadata UTF-8 bytes, escaped spelling and finite-number allowance are charged", () => {
  const root = atBoundary({ asset: { version: "2.0" } }, 10);
  expect(() => validateGlb(glb(root))).not.toThrow();
  root.extras.payload = "한" + root.extras.payload.slice(1);
  expect(() => validateGlb(glb(root))).toThrow(budgetError);
  const numeric = atBoundary(
    { asset: { version: "2.0" }, extras: { value: 1e20 } },
    10,
  );
  expect(() => validateGlb(glb(numeric))).not.toThrow();
  expect(() =>
    validateGlb(
      jsonGlb(JSON.stringify(numeric).replace('"version"', '"vers\\u0069on"')),
    ),
  ).toThrow(budgetError);
});
test("metadata excludes ONLY core URI strings and asset.generator for accounting, preserving all bytes", async () => {
  const uri = `data:application/octet-stream;base64,${Buffer.alloc(64).toString("base64")}`;
  const root = document();
  // Exercise the exclusion beyond the copy-work cap without relying on the
  // pre-existing regex scanner accepting a single 26MiB JSON string. The
  // separate original large-BIN regression still covers >25MiB model bytes.
  root.asset.generator = "g".repeat(64 * 1024);
  root.nodes = Array.from({ length: 128 }, () => ({ mesh: 0 }));
  root.scenes = [{ nodes: Array.from({ length: 128 }, (_, i) => i) }];
  root.buffers = [{ byteLength: 64, uri }];
  root.images = [{ uri: imageUri }];
  await acceptedEverywhere(glb(root));
  root.asset.extras = { generator: root.asset.generator };
  delete root.asset.generator;
  expect(() => validateGlb(glb(root))).toThrow(budgetError);
});
for (const location of [
  "name",
  "extras",
  "extension",
  "asset.extra.generator",
  "buffer.extras.uri",
  "image.extras.uri",
  "asset.generator-key",
  "images[].uri-key",
]) {
  test(`metadata retains payload at ${location}, never matching lookalike exclusions`, () => {
    const root = document(),
      payload = "x".repeat(3 * 1024 * 1024);
    if (location === "name") root.nodes[0].name = payload;
    else if (location === "extras") root.meshes[0].extras = { payload };
    else if (location === "extension")
      root.meshes[0].extensions = { ALIAS: { name: payload } };
    else if (location === "asset.extra.generator")
      root.asset.extras = { generator: payload };
    else if (
      location === "buffer.extras.uri" ||
      location === "image.extras.uri"
    ) {
      const record = {
        ...(location === "buffer.extras.uri"
          ? { byteLength: 1, uri: "data:application/octet-stream;base64,AA==" }
          : { uri: imageUri }),
        extras: { uri: "data:application/octet-stream;base64,AAAA" },
      };
      root[location === "buffer.extras.uri" ? "buffers" : "images"] = [record];
      atBoundary(root, location === "buffer.extras.uri" ? 30 : 31);
      expect(() => validateGlb(glb(root))).not.toThrow();
      record.extras.uri = "data:application/octet-stream;base64,AAAAAAAA";
    } else
      root[
        location === "asset.generator-key" ? "asset.generator" : "images[].uri"
      ] = payload;
    expect(() => validateGlb(glb(root))).toThrow(budgetError);
  });
}
test("metadata non-string generator and nested core-like objects are not excluded", () => {
  for (const root of [
    {
      asset: {
        version: "2.0",
        generator: { name: "x".repeat(7 * 1024 * 1024) },
      },
    },
    {
      asset: { version: "2.0" },
      extras: { asset: { generator: "x".repeat(7 * 1024 * 1024) } },
    },
    atBoundary(
      {
        asset: { version: "2.0" },
        extensions: {
          UNKNOWN: {
            images: [{ uri: "data:application/octet-stream;base64,AAAAAAAA" }],
          },
        },
      },
      10,
    ),
  ]) {
    if (root.extensions) root.extras.payload += "x";
    expect(() => validateGlb(glb(root))).toThrow(budgetError);
  }
});
test("metadata counts every scene plus unused trees and mesh definitions", () => {
  const root = document();
  root.images = [{ uri: imageUri }, { uri: imageUri }];
  atBoundary(root, 32); // 1 +4*(N1+P1+S1+EN1+EP1)+9 +I2.
  expect(() => validateGlb(glb(root))).not.toThrow();
  root.scenes.push({ nodes: [0] });
  expect(() => validateGlb(glb(root))).toThrow(budgetError);
  for (const variant of ["unused-tree", "unused-mesh", "no-scenes"]) {
    const unused = document();
    delete unused.scene;
    if (variant === "unused-tree") {
      unused.nodes.push({ mesh: 0 });
      unused.scenes = [];
    }
    if (variant === "unused-mesh") {
      unused.meshes.push({ primitives: [{ attributes: { POSITION: 0 } }] });
      unused.nodes = [];
      unused.scenes = [];
    }
    if (variant === "no-scenes") {
      delete unused.nodes;
      delete unused.scenes;
    }
    atBoundary(
      unused,
      variant === "unused-tree" ? 38 : variant === "unused-mesh" ? 26 : 18,
    );
    expect(() => validateGlb(glb(unused))).not.toThrow();
    unused.extras.payload += "x";
    expect(() => validateGlb(glb(unused))).toThrow(budgetError);
  }
});
test("metadata material definitions include nine variants each plus implicit default", () => {
  const root = atBoundary({ asset: { version: "2.0" }, materials: [{}] }, 19);
  expect(() => validateGlb(glb(root))).not.toThrow();
  root.extras.payload += "x";
  expect(() => validateGlb(glb(root))).toThrow(budgetError);
});
for (const [key, opportunities] of [
  ["baseColorTexture", 1],
  ["metallicRoughnessTexture", 2],
  ["UNKNOWN_Texture", 1],
] as const) {
  test(`metadata assignment opportunities count ${key} in unknown nested objects without dedupe`, () => {
    const root: Document = {
      asset: { version: "2.0" },
      materials: [
        {
          extensions: {
            UNKNOWN: [
              {
                [key]: {
                  index: 99,
                  texCoord: 1,
                  extensions: { KHR_texture_transform: { offset: [0, 0] } },
                },
              },
            ],
          },
        },
      ],
    };
    atBoundary(root, 19 + 2 * opportunities);
    expect(() => validateGlb(glb(root))).not.toThrow();
    root.extras.payload += "x";
    expect(() => validateGlb(glb(root))).toThrow(budgetError);
  });
}
test("metadata all material definitions must be record arrays, including unused", () => {
  for (const materials of [
    null,
    false,
    0,
    "",
    {},
    [null],
    [[]],
    [false],
    ["name"],
  ])
    expect(() =>
      validateGlb(glb({ asset: { version: "2.0" }, materials })),
    ).toThrow(/material|재질/i);
});
test("metadata small defaults and unknown metadata remain accepted unchanged", async () => {
  for (const root of [
    { asset: { version: "2.0" } },
    {
      ...document(),
      materials: [],
      textures: [],
      images: [],
      extras: { name: "small 한글 😀", generator: "retained" },
      extensions: { UNKNOWN: { payload: [true, null, 1e20] } },
    },
  ])
    await acceptedEverywhere(glb(root));
});
