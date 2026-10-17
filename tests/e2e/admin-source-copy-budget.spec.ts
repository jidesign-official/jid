import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { zipSync } from "fflate";
import {
  createPackage,
  inspectAsset,
  readPackage,
  validateGlb,
} from "../../src/lib/admin/package";
import type { AdminPackage } from "../../src/lib/admin/types";

// Validator-only. Never instantiate a loader, decode pixels or enter a browser/GPU.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Untrusted fixture JSON.
type Document = Record<string, any>;
const MiB = 1024 * 1024,
  maximum = 64 * MiB;
const budgetError = /encoded.source.copy|인코딩.*원본.*복사/i;
function chunk(kind: string, data: Buffer): Buffer {
  const name = Buffer.from(kind),
    result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length);
  name.copy(result, 4);
  data.copy(result, 8);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([name, data])) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
  return result;
}
function png(ancillary?: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.alloc(2))),
    ...(ancillary === undefined
      ? []
      : [chunk("npAD", Buffer.alloc(ancillary))]),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const cover = png();
function glb(root: Document, binary?: Buffer): Buffer {
  const json = Buffer.from(JSON.stringify(root)),
    padded = Buffer.concat([json, Buffer.alloc(-json.length & 3, 32)]);
  const chunks = [padded];
  const header = Buffer.alloc(20);
  header.write("glTF");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(padded.length, 12);
  header.write("JSON", 16);
  if (binary) {
    const bin = Buffer.concat([binary, Buffer.alloc(-binary.length & 3)]),
      binHeader = Buffer.alloc(8);
    binHeader.writeUInt32LE(bin.length);
    binHeader.write("BIN\0", 4);
    chunks.push(binHeader, bin);
  }
  header.writeUInt32LE(
    header.length + chunks.reduce((n, b) => n + b.length, 0),
    8,
  );
  return Buffer.concat([header, ...chunks]);
}
function reviewFixture(kind: string): { root: Document; binary: Buffer } {
  const root: Document = {
    asset: { version: "2.0" },
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };
  const binary = kind === "image-views" ? png(2 * MiB) : Buffer.alloc(2 * MiB);
  root.buffers = [{ byteLength: binary.length }];
  root.bufferViews = Array.from(
    { length: kind === "image-views" ? 60 : 64 },
    () => ({ buffer: 0, byteLength: binary.length }),
  );
  if (kind === "image-views") {
    root.images = Array.from({ length: 60 }, (_, bufferView) => ({
      bufferView,
      mimeType: "image/png",
    }));
    root.textures = Array.from({ length: 60 }, (_, source) => ({ source }));
    root.materials = Array.from({ length: 60 }, (_, index) => ({
      pbrMetallicRoughness: { baseColorTexture: { index } },
    }));
    root.accessors = [
      {
        componentType: 5126,
        type: "VEC3",
        count: 3,
        min: [0, 0, 0],
        max: [0, 0, 0],
      },
      { componentType: 5126, type: "VEC2", count: 3 },
    ];
    root.meshes = [
      {
        primitives: root.materials.map((_: unknown, material: number) => ({
          attributes: { POSITION: 0, TEXCOORD_0: 1 },
          material,
        })),
      },
    ];
  } else {
    root.accessors = Array.from({ length: 32 }, (_, i) => ({
      componentType: 5126,
      type: "VEC3",
      count: 3,
      sparse: {
        count: 1,
        indices: { bufferView: 2 * i, componentType: 5121 },
        values: { bufferView: 2 * i + 1 },
      },
      ...(i === 0 ? { min: [0, 0, 0], max: [0, 0, 0] } : {}),
    }));
    root.meshes = [
      {
        primitives: [
          {
            attributes: Object.fromEntries(
              root.accessors.map((_: unknown, i: number) => [
                i ? `_A${i}` : "POSITION",
                i,
              ]),
            ),
          },
        ],
      },
    ];
  }
  return { root, binary };
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
      title: "Source copy budget",
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
async function rejected(data: Buffer, entry: string) {
  if (entry === "validate")
    expect(() => validateGlb(data)).toThrow(budgetError);
  else if (entry === "inspect")
    await expect(
      inspectAsset(new File([Uint8Array.from(data)], "probe.glb"), "model"),
    ).rejects.toThrow(budgetError);
  else {
    const input = await packet(data);
    if (entry === "create")
      await expect(createPackage(input.manifest, input.files)).rejects.toThrow(
        budgetError,
      );
    else await expect(readPackage(input.file)).rejects.toThrow(budgetError);
  }
}
function sharedImageFixture(): { root: Document; binary: Buffer } {
  const binary = png(2 * MiB),
    root: Document = {
      asset: { version: "2.0" },
      buffers: [{ byteLength: binary.length }],
      bufferViews: [{ buffer: 0, byteLength: binary.length }],
      images: Array.from({ length: 60 }, () => ({
        bufferView: 0,
        mimeType: "image/png",
      })),
      samplers: Array.from({ length: 60 }, (_, i) => ({
        wrapS: i % 2 ? 33071 : 10497,
      })),
      textures: Array.from({ length: 60 }, (_, i) => ({
        source: i,
        sampler: i,
      })),
    };
  return { root, binary };
}
function boundaryViews(total = maximum): { root: Document; binary: Buffer } {
  const binary = Buffer.alloc(MiB),
    root: Document = {
      asset: { version: "2.0" },
      buffers: [{ byteLength: binary.length }],
      bufferViews: [],
    };
  while (total > 0) {
    const byteLength = Math.min(total, MiB);
    root.bufferViews.push({ buffer: 0, byteLength });
    total -= byteLength;
  }
  return { root, binary };
}
for (const entry of ["validate", "inspect", "create", "read"]) {
  test(`encoded-source-copy repeated image records same view with different samplers reject at ${entry}`, async () => {
    const { root, binary } = sharedImageFixture();
    await rejected(glb(root, binary), entry);
  });
}
for (const source of ["bufferView", "dataURI"]) {
  test(`encoded-source-copy ${source} is charged before image container CRC validation`, () => {
    const corrupt = Buffer.from(cover);
    corrupt[corrupt.length - 1] ^= 1;
    const { root, binary } = boundaryViews(
      maximum - cover.length * (source === "bufferView" ? 2 : 1) + 1,
    );
    if (source === "bufferView") {
      corrupt.copy(binary, 128);
      root.bufferViews.push({
        buffer: 0,
        byteOffset: 128,
        byteLength: corrupt.length,
      });
      root.images = [
        { bufferView: root.bufferViews.length - 1, mimeType: "image/png" },
      ];
    } else
      root.images = [
        { uri: `data:image/png;base64,${corrupt.toString("base64")}` },
      ];
    expect(() => validateGlb(glb(root, binary))).toThrow(budgetError);
  });
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
    const restored = await readPackage(file);
    expect(
      Buffer.from(await restored.files.get("model")!.arrayBuffer()),
    ).toEqual(data);
  }
}
async function rejectedEverywhere(data: Buffer) {
  for (const entry of ["validate", "inspect", "create", "read"])
    await rejected(data, entry);
}
test("encoded-source-copy unused overlapping definitions exact64MiB and +1 byte at every entrypoint", async () => {
  const { root, binary } = boundaryViews();
  expect(root.bufferViews).toHaveLength(64);
  expect(
    root.bufferViews.reduce(
      (sum: number, view: Document) => sum + view.byteLength,
      0,
    ),
  ).toBe(maximum);
  await acceptedEverywhere(glb(root, binary));
  root.bufferViews.push({ buffer: 0, byteLength: 1 });
  await rejectedEverywhere(glb(root, binary));
});
for (const base of [false, true]) {
  for (const shared of [false, true]) {
    test(`encoded-source-copy sparse full views base=${base} sameIndex=${shared} fallback charges definitions not references`, async () => {
      const { root, binary } = boundaryViews();
      root.accessors = [
        {
          componentType: 5126,
          type: "VEC3",
          count: 3,
          ...(base ? { bufferView: 2 } : {}),
          sparse: {
            count: 1,
            indices: { bufferView: 0, componentType: 5121 },
            values: { bufferView: shared ? 0 : 1 },
          },
        },
      ];
      await acceptedEverywhere(glb(root, binary));
      root.bufferViews.push({ buffer: 0, byteLength: 1 });
      await rejectedEverywhere(glb(root, binary));
      // Overflow must precede even a bad sparse offset, never enumerate indices.
      root.accessors[0].sparse.indices.byteOffset = MiB + 1;
      expect(() => validateGlb(glb(root, binary))).toThrow(budgetError);
    });
  }
}
test("encoded-source-copy 60 image records sharing one exact offset view count again at exact64MiB/+1", async () => {
  const image = png(8),
    { root, binary } = boundaryViews(maximum - 61 * image.length);
  image.copy(binary, 128);
  root.bufferViews.push({
    buffer: 0,
    byteOffset: 128,
    byteLength: image.length,
  });
  root.images = Array.from({ length: 60 }, () => ({
    bufferView: root.bufferViews.length - 1,
    mimeType: "image/png",
  }));
  root.samplers = Array.from({ length: 60 }, (_, i) => ({
    wrapS: i % 2 ? 33071 : 10497,
  }));
  root.textures = Array.from({ length: 60 }, (_, i) => ({
    source: i,
    sampler: i,
  }));
  await acceptedEverywhere(glb(root, binary));
  root.bufferViews.push({ buffer: 0, byteLength: 1 });
  await rejectedEverywhere(glb(root, binary));
});
test("encoded-source-copy repeated data URI image records use actual decoded lengths at exact64MiB/+1", async () => {
  const image = png(8),
    { root, binary } = boundaryViews(maximum - 60 * image.length);
  root.images = Array.from({ length: 60 }, () => ({
    uri: `data:image/png;base64,${image.toString("base64")}`,
  }));
  await acceptedEverywhere(glb(root, binary));
  root.images[59] = {
    uri: `data:image/png;base64,${png(9).toString("base64")}`,
  };
  await rejectedEverywhere(glb(root, binary));
});
test("encoded-source-copy resolves image view inside a decoded buffer URI without charging surrounding bytes", async () => {
  const binary = Buffer.alloc(256, 255);
  cover.copy(binary, 32);
  const root = {
    asset: { version: "2.0" },
    buffers: [
      {
        byteLength: binary.length,
        uri: `data:application/octet-stream;base64,${binary.toString("base64")}`,
      },
    ],
    bufferViews: [{ buffer: 0, byteOffset: 32, byteLength: cover.length }],
    images: [{ bufferView: 0, mimeType: "image/png" }],
  };
  await acceptedEverywhere(glb(root));
});
test("encoded-source-copy CRC and malformed view checks remain mandatory below budget", async () => {
  const binary = Buffer.from(cover);
  binary[binary.length - 1] ^= 1;
  const root: Document = {
    asset: { version: "2.0" },
    buffers: [{ byteLength: binary.length }],
    bufferViews: [{ buffer: 0, byteLength: binary.length }],
    images: [{ bufferView: 0, mimeType: "image/png" }],
  };
  expect(() => validateGlb(glb(root, binary))).toThrow(/CRC/);
  root.images = [{ uri: `data:image/png;base64,${binary.toString("base64")}` }];
  expect(() => validateGlb(glb(root, binary))).toThrow(/CRC/);
  for (const value of [null, false, -1, 0, 0.5, binary.length + 1]) {
    root.bufferViews[0].byteLength = value;
    expect(() => validateGlb(glb(root, binary))).toThrow(/bufferView/);
  }
});
for (const kind of ["sparse-views", "image-views"]) {
  for (const entry of ["validate", "inspect", "create", "read"]) {
    test(`encoded-source-copy bounded review ${kind} rejects at ${entry}`, async () => {
      const { root, binary } = reviewFixture(kind),
        data = glb(root, binary);
      expect(data.length).toBe(kind === "sparse-views" ? 2104480 : 2109976);
      expect(createHash("sha256").update(data).digest("hex")).toBe(
        kind === "sparse-views"
          ? "fb0d27c3b21f51a510569339bdcc72b696cf9dba4c5d8b4c0821dad7b35d16f0"
          : "73ff00491279ef427780a94f69f9f74a5cec6e81d8b96a5111ae07d5102fd1a4",
      );
      await rejected(data, entry);
    });
  }
}
