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

// Node-only policy probes. NEVER pass these resources to a loader/browser/GPU.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mutable untrusted JSON fixtures.
type Document = Record<string, any>;
function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function png(width = 1, height = 1): Buffer {
  const chunk = (kind: string, body: Buffer) => {
    const type = Buffer.from(kind),
      header = Buffer.alloc(4),
      crc = Buffer.alloc(4);
    header.writeUInt32BE(body.length);
    crc.writeUInt32BE(crc32(Buffer.concat([type, body])));
    return Buffer.concat([header, type, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  // Genuine grayscale PNG: filter byte + one byte per pixel, all zero.
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.alloc((width + 1) * height))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
function image(width = 1, height = 1) {
  return {
    uri: `data:image/png;base64,${png(width, height).toString("base64")}`,
  };
}
function document(width = 1, height = 1, count = 1): Document {
  return {
    asset: { version: "2.0" },
    images: [image(width, height)],
    textures: Array.from({ length: count }, () => ({ source: 0 })),
  };
}
function glb(root: Document): Buffer {
  return jsonGlb(JSON.stringify(root));
}
function jsonGlb(text: string): Buffer {
  const json = Buffer.from(text);
  const padded = Buffer.concat([json, Buffer.alloc(-json.length & 3, 32)]),
    header = Buffer.alloc(20);
  header.write("glTF");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + padded.length, 8);
  header.writeUInt32LE(padded.length, 12);
  header.write("JSON", 16);
  return Buffer.concat([header, padded]);
}
function amplification(): Buffer {
  const root = document(4096, 4096, 108);
  root.samplers = [];
  for (const magFilter of [9728, 9729])
    for (const minFilter of [9728, 9729, 9984, 9985, 9986, 9987])
      for (const wrapS of [33071, 33648, 10497])
        for (const wrapT of [33071, 33648, 10497])
          root.samplers.push({ magFilter, minFilter, wrapS, wrapT });
  root.textures.forEach(
    (texture: Document, i: number) => (texture.sampler = i),
  );
  root.accessors = [
    { componentType: 5126, type: "VEC3", count: 3 },
    { componentType: 5126, type: "VEC2", count: 3 },
  ];
  root.materials = root.textures.map((_: unknown, index: number) => ({
    pbrMetallicRoughness: { baseColorTexture: { index } },
  }));
  root.meshes = [
    {
      primitives: root.textures.map((_: unknown, material: number) => ({
        attributes: { POSITION: 0, TEXCOORD_0: 1 },
        material,
      })),
    },
  ];
  root.nodes = [{ mesh: 0 }];
  root.scenes = [{ nodes: [0] }];
  root.scene = 0;
  return glb(root);
}
async function packet(data: Buffer) {
  const cover = png(),
    inspected = await inspectAsset(
      new File([Uint8Array.from(cover)], "cover.png"),
      "cover",
    );
  const manifest: AdminPackage = {
    schemaVersion: 1,
    project: {
      id: "jd046",
      title: "Texture budget",
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
const budgetError = /texture.*processing|텍스처.*처리량/i;
test("texture integer fields reject floating/exponent JSON tokens without inspecting extras", () => {
  for (const token of ["0.0", "0e0", "0.00000000000000001"]) {
    for (const field of ["source", "sampler", "alternate"]) {
      const root = document();
      root.samplers = [{}];
      if (field === "alternate")
        root.textures[0].extensions = { EXT_texture_webp: { source: "RAW" } };
      else root.textures[0][field] = "RAW";
      expect(() =>
        validateGlb(jsonGlb(JSON.stringify(root).replace('"RAW"', token))),
      ).toThrow(/texture|sampler/i);
    }
  }
  for (const field of ["magFilter", "minFilter", "wrapS", "wrapT"]) {
    const root = document();
    root.samplers = [{ [field]: "RAW" }];
    const valid = field.startsWith("wrap") ? 10497 : 9729;
    expect(() =>
      validateGlb(jsonGlb(JSON.stringify(root).replace('"RAW"', `${valid}.0`))),
    ).toThrow(/texture|sampler/i);
  }
  const root = document();
  root.extras = { source: 0.5, samplers: [{ magFilter: 1.5 }] };
  root.textures[0].extras = { source: 0.5, sampler: 1.5 };
  root.samplers = [{ extras: { minFilter: 1.5 } }];
  root["textures[].source"] = 0.5;
  expect(() => validateGlb(glb(root))).not.toThrow();
});
test("base-level texture work accepts exactly 40M and rejects minimum +2 across repeated definitions", async () => {
  for (const repeated of [false, true]) {
    const root = repeated ? document(2500, 4000, 2) : document(5000, 4000);
    const exact = glb(root);
    expect(() => validateGlb(exact)).not.toThrow();
    const input = await packet(exact),
      exported = await createPackage(input.manifest, input.files);
    await readPackage(new File([exported], "jd046.zip"));
    root.images.push(image());
    root.textures.push({ source: 1 });
    expect(() => validateGlb(glb(root))).toThrow(budgetError); // 40,000,002, minimum increment.
  }
});
test("4K image reused by distinct definitions counts again even with identical sampler", () => {
  const root = document(4096, 4096);
  root.samplers = [{}];
  root.textures[0].sampler = 0;
  expect(() => validateGlb(glb(root))).not.toThrow();
  root.textures.push({ source: 0, sampler: 0 });
  expect(() => validateGlb(glb(root))).toThrow(budgetError);
});
for (const extension of ["EXT_texture_webp", "EXT_texture_avif"]) {
  test(`${extension} source-only and fallback candidates all count, including undeclared extensions`, async () => {
    const root = document();
    root.textures[0] = { extensions: { [extension]: { source: 0 } } };
    expect(() => validateGlb(glb(root))).not.toThrow();
    const data = glb(root),
      input = await packet(data);
    await inspectAsset(
      new File([Uint8Array.from(data)], "extension.glb"),
      "model",
    );
    await createPackage(input.manifest, input.files);
    await readPackage(input.file);
    // A tiny fallback must never mask a large alternate, or vice versa.
    root.images.push(image(4096, 4096));
    for (const [fallback, alternate] of [
      [0, 1],
      [1, 0],
    ]) {
      root.textures = Array.from({ length: 2 }, () => ({
        source: fallback,
        extensions: { [extension]: { source: alternate } },
      }));
      expect(() => validateGlb(glb(root))).toThrow(budgetError);
    }
  });
  test(`${extension} validates every alternate and fallback source strictly`, () => {
    for (const bad of [null, false, true, "0", -1, 1, 0.5, {}, []]) {
      const root = document();
      root.textures[0].extensions = { [extension]: { source: bad } };
      expect(() => validateGlb(glb(root))).toThrow(/source/i);
      root.textures[0] = {
        source: bad,
        extensions: { [extension]: { source: 0 } },
      };
      expect(() => validateGlb(glb(root))).toThrow(/source/i);
    }
    for (const bad of [null, false, true, "", 0, [], {}]) {
      const root = document();
      root.textures[0].extensions = { [extension]: bad };
      expect(() => validateGlb(glb(root))).toThrow(/texture|source/i);
    }
  });
}
test("sum of all three potential source slots counts separately without source deduplication", () => {
  const root = document(2500, 4000);
  root.textures[0].extensions = { EXT_texture_webp: { source: 0 } };
  expect(() => validateGlb(glb(root))).not.toThrow(); // 2 × (10M + 10M) = 40M.
  root.images.push(image());
  root.textures[0].extensions.EXT_texture_avif = { source: 1 };
  expect(() => validateGlb(glb(root))).toThrow(budgetError); // +2.
});
test("one-pixel textures and unused sampler definitions have independent 128 limits", () => {
  for (const field of ["textures", "samplers"]) {
    const root = document();
    root[field] = Array.from({ length: 128 }, () =>
      field === "textures" ? { source: 0 } : {},
    );
    expect(() => validateGlb(glb(root))).not.toThrow();
    root[field].push(field === "textures" ? { source: 0 } : {});
    expect(() => validateGlb(glb(root))).toThrow(/128/);
  }
});
test("texture and sampler containers, source and sampler indices reject malformed values", () => {
  for (const field of ["textures", "samplers"]) {
    for (const bad of [
      null,
      false,
      true,
      "",
      0,
      {},
      [null],
      [[]],
      [false],
      ["0"],
    ]) {
      expect(() => validateGlb(glb({ ...document(), [field]: bad }))).toThrow(
        /texture|sampler/i,
      );
    }
  }
  for (const field of ["source", "sampler"])
    for (const bad of [null, false, true, "0", -1, 1, 0.5, {}, []]) {
      const root = document();
      root.samplers = [{}];
      root.textures[0][field] = bad;
      expect(() => validateGlb(glb(root))).toThrow(/source|sampler/i);
    }
  const root = document();
  delete root.textures[0].source;
  expect(() => validateGlb(glb(root))).toThrow(/source/i);
});
test("all valid sampler combinations and defaults preserve small shared textures", async () => {
  const root = document(1, 1, 108);
  root.samplers = [];
  for (const magFilter of [9728, 9729])
    for (const minFilter of [9728, 9729, 9984, 9985, 9986, 9987])
      for (const wrapS of [33071, 33648, 10497])
        for (const wrapT of [33071, 33648, 10497])
          root.samplers.push({ magFilter, minFilter, wrapS, wrapT });
  root.textures.forEach(
    (texture: Document, i: number) => (texture.sampler = i),
  );
  root.samplers.push({});
  root.textures.push({ source: 0, sampler: 108 }, { source: 0 }, { source: 0 });
  const data = glb(root);
  expect(() => validateGlb(data)).not.toThrow();
  await inspectAsset(new File([Uint8Array.from(data)], "small.glb"), "model");
  const input = await packet(data);
  const exported = await createPackage(input.manifest, input.files);
  for (const file of [input.file, new File([exported], "jd046.zip")]) {
    const result = await readPackage(file);
    expect(Buffer.from(await result.files.get("model")!.arrayBuffer())).toEqual(
      data,
    );
  }
});
test("sampler enum fields reject coercions and illegal enum values even when unused", () => {
  for (const field of ["magFilter", "minFilter", "wrapS", "wrapT"]) {
    for (const bad of [
      null,
      false,
      true,
      "9728",
      0,
      -1,
      9728.5,
      {},
      [],
      field === "magFilter" ? 9984 : 9999,
    ]) {
      const root = document();
      root.samplers = [{ [field]: bad }];
      expect(() => validateGlb(glb(root))).toThrow(/sampler/i);
    }
  }
});
test("108 valid sampler 4K amplification is rejected at every package entrypoint", async () => {
  const data = amplification();
  expect(data.length).toBeLessThan(150000);
  expect(() => validateGlb(data)).toThrow(budgetError);
  await expect(
    inspectAsset(new File([Uint8Array.from(data)], "probe.glb"), "model"),
  ).rejects.toThrow(budgetError);
  const input = await packet(data);
  await expect(createPackage(input.manifest, input.files)).rejects.toThrow(
    budgetError,
  );
  await expect(readPackage(input.file)).rejects.toThrow(budgetError);
});
