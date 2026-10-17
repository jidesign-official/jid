import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { zipSync } from "fflate";
import {
  inspectAsset,
  readPackage,
  validateGlb,
} from "../../src/lib/admin/package";
import type { AdminPackage } from "../../src/lib/admin/types";

// All exhaustion probes are validator-only: never import a loader or use a GPU.
function staticDocument() {
  return {
    asset: { version: "2.0" },
    accessors: [
      {
        componentType: 5126,
        type: "VEC3",
        count: 3,
        min: [0, 0, 0],
        max: [0, 0, 0],
      },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    nodes: [{ mesh: 0 }, { mesh: 0 }],
    scenes: [{ nodes: [0, 1] }],
    scene: 0,
  };
}
function glb(document: unknown, binary?: Buffer): Buffer {
  const json = Buffer.from(JSON.stringify(document));
  const padded = Buffer.concat([json, Buffer.alloc(-json.length & 3, 32)]);
  const header = Buffer.alloc(20);
  header.write("glTF");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(
    20 + padded.length + (binary ? 8 + binary.length : 0),
    8,
  );
  header.writeUInt32LE(padded.length, 12);
  header.write("JSON", 16);
  if (!binary) return Buffer.concat([header, padded]);
  const chunk = Buffer.alloc(8);
  chunk.writeUInt32LE(binary.length);
  chunk.write("BIN\0", 4);
  return Buffer.concat([header, padded, chunk, binary]);
}
function animationProbe(): Buffer {
  const base = staticDocument();
  return glb({
    ...base,
    accessors: [
      ...base.accessors,
      { componentType: 5126, type: "SCALAR", count: 999999 },
      { componentType: 5122, type: "VEC4", count: 999999, normalized: true },
    ],
    animations: [
      {
        samplers: [{ input: 1, output: 2 }],
        channels: Array.from({ length: 256 }, () => ({
          sampler: 0,
          target: { node: 0, path: "rotation" },
        })),
      },
    ],
  });
}
function smallAnimation(): Buffer {
  const base = staticDocument();
  const binary = Buffer.alloc(32);
  binary.writeFloatLE(1, 4); // Two genuine times and translation keyframes.
  binary.writeFloatLE(1, 20);
  return glb(
    {
      ...base,
      buffers: [{ byteLength: 32 }],
      bufferViews: [
        { buffer: 0, byteLength: 8 },
        { buffer: 0, byteOffset: 8, byteLength: 24 },
      ],
      accessors: [
        ...base.accessors,
        {
          bufferView: 0,
          componentType: 5126,
          type: "SCALAR",
          count: 2,
          min: [0],
          max: [1],
        },
        { bufferView: 1, componentType: 5126, type: "VEC3", count: 2 },
      ],
      animations: [
        {
          samplers: [{ input: 1, output: 2 }],
          channels: [{ sampler: 0, target: { node: 0, path: "translation" } }],
        },
      ],
    },
    binary,
  );
}
async function packageFile(model: Buffer): Promise<File> {
  // Same valid cover/manifest + ZIP builder pattern as admin-package.spec.ts.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==",
    "base64",
  );
  const cover = await inspectAsset(new File([png], "cover.png"), "cover");
  const manifest: AdminPackage = {
    schemaVersion: 1,
    project: {
      id: "jd046",
      title: "Static policy",
      category: "Product",
      thumbnail: "cover",
    },
    blocks: [],
    models: ["model"],
    assets: [
      cover.asset,
      {
        id: "model",
        path: "assets/model.glb",
        name: "model.glb",
        kind: "model",
        bytes: model.length,
        sha256: createHash("sha256").update(model).digest("hex"),
      },
    ],
  };
  return new File(
    [
      Uint8Array.from(
        zipSync({
          "project.json": Buffer.from(JSON.stringify(manifest)),
          [cover.asset.path]: png,
          "assets/model.glb": model,
        }),
      ),
    ],
    "jd046.zip",
  );
}

test("static policy rejects normalized animation amplification before loading", () => {
  const data = animationProbe();
  expect(data.length).toBeLessThan(25000);
  expect(() => validateGlb(data)).toThrow(/animation|애니메이션/i);
});
test("static policy rejects genuine small animation through validator", () => {
  expect(() => validateGlb(smallAnimation())).toThrow(/animation|애니메이션/i);
});
test("static policy inspectAsset rejects genuine small animation", async () => {
  await expect(
    inspectAsset(
      new File([Uint8Array.from(smallAnimation())], "animated.glb"),
      "model",
    ),
  ).rejects.toThrow(/animation|애니메이션/i);
});
test("static policy readPackage rejects genuine small animation", async () => {
  const packet = await packageFile(smallAnimation());
  expect(packet.size).toBeLessThan(5000);
  await expect(readPackage(packet)).rejects.toThrow(/animation|애니메이션/i);
});
for (const value of [null, {}, 0, false, "", [{}]]) {
  test(`static policy rejects present animations ${JSON.stringify(value)}`, () => {
    expect(() =>
      validateGlb(glb({ ...staticDocument(), animations: value })),
    ).toThrow(/animation|애니메이션/i);
  });
}
test("static policy accepts absent and empty animation metadata", () => {
  for (const document of [
    staticDocument(),
    { ...staticDocument(), animations: [] },
    { asset: { version: "2.0" }, animations: [] },
  ])
    expect(() => validateGlb(glb(document))).not.toThrow();
});

for (const value of [null, {}, 0, false, "", [{}], [{ joints: [0] }]]) {
  test(`static policy rejects present skins ${JSON.stringify(value)}`, () => {
    expect(() =>
      validateGlb(glb({ ...staticDocument(), skins: value })),
    ).toThrow(/skin|스킨|스켈레톤/i);
  });
}
for (const value of [0, null, false, {}, [], "0"]) {
  test(`static policy rejects any node.skin property ${JSON.stringify(value)}`, () => {
    const base = staticDocument();
    for (const scenes of [[{ nodes: [0] }], [{ nodes: [0] }, { nodes: [1] }]]) {
      const document = {
        ...base,
        nodes: [{ mesh: 0 }, { mesh: 0, skin: value }],
        scenes,
      };
      expect(() => validateGlb(glb(document))).toThrow(/skin|스킨|스켈레톤/i);
    }
  });
}
test("static policy skin definitions and undeclared node.skin fail inspectAsset and readPackage", async () => {
  for (const document of [
    { ...staticDocument(), skins: [{ joints: [0] }] },
    { ...staticDocument(), nodes: [{ mesh: 0, skin: 0 }, { mesh: 0 }] },
  ]) {
    const data = glb(document);
    await expect(
      inspectAsset(new File([Uint8Array.from(data)], "skinned.glb"), "model"),
    ).rejects.toThrow(/skin|스킨|스켈레톤/i);
    await expect(readPackage(await packageFile(data))).rejects.toThrow(
      /skin|스킨|스켈레톤/i,
    );
  }
});
test("static policy accepts empty skin and animation lists with static shared meshes", async () => {
  const data = glb({ ...staticDocument(), animations: [], skins: [] });
  expect(() => validateGlb(data)).not.toThrow();
  const restored = await readPackage(await packageFile(data));
  expect(Buffer.from(await restored.files.get("model")!.arrayBuffer())).toEqual(
    data,
  );
});

for (const value of [[0], [1], null, {}, 0, false, ""]) {
  test(`static policy rejects node and mesh weights ${JSON.stringify(value)}`, () => {
    const base = staticDocument();
    for (const document of [
      {
        ...base,
        nodes: [{ mesh: 0 }, { mesh: 0, weights: value }],
        scenes: [{ nodes: [0] }],
      },
      {
        ...base,
        nodes: [{ mesh: 0 }, { mesh: 0, weights: value }],
        scenes: [{ nodes: [0] }, { nodes: [1] }],
      },
      {
        ...base,
        meshes: [...base.meshes, { ...base.meshes[0], weights: value }],
      },
    ])
      expect(() => validateGlb(glb(document))).toThrow(/weights|가중치/i);
  });
}
function attributeDocuments(semantic: string) {
  const base = staticDocument();
  const primitive = { attributes: { POSITION: 0, [semantic]: 1 } };
  const accessors = [
    ...base.accessors,
    {
      componentType: semantic.startsWith("JOINTS_") ? 5123 : 5126,
      type: "VEC4",
      count: 3,
    },
  ];
  return [
    { ...base, accessors, meshes: [{ primitives: [primitive] }] },
    {
      ...base,
      accessors,
      meshes: [...base.meshes, { primitives: [primitive] }],
    },
    {
      ...base,
      accessors,
      meshes: [{ primitives: [...base.meshes[0].primitives, primitive] }],
    },
    {
      ...base,
      accessors,
      meshes: [...base.meshes, { primitives: [primitive] }],
      nodes: [{ mesh: 0 }, { mesh: 1 }],
      scenes: [{ nodes: [0] }, { nodes: [1] }],
    },
  ];
}
for (const semantic of [
  "JOINTS_0",
  "WEIGHTS_0",
  "JOINTS_1",
  "WEIGHTS_7",
  "JOINTS_custom",
  "WEIGHTS_",
]) {
  test(`static policy rejects undeclared ${semantic} across all primitive definitions`, () => {
    for (const document of attributeDocuments(semantic))
      expect(() => validateGlb(glb(document))).toThrow(
        /JOINTS_|WEIGHTS_|스켈레톤/i,
      );
  });
}
test("static policy rejects weight and joint metadata through inspectAsset and readPackage", async () => {
  for (const document of [
    { ...staticDocument(), nodes: [{ mesh: 0, weights: [0] }, { mesh: 0 }] },
    {
      ...staticDocument(),
      meshes: [{ ...staticDocument().meshes[0], weights: [0] }],
    },
    attributeDocuments("JOINTS_0")[2],
    attributeDocuments("WEIGHTS_0")[1],
  ]) {
    const data = glb(document);
    await expect(
      inspectAsset(
        new File([Uint8Array.from(data)], "deformation.glb"),
        "model",
      ),
    ).rejects.toThrow(/weights|JOINTS_|WEIGHTS_|가중치|스켈레톤/i);
    await expect(readPackage(await packageFile(data))).rejects.toThrow(
      /weights|JOINTS_|WEIGHTS_|가중치|스켈레톤/i,
    );
  }
});
test("static policy accepts only empty weights and targets on static shared meshes", async () => {
  const base = staticDocument();
  const data = glb({
    ...base,
    animations: [],
    skins: [],
    nodes: base.nodes.map((node) => ({ ...node, weights: [] })),
    meshes: [
      {
        weights: [],
        primitives: [
          {
            attributes: { POSITION: 0, _JOINTS_0: 0, COLOR_0: 0 },
            targets: [],
          },
        ],
      },
    ],
  });
  expect(() => validateGlb(data)).not.toThrow();
  const restored = await readPackage(await packageFile(data));
  expect(Buffer.from(await restored.files.get("model")!.arrayBuffer())).toEqual(
    data,
  );
});
test("static policy preserves rejection of nonempty and malformed morph targets everywhere", () => {
  for (const targets of [[{ POSITION: 0 }], null, {}, 0, false]) {
    const base = staticDocument();
    for (const meshes of [
      [
        ...base.meshes,
        { primitives: [{ attributes: { POSITION: 0 }, targets }] },
      ],
      [
        {
          primitives: [
            ...base.meshes[0].primitives,
            { attributes: { POSITION: 0 }, targets },
          ],
        },
      ],
    ])
      expect(() => validateGlb(glb({ ...base, meshes }))).toThrow(
        /morph|모프/i,
      );
  }
});

// Integration owner runs this only after rebuilding; never upload the probe.
test("static policy browser upload recovery rejects animation and skin then accepts a static model", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/admin/`);
  const upload = page.getByLabel("3D 모델 업로드");
  const alert = page.locator("[data-admin-shell]").getByRole("alert");
  for (const [name, buffer, policy] of [
    ["unsupported-animation.glb", smallAnimation(), /animations/i],
    [
      "unsupported-skin.glb",
      glb({ ...staticDocument(), skins: [{ joints: [0] }] }),
      /skins/i,
    ],
  ] as const) {
    await expect(upload).toBeEnabled();
    await upload.setInputFiles({ name, mimeType: "model/gltf-binary", buffer });
    await expect(alert).toContainText(policy);
    await expect(page.getByText(name, { exact: true })).toHaveCount(0);
  }
  await upload.setInputFiles("public/images/glb/jd017_e_web.glb");
  await expect(
    page.getByText("jd017_e_web.glb", { exact: true }),
  ).toBeVisible();
  await expect(alert).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("static policy keeps real static originals unchanged", async () => {
  for (const name of ["jd017_e_web.glb", "jd019_b_web.glb"]) {
    const path = `public/images/glb/${name}`;
    const before = await fs.readFile(path);
    expect(() => validateGlb(before)).not.toThrow();
    const result = await inspectAsset(new File([before], name), "model");
    expect(Buffer.from(await result.blob.arrayBuffer())).toEqual(before);
    expect(await fs.readFile(path)).toEqual(before);
  }
});
