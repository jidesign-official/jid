import { test, expect } from "@playwright/test";
import { deflateRawSync, deflateSync } from "node:zlib";
import { zipSync, unzipSync, strFromU8 } from "fflate";
import {
  createPackage,
  readPackage,
  inspectAsset,
  validatePackage,
  validateGlb,
} from "../../src/lib/admin/package";
import type { AdminPackage } from "../../src/lib/admin/types";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==",
  "base64",
);
function rawZip(
  entries: { name: string; data: Uint8Array; compressed?: Uint8Array }[],
) {
  const locals: Buffer[] = [],
    directory: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name),
      compressed = Buffer.from(entry.compressed ?? deflateRawSync(entry.data));
    const stored = Buffer.from(zipSync({ x: entry.data }, { level: 0 }));
    const crc = stored.readUInt32LE(14);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, compressed);
    directory.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const central = Buffer.concat(directory),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}
test("fix1-security ZIP checks actual inflation size, EOF and trailing junk", async () => {
  const { manifest } = await fixture();
  const compressed = deflateRawSync(png);
  for (const payload of [
    deflateRawSync(Buffer.concat([png, Buffer.alloc(128 * 1024)])),
    compressed.subarray(0, -1),
    Buffer.concat([compressed, Buffer.from([0])]),
  ]) {
    const zip = rawZip([
      { name: "project.json", data: Buffer.from(JSON.stringify(manifest)) },
      { name: "assets/cover.png", data: png, compressed: payload },
    ]);
    await expect(readPackage(new File([zip], "jd046.zip"))).rejects.toThrow();
  }
});
export async function fixture() {
  const result = await inspectAsset(new File([png], "cover.png"), "cover");
  const manifest: AdminPackage = {
    schemaVersion: 1,
    project: {
      id: "jd046",
      title: "테스트 프로젝트",
      category: "Product",
      thumbnail: "cover",
    },
    blocks: [
      {
        id: "images",
        type: "images",
        columns: 2,
        images: [{ assetId: "cover", alt: "제품", caption: "설명" }],
      },
    ],
    models: [],
    assets: [result.asset],
  };
  return { manifest, files: new Map([["cover", result.blob]]) };
}
test("ZIP round trip preserves original bytes and manifest", async () => {
  const draft = await fixture();
  const blob = await createPackage(draft.manifest, draft.files, []);
  const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const expected = {
    ...draft.manifest,
    assets: draft.manifest.assets.map((asset) => ({
      ...asset,
      path: "assets/jd046_thumbs.png",
    })),
  };
  expect(JSON.parse(strFromU8(entries["project.json"]))).toEqual(expected);
  expect(Buffer.from(entries["assets/jd046_thumbs.png"])).toEqual(png);
  const restored = await readPackage(new File([blob], "jd046.zip"));
  expect(restored.manifest).toEqual(expected);
  expect(Buffer.from(await restored.files.get("cover")!.arrayBuffer())).toEqual(
    png,
  );
});

test("valid prototype-like asset IDs round trip through Blob Maps", async () => {
  for (const id of ["__proto__", "constructor"]) {
    const { manifest, files } = await fixture();
    const old = manifest.assets[0];
    manifest.assets = [{ ...old, id, path: `assets/${id}.png` }];
    manifest.project.thumbnail = id;
    manifest.blocks = [
      {
        id: "images",
        type: "images",
        columns: 1,
        images: [
          { assetId: id, alt: "<script>not executable</script>", caption: "" },
        ],
      },
    ];
    const source = new Map([[id, files.get("cover")!]]);
    const output = await createPackage(manifest, source);
    const restored = await readPackage(new File([output], "jd046.zip"));
    expect(restored.files.get(id)).toBeInstanceOf(Blob);
    expect(restored.manifest.project.thumbnail).toBe(id);
  }
});
test("browser image decoding failure never inserts a fake validated asset", async () => {
  const globals = globalThis as typeof globalThis & {
    createImageBitmap?: typeof createImageBitmap;
  };
  const original = globals.createImageBitmap;
  globals.createImageBitmap = async () => {
    throw new Error("decode failed");
  };
  try {
    await expect(
      inspectAsset(new File([png], "broken.png"), "broken"),
    ).rejects.toThrow(/디코드/);
  } finally {
    if (original) globals.createImageBitmap = original;
    else Reflect.deleteProperty(globals, "createImageBitmap");
  }
});
test("container CRC corruption is rejected before accepting an asset", async () => {
  const corrupt = Buffer.from(png);
  corrupt[corrupt.length - 5] ^= 1;
  await expect(
    inspectAsset(new File([corrupt], "bad.png"), "bad"),
  ).rejects.toThrow(/PNG/);
});
test("fix1-security identifiers reject numeric runtime values before regex coercion", async () => {
  for (const mode of ["asset", "block", "thumbnail", "image", "model"]) {
    const { manifest, files } = await fixture();
    const runtime = manifest as unknown as {
      assets: { id: unknown }[];
      project: { thumbnail: unknown };
      blocks: { id: unknown; images: { assetId: unknown }[] }[];
      models: unknown[];
    };
    if (mode === "asset") {
      runtime.assets[0].id = 123;
      runtime.project.thumbnail = 123;
      runtime.blocks[0].images[0].assetId = 123;
    } else if (mode === "block") runtime.blocks[0].id = 123;
    else if (mode === "thumbnail") runtime.project.thumbnail = 123;
    else if (mode === "image") runtime.blocks[0].images[0].assetId = 123;
    else runtime.models = [123];
    expect(() => validatePackage(manifest)).toThrow();
    await expect(createPackage(manifest, files)).rejects.toThrow();
  }
  await expect(
    inspectAsset(new File([png], "cover.png"), 123 as unknown as string),
  ).rejects.toThrow();
});
test("fix1-security manifest export and ZIP names are case-insensitively unique", async () => {
  const { manifest, files } = await fixture();
  const second = {
    ...manifest.assets[0],
    id: "other",
    path: "assets/COVER.png",
  };
  manifest.assets.push(second);
  manifest.blocks = [
    {
      id: "images",
      type: "images",
      columns: 1,
      images: [
        { assetId: "cover", alt: "", caption: "" },
        { assetId: "other", alt: "", caption: "" },
      ],
    },
  ];
  files.set("other", files.get("cover")!);
  expect(() => validatePackage(manifest)).toThrow();
  await expect(createPackage(manifest, files)).rejects.toThrow();
  const zip = rawZip([
    { name: "project.json", data: Buffer.from(JSON.stringify(manifest)) },
    { name: "assets/cover.png", data: png },
    { name: "assets/COVER.png", data: png },
  ]);
  await expect(readPackage(new File([zip], "jd046.zip"))).rejects.toThrow(
    /중복/,
  );
});
test("fix1-security JSON depth and token budgets precede object parsing", async () => {
  const nested = (depth: number) => {
    let value: unknown = null;
    for (let i = 0; i < depth; i++) value = [value];
    return value;
  };
  expect(() =>
    validateGlb(glb({ asset: { version: "2.0" }, extras: nested(65) })),
  ).toThrow();
  expect(() =>
    validateGlb(glb({ asset: { version: "2.0" }, extras: nested(62) })),
  ).not.toThrow();
  expect(() =>
    validateGlb(
      glb({ asset: { version: "2.0" }, extras: Array(100001).fill(null) }),
    ),
  ).toThrow();
  const { manifest, files } = await fixture();
  manifest.blocks = Array.from({ length: 100 }, (_, i) => ({
    id: `p${i}`,
    type: "paragraph",
    text: "한".repeat(10000),
  }));
  await expect(createPackage(manifest, files)).rejects.toThrow(/project.json/);
});
test("reject unknown manifest fields instead of exporting a packet the importer rejects", async () => {
  const { manifest } = await fixture();
  expect(() =>
    validatePackage({ ...manifest, unexpected: true } as AdminPackage),
  ).toThrow();
});
function glb(document: unknown, binary?: Uint8Array) {
  const json = Buffer.from(JSON.stringify(document));
  const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32);
  json.copy(padded);
  const out = Buffer.alloc(
    20 + padded.length + (binary ? 8 + binary.length : 0),
  );
  out.write("glTF");
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(padded.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  padded.copy(out, 20);
  if (binary) {
    out.writeUInt32LE(binary.length, 20 + padded.length);
    out.writeUInt32LE(0x004e4942, 24 + padded.length);
    out.set(binary, 28 + padded.length);
  }
  return out;
}
test("fix2-geometry rejects declared and undeclared GPU instancing without loading", () => {
  const extension = "EXT_mesh_gpu_instancing";
  for (const declaration of ["extensionsUsed", "extensionsRequired", "node"]) {
    const document = {
      asset: { version: "2.0" },
      accessors: [{ componentType: 5126, type: "VEC3", count: 1_000_000 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      nodes: Array.from({ length: 100 }, () => ({
        mesh: 0,
        ...(declaration === "node"
          ? { extensions: { [extension]: { attributes: { TRANSLATION: 0 } } } }
          : {}),
      })),
      ...(declaration === "node" ? {} : { [declaration]: [extension] }),
    };
    const bytes = glb(document);
    expect(bytes.length).toBeLessThan(20_000);
    expect(() => validateGlb(bytes)).toThrow(/instancing|지원하지/);
  }
});
function geometryDocument(nodeCount = 2, primitiveCount = 1) {
  return {
    asset: { version: "2.0" },
    accessors: [{ componentType: 5126, type: "VEC3", count: 3 }],
    meshes: [
      {
        primitives: Array.from({ length: primitiveCount }, () => ({
          attributes: { POSITION: 0 },
        })),
      },
    ],
    nodes: Array.from({ length: nodeCount }, () => ({ mesh: 0 })),
    scenes: [{ nodes: Array.from({ length: nodeCount }, (_, i) => i) }],
    scene: 0,
  };
}
test("fix2-geometry rejects the bounded 1000 by 1000 mesh expansion probe", () => {
  const bytes = glb(geometryDocument(1000, 1000));
  expect(bytes.length).toBeLessThan(60_000);
  expect(() => validateGlb(bytes)).toThrow(/4096|expansion/);
});
test("fix2-geometry counts mesh instances across every scene and unused definitions", () => {
  const base = geometryDocument(1, 1000);
  for (const document of [
    { ...base, scenes: Array.from({ length: 5 }, () => ({ nodes: [0] })) },
    {
      ...base,
      scenes: [],
      scene: undefined,
      nodes: Array.from({ length: 5 }, () => ({ mesh: 0 })),
    },
    {
      ...base,
      scenes: [],
      scene: undefined,
      nodes: [],
      meshes: Array(5).fill(base.meshes[0]),
    },
    { ...geometryDocument(0), nodes: Array.from({ length: 4097 }, () => ({})) },
    {
      ...geometryDocument(0),
      nodes: [{}],
      scenes: Array.from({ length: 4097 }, () => ({ nodes: [0] })),
    },
    {
      ...geometryDocument(0),
      meshes: Array(1025).fill(geometryDocument(0).meshes[0]),
    },
    {
      ...geometryDocument(0),
      nodes: Array.from({ length: 2049 }, () => ({})),
      scenes: Array.from({ length: 2 }, () => ({
        nodes: Array.from({ length: 2049 }, (_, i) => i),
      })),
    },
    {
      ...geometryDocument(1, 3000),
      meshes: [
        geometryDocument(1, 3000).meshes[0],
        geometryDocument(0, 1097).meshes[0],
      ],
    },
  ])
    expect(() => validateGlb(glb(document))).toThrow(/4096|1024|expansion/);
});
test("fix2-geometry permits small shared meshes under all aggregate work budgets", () => {
  const base = geometryDocument();
  for (const document of [
    base,
    { ...base, scenes: [{ nodes: [0, 1] }, { nodes: [0, 1] }] },
    { asset: base.asset },
    {
      asset: base.asset,
      meshes: base.meshes,
      accessors: base.accessors,
      nodes: base.nodes,
    },
  ])
    expect(() => validateGlb(glb(document))).not.toThrow();
});
test("structural maximum-count inputs still obey the independent metadata work budget", () => {
  // Keep the former positive inputs: count caps are ceilings, not exemptions
  // from the user-approved aggregate processing policy. Overflow guard tests
  // above still verify the original structural caps independently.
  for (const document of [
    geometryDocument(4096),
    geometryDocument(1, 4096),
    { ...geometryDocument(1, 2048), scenes: [{ nodes: [0] }, { nodes: [0] }] },
  ])
    expect(() => validateGlb(glb(document))).toThrow(
      /metadata.*processing|메타데이터/i,
    );
});
for (const reference of [true, false, null, -1, 0.5, "0", 99]) {
  test(`fix2-geometry rejects invalid graph and mesh references ${JSON.stringify(reference)}`, () => {
    const base = geometryDocument();
    for (const document of [
      { ...base, scene: reference },
      { ...base, nodes: [{ mesh: reference }] },
      { ...base, nodes: [{ children: [reference] }, {}] },
      { ...base, scenes: [{ nodes: [reference] }] },
      {
        ...base,
        meshes: [{ primitives: [{ attributes: { POSITION: reference } }] }],
      },
      {
        ...base,
        meshes: [
          { primitives: [{ attributes: { POSITION: 0 }, indices: reference }] },
        ],
      },
      {
        ...base,
        meshes: [
          {
            primitives: [
              {
                attributes: { POSITION: 0 },
                targets: [{ POSITION: reference }],
              },
            ],
          },
        ],
      },
    ])
      expect(() => validateGlb(glb(document))).toThrow(/reference|참조/);
  });
}
test("fix2-geometry rejects cycles, repeated children, multiple parents and nonroot scenes", () => {
  const base = geometryDocument();
  for (const nodes of [
    [{ children: [0] }],
    [{ children: [1] }, { children: [0] }],
    [{}, { children: [2] }, { children: [1] }],
    [{ children: [1, 1] }, {}],
    [{ children: [2] }, { children: [2] }, {}],
  ])
    expect(() =>
      validateGlb(glb({ ...base, nodes, scenes: [], scene: undefined })),
    ).toThrow(/graph|그래프/);
  expect(() =>
    validateGlb(
      glb({
        ...base,
        nodes: [{ children: [1] }, {}],
        scenes: [{ nodes: [1] }],
      }),
    ),
  ).toThrow(/graph|그래프/);
  expect(() =>
    validateGlb(glb({ ...base, scenes: [{ nodes: [0, 0] }] })),
  ).toThrow(/graph|그래프/);
});
test("fix2-geometry bounds graph depth even with reverse definition order and unused nodes", () => {
  for (const reverse of [false, true]) {
    for (const depth of [64, 65]) {
      const nodes = Array.from({ length: depth }, (_, i) => {
        const child = reverse ? i - 1 : i + 1;
        return child >= 0 && child < depth ? { children: [child] } : {};
      });
      const validate = () =>
        validateGlb(
          glb({ ...geometryDocument(0), nodes, scenes: [], scene: undefined }),
        );
      if (depth === 64) expect(validate).not.toThrow();
      else expect(validate).toThrow(/depth|64|깊/);
    }
  }
});
test("fix2-geometry rejects malformed graph containers and mesh definitions", () => {
  const base = geometryDocument();
  for (const document of [
    { ...base, nodes: null },
    { ...base, meshes: {} },
    { ...base, scenes: null },
    { ...base, nodes: [null] },
    { ...base, scenes: [null] },
    { ...base, meshes: [null] },
    { ...base, nodes: [{ children: null }] },
    { ...base, scenes: [{ nodes: null }] },
    { ...base, meshes: [{ primitives: null }] },
    { ...base, meshes: [{ primitives: [] }] },
    { ...base, meshes: [{ primitives: [null] }] },
    { ...base, meshes: [{ primitives: [{ attributes: null }] }] },
  ])
    expect(() => validateGlb(glb(document))).toThrow();
});
test("fix1-security GLB accessor allocation and byte layout bounds", () => {
  const base = { componentType: 5126, type: "VEC3", count: 1 };
  for (const accessor of [
    { ...base, count: 1_000_000_000 },
    { ...base, count: 0 },
    { ...base, count: 1.5 },
    { ...base, componentType: 999 },
    { ...base, type: "BAD" },
    { ...base, byteOffset: 1 },
    { ...base, bufferView: 0 },
  ])
    expect(() =>
      validateGlb(glb({ asset: { version: "2.0" }, accessors: [accessor] })),
    ).toThrow();
  const document = {
    asset: { version: "2.0" },
    buffers: [{ byteLength: 16 }],
    bufferViews: [{ buffer: 0, byteLength: 16 }],
    accessors: [{ ...base, bufferView: 0 }],
  };
  expect(() => validateGlb(glb(document, Buffer.alloc(16)))).not.toThrow();
  for (const change of [{ byteOffset: 2 }, { count: 2 }])
    expect(() =>
      validateGlb(
        glb(
          { ...document, accessors: [{ ...base, bufferView: 0, ...change }] },
          Buffer.alloc(16),
        ),
      ),
    ).toThrow();
  for (const stride of [2, 10, 256])
    expect(() =>
      validateGlb(
        glb(
          {
            ...document,
            bufferViews: [{ buffer: 0, byteLength: 16, byteStride: stride }],
          },
          Buffer.alloc(16),
        ),
      ),
    ).toThrow();
  expect(() =>
    validateGlb(
      glb({
        asset: { version: "2.0" },
        accessors: Array.from({ length: 6 }, () => ({
          ...base,
          count: 1_000_000,
        })),
      }),
    ),
  ).toThrow();
});
test("fix1-security GLB numeric offsets cannot be null or nonintegers", () => {
  for (const offset of [null, 0.5, -1, "0", true]) {
    const document = {
      asset: { version: "2.0" },
      buffers: [{ byteLength: 16 }],
      bufferViews: [{ buffer: 0, byteLength: 16 }],
      accessors: [
        { componentType: 5126, type: "VEC3", count: 1, byteOffset: offset },
      ],
    };
    expect(() => validateGlb(glb(document, Buffer.alloc(16)))).toThrow();
    expect(() =>
      validateGlb(
        glb(
          {
            ...document,
            accessors: [],
            bufferViews: [{ buffer: 0, byteLength: 16, byteOffset: offset }],
          },
          Buffer.alloc(16),
        ),
      ),
    ).toThrow();
  }
  expect(() =>
    validateGlb(glb({ asset: { version: "2.0" }, accessors: null })),
  ).toThrow();
});
test("fix1-security GLB sparse accessor indices and values are bounded", () => {
  const make = (sparse: unknown) =>
    glb(
      {
        asset: { version: "2.0" },
        buffers: [{ byteLength: 32 }],
        bufferViews: [
          { buffer: 0, byteLength: 4 },
          { buffer: 0, byteOffset: 4, byteLength: 28 },
        ],
        accessors: [{ componentType: 5126, type: "VEC3", count: 2, sparse }],
      },
      Buffer.alloc(32),
    );
  const sparse = {
    count: 1,
    indices: { bufferView: 0, componentType: 5121 },
    values: { bufferView: 1 },
  };
  expect(() => validateGlb(make(sparse))).not.toThrow();
  for (const bad of [
    { ...sparse, count: 3 },
    { ...sparse, indices: { bufferView: 0, componentType: 5126 } },
    { ...sparse, values: { bufferView: 1, byteOffset: 20 } },
    { ...sparse, count: 2 },
  ])
    expect(() => validateGlb(make(bad))).toThrow();
  const out = make(sparse);
  out[out.length - 32] = 2;
  expect(() => validateGlb(out)).toThrow();
});
function realPng(width: number, height: number): Buffer {
  const chunk = (kind: string, body: Buffer) => {
    const typed = Buffer.concat([Buffer.from(kind), body]);
    const stored = Buffer.from(zipSync({ x: typed }, { level: 0 }));
    const header = Buffer.alloc(4),
      crc = Buffer.alloc(4);
    header.writeUInt32BE(body.length);
    crc.writeUInt32BE(stored.readUInt32LE(14));
    return Buffer.concat([header, typed, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    png.subarray(0, 8),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.alloc((width * 4 + 1) * height))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
function imageGlb(
  image: Buffer,
  mimeType = "image/png",
  count = 1,
  dataBuffer = false,
) {
  const binary = Buffer.concat([
    Buffer.alloc(4),
    image,
    Buffer.alloc((4 - (image.length % 4)) % 4),
  ]);
  const document = {
    asset: { version: "2.0" },
    buffers: [
      {
        byteLength: binary.length,
        ...(dataBuffer
          ? {
              uri: `data:application/octet-stream;base64,${binary.toString("base64")}`,
            }
          : {}),
      },
    ],
    bufferViews: [{ buffer: 0, byteOffset: 4, byteLength: image.length }],
    images: Array.from({ length: count }, () => ({ bufferView: 0, mimeType })),
  };
  return glb(document, dataBuffer ? undefined : binary);
}
test("fix1-security GLB embedded images validate exact bytes, MIME and aggregate pixels", () => {
  for (const dataBuffer of [false, true]) {
    expect(() =>
      validateGlb(imageGlb(png, "image/png", 1, dataBuffer)),
    ).not.toThrow();
    for (const image of [
      Buffer.from("abcd"),
      png.subarray(0, 24),
      realPng(9000, 1),
    ])
      expect(() =>
        validateGlb(imageGlb(image, "image/png", 1, dataBuffer)),
      ).toThrow();
  }
  expect(() => validateGlb(imageGlb(png, "image/jpeg"))).toThrow();
  expect(() => validateGlb(imageGlb(png, "image/png", 61))).toThrow();
  expect(() =>
    validateGlb(imageGlb(realPng(2000, 1000), "image/png", 21)),
  ).toThrow();
});
test("fix1-security existing small preview models remain valid without rewriting", async () => {
  const fs = await import("node:fs/promises");
  for (const name of ["jd017_e_web.glb", "jd019_b_web.glb"]) {
    const bytes = await fs.readFile(`public/images/glb/${name}`);
    expect(() => validateGlb(bytes)).not.toThrow();
  }
});
test("GLB validates binary buffer bounds and rejects any URI or decoder", () => {
  expect(() =>
    validateGlb(
      glb(
        { asset: { version: "2.0" }, buffers: [{ byteLength: 16 }] },
        new Uint8Array(4),
      ),
    ),
  ).toThrow();
  expect(() =>
    validateGlb(
      glb({
        asset: { version: "2.0" },
        images: [{ uri: "data:image/png;base64,a" }],
      }),
    ),
  ).toThrow();
  expect(() =>
    validateGlb(
      glb({
        asset: { version: "2.0" },
        extensionsRequired: ["KHR_draco_mesh_compression"],
      }),
    ),
  ).toThrow();
  expect(() =>
    validateGlb(
      glb(
        {
          asset: { version: "2.0" },
          buffers: [{ byteLength: 4 }],
          bufferViews: [{ buffer: 0, byteOffset: 3, byteLength: 4 }],
        },
        new Uint8Array(4),
      ),
    ),
  ).toThrow();
  expect(() =>
    validateGlb(
      glb(
        { asset: { version: "2.0" }, buffers: [{ byteLength: 4 }] },
        new Uint8Array(4),
      ),
    ),
  ).not.toThrow();
});
test("GLB allows only supported, valid base64 data resources and never external URIs", () => {
  expect(() =>
    validateGlb(
      glb({
        asset: { version: "2.0" },
        images: [{ uri: `data:image/png;base64,${png.toString("base64")}` }],
      }),
    ),
  ).not.toThrow();
  expect(() =>
    validateGlb(
      glb({
        asset: { version: "2.0" },
        buffers: [
          {
            byteLength: 4,
            uri: "data:application/octet-stream;base64,AAAAAA==",
          },
        ],
      }),
    ),
  ).not.toThrow();
  for (const uri of [
    "https://example.com/a.png",
    "file:///a.png",
    "data:image/svg+xml;base64,PHN2Zy8+",
    "data:image/png;base64,???",
  ])
    expect(() =>
      validateGlb(glb({ asset: { version: "2.0" }, images: [{ uri }] })),
    ).toThrow();
});
test("compressible GLB may exceed ZIP byte limit when total original bytes stay under 50MiB", async () => {
  const { manifest, files } = await fixture();
  const binary = new Uint8Array(26 * 1024 * 1024);
  const result = await inspectAsset(
    new File(
      [
        glb(
          {
            asset: { version: "2.0" },
            buffers: [{ byteLength: binary.length }],
          },
          binary,
        ),
      ],
      "large.glb",
    ),
    "model",
  );
  manifest.models = ["model"];
  manifest.assets.push(result.asset);
  files.set("model", result.blob);
  const output = await createPackage(manifest, files);
  expect(output.size).toBeLessThan(25 * 1024 * 1024);
  const restored = await readPackage(new File([output], "jd046.zip"));
  expect(restored.files.get("model")!.size).toBe(result.blob.size);
});
test("size headers reject 40MP+ images before reading the full file", async () => {
  const header = Buffer.from(png);
  header.writeUInt32BE(8192, 16);
  header.writeUInt32BE(8192, 20);
  let fullRead = false;
  const file = new File([header], "giant.png");
  file.arrayBuffer = async () => {
    fullRead = true;
    throw new Error("must not read");
  };
  await expect(inspectAsset(file, "giant")).rejects.toThrow(/40MP/);
  expect(fullRead).toBe(false);
});
test("legacy collisions block export but CMS updates retain their ID", async () => {
  const { manifest, files } = await fixture();
  await expect(createPackage(manifest, files, ["jd046"])).rejects.toThrow(
    /레거시/,
  );
  const output = await createPackage(manifest, files, ["jd001"]);
  expect(
    (await readPackage(new File([output], "jd046.zip"))).manifest.project.id,
  ).toBe("jd046");
});
test("reject ZIP CRC tampering and duplicate JSON keys", async () => {
  const { manifest, files } = await fixture();
  const blob = await createPackage(manifest, files);
  const data = Buffer.from(await blob.arrayBuffer());
  const central = data.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  data[central + 16] ^= 1;
  await expect(readPackage(new File([data], "jd046.zip"))).rejects.toThrow(
    /CRC/,
  );
  const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  entries["project.json"] = Buffer.from(
    JSON.stringify(manifest).replace(
      '"schemaVersion":1',
      '"schemaVersion":1,"schemaVersion":1',
    ),
  );
  await expect(
    readPackage(new File([zipSync(entries)], "jd046.zip")),
  ).rejects.toThrow(/JSON/);
});
test("a valid asset generates a real importable QA packet", async () => {
  const { manifest, files } = await fixture();
  const blob = await createPackage(manifest, files);
  if (process.env.ADMIN_QA_DIR) {
    const fs = await import("node:fs/promises");
    await fs.mkdir(process.env.ADMIN_QA_DIR, { recursive: true });
    await fs.writeFile(
      `${process.env.ADMIN_QA_DIR}/package-jd046.zip`,
      Buffer.from(await blob.arrayBuffer()),
    );
  }
  expect(blob.size).toBeGreaterThan(png.length);
});

test("reject wrong checksum, file extension, empty image blocks, traversal and extra ZIP entries", async () => {
  const { manifest, files } = await fixture();
  await expect(
    inspectAsset(new File([png], "wrong.jpg"), "wrong"),
  ).rejects.toThrow(/확장자/);
  await expect(
    createPackage(
      {
        ...manifest,
        assets: [{ ...manifest.assets[0], sha256: "0".repeat(64) }],
      },
      files,
    ),
  ).rejects.toThrow(/체크섬/);
  expect(() =>
    validatePackage({
      ...manifest,
      blocks: [{ id: "empty", type: "images", columns: 1, images: [] }],
    }),
  ).toThrow(/1~12/);
  const blob = await createPackage(manifest, files);
  const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  await expect(
    readPackage(
      new File([zipSync({ ...entries, "../evil.png": png })], "jd046.zip"),
    ),
  ).rejects.toThrow(/경로/);
  await expect(
    readPackage(
      new File(
        [zipSync({ ...entries, "assets/unused.png": png })],
        "jd046.zip",
      ),
    ),
  ).rejects.toThrow(/참조되지/);
  await expect(readPackage(new File([blob], "jd047.zip"))).rejects.toThrow(
    /파일명/,
  );
});
