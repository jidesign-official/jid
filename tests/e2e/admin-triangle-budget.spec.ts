import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { zipSync } from "fflate";
import {
  createPackage,
  inspectAsset,
  readPackage,
  validateGlb,
} from "../../src/lib/admin/package";
import type { AdminPackage } from "../../src/lib/admin/types";

// Exhaustion probes are JSON-only, validator/package-only: never loader/GPU input.
const LIMIT = 64 * 1024 * 1024;
const QA = "/mnt/hermes/backups/jid-admin-20261016T132643Z";
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Intentionally mutable untrusted JSON fixtures.
type Document = Record<string, any>;
function document(count = 3, kind = "VEC3", componentType = 5126): Document {
  return {
    asset: { version: "2.0" },
    accessors: [{ componentType, type: kind, count }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };
}
function glb(root: Document, binary?: Buffer): Buffer {
  const json = Buffer.from(JSON.stringify(root));
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
function probe(mode = 4): Buffer {
  const root = document(999999);
  root.meshes[0].primitives = Array.from({ length: 256 }, (_, i) => ({
    mode,
    attributes: { POSITION: 0, [`_STATIC_${i}`]: 0 },
  }));
  return glb(root);
}
const cover = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==",
  "base64",
);
async function packet(data: Buffer) {
  const image = await inspectAsset(new File([cover], "cover.png"), "cover");
  const manifest: AdminPackage = {
    schemaVersion: 1,
    project: {
      id: "jd046",
      title: "Triangle budget",
      category: "Product",
      thumbnail: "cover",
    },
    blocks: [],
    models: ["model"],
    assets: [
      image.asset,
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
    ["cover", image.blob],
    ["model", new Blob([Uint8Array.from(data)])],
  ]);
  const raw = zipSync({
    "project.json": Buffer.from(JSON.stringify(manifest)),
    [image.asset.path]: cover,
    "assets/model.glb": data,
  });
  return {
    manifest,
    files,
    file: new File([Uint8Array.from(raw)], "jd046.zip"),
  };
}
for (const mode of [5, 6]) {
  test(`TRIANGLES-only rejects mode ${mode} conversion probe before loading`, () => {
    const data = probe(mode);
    expect(data.length).toBeLessThan(25000);
    expect(() => validateGlb(data)).toThrow(/TRIANGLES|삼각형/i);
  });
}
for (const mode of [
  0,
  1,
  2,
  3,
  5,
  6,
  null,
  false,
  true,
  "4",
  4.5,
  -1,
  7,
  {},
  [],
]) {
  test(`TRIANGLES-only rejects present mode ${JSON.stringify(mode)} in all definitions`, () => {
    const base = document();
    const bad = { mode, attributes: { POSITION: 0 } };
    for (const meshes of [
      [{ primitives: [bad] }],
      [{ primitives: [...base.meshes[0].primitives, bad] }],
      [...base.meshes, { primitives: [bad] }],
    ])
      expect(() => validateGlb(glb({ ...base, meshes }))).toThrow(
        /TRIANGLES|삼각형/i,
      );
  });
}
for (const token of ["4.0", "4e0", "4.00000000000000001"]) {
  test(`TRIANGLES-only rejects raw floating mode token ${token} even when JS rounds to4`, () => {
    for (const placement of ["first", "later", "unused", "nondefault"]) {
      const root = document();
      const bad = { mode: "RAW_MODE", attributes: { POSITION: 0 } };
      if (placement === "first") root.meshes[0].primitives = [bad];
      else if (placement === "later") root.meshes[0].primitives.push(bad);
      else {
        root.meshes.push({ primitives: [bad] });
        if (placement === "nondefault") {
          root.nodes.push({ mesh: 1 });
          root.scenes.push({ nodes: [1] });
        }
      }
      const json = JSON.stringify(root)
        .replace('"RAW_MODE"', token)
        .replace('"mode":', '"m\\u006fde":');
      const data = glb(root);
      const padded = Buffer.from(
        json.padEnd(Math.ceil(Buffer.byteLength(json) / 4) * 4, " "),
      );
      const header = Buffer.from(data.subarray(0, 20));
      header.writeUInt32LE(20 + padded.length, 8);
      header.writeUInt32LE(padded.length, 12);
      expect(() => validateGlb(Buffer.concat([header, padded]))).toThrow(
        /TRIANGLES/,
      );
    }
  });
}
test("primitive lexical mode restriction does not inspect unrelated metadata", () => {
  const root = document();
  root.extras = { mode: 4.5, meshes: [{ primitives: [{ mode: 5 }] }] };
  root["meshes[].primitives"] = [{ mode: 4.5 }];
  root.meshes[0].primitives[0].extras = { mode: 6 };
  expect(() => validateGlb(glb(root))).not.toThrow();
});
test("TRIANGLES-only permits default4 and explicit4 shared static meshes", () => {
  for (const mode of [undefined, 4]) {
    const root = document();
    root.meshes[0].primitives[0].mode = mode;
    root.nodes.push({ mesh: 0 });
    root.scenes.push({ nodes: [0, 1] });
    expect(() => validateGlb(glb(root))).not.toThrow();
  }
});

test("reference definitions reject mode4 repeated-accessor 256 unique-attribute primitives", async () => {
  const data = probe(4);
  expect(data.length).toBeLessThan(25000);
  expect(() => validateGlb(data)).toThrow(/referenced geometry|참조 처리량/i);
  await expect(
    inspectAsset(new File([Uint8Array.from(data)], "probe.glb"), "model"),
  ).rejects.toThrow(/referenced geometry|참조 처리량/i);
  const input = await packet(data);
  await expect(createPackage(input.manifest, input.files)).rejects.toThrow(
    /referenced geometry|참조 처리량/i,
  );
  await expect(readPackage(input.file)).rejects.toThrow(
    /referenced geometry|참조 처리량/i,
  );
});
function definitions(root: Document): Document {
  const result = { ...root };
  delete result.nodes;
  delete result.scenes;
  delete result.scene;
  return result;
}
test("reference definitions charge custom aliases and index references at exact64MiB and one element over", () => {
  for (const indices of [false, true]) {
    const root = definitions(document(LIMIT / 8, "SCALAR", 5121));
    root.meshes[0].primitives = [
      {
        attributes: { POSITION: 0 },
        ...(indices
          ? { indices: 0 }
          : { attributes: { POSITION: 0, _ALIAS: 0 } }),
      },
    ];
    expect(() => validateGlb(glb(root))).not.toThrow(); // 2 × count × max(1,4)
    root.accessors.push({ componentType: 5123, type: "SCALAR", count: 1 });
    root.meshes[0].primitives.push({ attributes: { _ONE_MORE: 1 } });
    expect(() => validateGlb(glb(root))).toThrow(
      /referenced geometry|참조 처리량/i,
    ); // +4, minimum work unit
  }
});
test("reference definitions sum every unused mesh without deduplicating shared accessors", () => {
  const root = definitions(document(LIMIT / 8, "SCALAR"));
  root.meshes.push(root.meshes[0]);
  expect(() => validateGlb(glb(root))).not.toThrow();
  root.meshes.push(root.meshes[0]);
  expect(() => validateGlb(glb(root))).toThrow(
    /referenced geometry|참조 처리량/i,
  );
});
for (const [kind, components] of [
  ["SCALAR", 1],
  ["VEC2", 2],
  ["VEC3", 3],
  ["VEC4", 4],
  ["MAT2", 4],
  ["MAT3", 9],
  ["MAT4", 16],
] as const) {
  test(`reference definitions use full ${kind} component count and four-byte floor`, () => {
    for (const componentType of [5120, 5121, 5122, 5123, 5125, 5126]) {
      const count = Math.floor(LIMIT / (components * 4 * 2));
      const root = definitions(document(count, kind, componentType));
      root.meshes[0].primitives[0].attributes._ALIAS = 0;
      expect(() => validateGlb(glb(root))).not.toThrow();
      root.accessors[0].count++;
      expect(() => validateGlb(glb(root))).toThrow(
        /referenced geometry|참조 처리량/i,
      );
    }
  });
}
function expandedCases(): [string, Document][] {
  const base = document(999999);
  const nodes = Array.from({ length: 7 }, () => ({ mesh: 0 }));
  return [
    [
      "shared mesh nodes",
      { ...base, nodes, scenes: [{ nodes: nodes.map((_, i) => i) }] },
    ],
    [
      "shared root across scenes",
      { ...base, scenes: Array.from({ length: 7 }, () => ({ nodes: [0] })) },
    ],
    [
      "nondefault scene",
      {
        ...base,
        nodes,
        scenes: [{ nodes: [] }, { nodes: nodes.map((_, i) => i) }],
      },
    ],
    ["unused trees", { ...base, nodes, scenes: [{ nodes: [] }] }],
    ["no scenes", { ...definitions(base), nodes }],
    ["empty scenes", { ...definitions(base), nodes, scenes: [] }],
    [
      "memoized reverse subtree",
      {
        ...base,
        nodes: [...nodes, { children: nodes.map((_, i) => i) }],
        scenes: [{ nodes: [7] }],
      },
    ],
  ];
}
for (const [name, root] of expandedCases()) {
  test(`reference expansion rejects ${name} without decoding geometry`, async () => {
    const data = glb(root);
    expect(data.length).toBeLessThan(5000);
    expect(() => validateGlb(data)).toThrow(/참조 처리량/);
    await expect(
      inspectAsset(new File([Uint8Array.from(data)], "expanded.glb"), "model"),
    ).rejects.toThrow(/참조 처리량/);
    const input = await packet(data);
    await expect(createPackage(input.manifest, input.files)).rejects.toThrow(
      /참조 처리량/,
    );
    await expect(readPackage(input.file)).rejects.toThrow(/참조 처리량/);
  });
}
test("reference expansion exact64MiB does not re-add definitions and rejects one additional scalar element", () => {
  for (const placement of ["scene", "unused tree", "unused mesh"] as const) {
    const root = document(LIMIT / 8, "SCALAR");
    root.nodes.push({ mesh: 0 });
    root.scenes[0].nodes.push(1);
    expect(() => validateGlb(glb(root))).not.toThrow(); // 32MiB definition; 64MiB instances.
    root.accessors.push({ componentType: 5121, type: "SCALAR", count: 1 });
    root.meshes.push({ primitives: [{ attributes: { _EXTRA: 1 } }] });
    if (placement !== "unused mesh") {
      root.nodes.push({ mesh: 1 });
      if (placement === "scene") root.scenes.push({ nodes: [2] });
    }
    expect(() => validateGlb(glb(root))).toThrow(/참조 처리량/); // 67,108,868: +4 work bytes.
  }
});

function smallTopology(mode?: number): Buffer {
  const root = document(4);
  const binary = Buffer.alloc(48);
  [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0].forEach((value, i) =>
    binary.writeFloatLE(value, i * 4),
  );
  root.buffers = [{ byteLength: binary.length }];
  root.bufferViews = [{ buffer: 0, byteLength: binary.length }];
  root.accessors[0] = {
    ...root.accessors[0],
    bufferView: 0,
    min: [0, 0, 0],
    max: [1, 1, 0],
  };
  root.meshes[0].primitives[0].mode = mode;
  return glb(root, binary);
}
for (const mode of [5, 6]) {
  test(`small real mode${mode} rejected by direct validate, inspectAsset, createPackage and readPackage`, async () => {
    const data = smallTopology(mode);
    expect(data.length).toBeLessThan(1000);
    expect(() => validateGlb(data)).toThrow(/TRIANGLES/);
    await expect(
      inspectAsset(new File([Uint8Array.from(data)], "small.glb"), "model"),
    ).rejects.toThrow(/TRIANGLES/);
    const input = await packet(data);
    await expect(createPackage(input.manifest, input.files)).rejects.toThrow(
      /TRIANGLES/,
    );
    await expect(readPackage(input.file)).rejects.toThrow(/TRIANGLES/);
  });
}
test("small static/default4 shared geometry round trips through all package entrypoints", async () => {
  for (const mode of [undefined, 4]) {
    const root = document();
    root.meshes[0].primitives[0] = {
      mode,
      attributes: { POSITION: 0, _CUSTOM: 0 },
      targets: [],
    };
    root.nodes.push({ mesh: 0 });
    root.scenes.push({ nodes: [0, 1] });
    const data = glb(root);
    const inspected = await inspectAsset(
      new File([Uint8Array.from(data)], "shared.glb"),
      "model",
    );
    expect(Buffer.from(await inspected.blob.arrayBuffer())).toEqual(data);
    const input = await packet(data);
    const exported = await createPackage(input.manifest, input.files);
    for (const file of [input.file, new File([exported], "jd046.zip")]) {
      const restored = await readPackage(file);
      expect(
        Buffer.from(await restored.files.get("model")!.arrayBuffer()),
      ).toEqual(data);
    }
  }
});
test("real static originals remain accepted read-only through all entrypoints", async () => {
  for (const name of ["jd017_e_web.glb", "jd019_b_web.glb"]) {
    const path = `public/images/glb/${name}`;
    const before = await fs.readFile(path);
    expect(() => validateGlb(before)).not.toThrow();
    const inspected = await inspectAsset(new File([before], name), "model");
    expect(Buffer.from(await inspected.blob.arrayBuffer())).toEqual(before);
    const input = await packet(before);
    const exported = await createPackage(input.manifest, input.files);
    expect(
      Buffer.from(
        await (await readPackage(new File([exported], "jd046.zip"))).files
          .get("model")!
          .arrayBuffer(),
      ),
    ).toEqual(before);
    expect(await fs.readFile(path)).toEqual(before);
  }
});
test("six browser QA packages remain accepted read-only", async () => {
  const artifactDirectory = await fs
    .stat(`${QA}/browser-packages`)
    .catch(() => undefined);
  test.skip(
    !artifactDirectory?.isDirectory(),
    "External browser QA artifacts are absent in this checkout",
  );
  for (const project of ["chromium", "Mobile-Chrome", "Mobile-Safari"]) {
    for (const id of ["jd996", "jd997"]) {
      const path = `${QA}/browser-packages/${project}/${id}.zip`;
      const before = await fs.readFile(path);
      const restored = await readPackage(new File([before], `${id}.zip`));
      expect(restored.manifest.project.id).toBe(id);
      for (const asset of restored.manifest.assets) {
        const data = Buffer.from(
          await restored.files.get(asset.id)!.arrayBuffer(),
        );
        expect(createHash("sha256").update(data).digest("hex")).toBe(
          asset.sha256,
        );
      }
      expect(await fs.readFile(path)).toEqual(before);
    }
  }
});

// Parent runs this after rebuilding. Upload ONLY tiny genuine strip/fan files,
// never any reference-amplification probe, then recover with the real static GLB.
test("triangle budget browser SMALL strip/fan rejection then real static recovery", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/admin/`);
  const upload = page.getByLabel("3D 모델 업로드");
  const alert = page.locator("[data-admin-shell]").getByRole("alert");
  for (const mode of [5, 6]) {
    const name = `small-${mode === 5 ? "strip" : "fan"}.glb`;
    const buffer = smallTopology(mode);
    expect(buffer.length).toBeLessThan(1000);
    await expect(upload).toBeEnabled();
    await upload.setInputFiles({ name, mimeType: "model/gltf-binary", buffer });
    await expect(alert).toContainText(/TRIANGLES/);
    await expect(page.getByText(name, { exact: true })).toHaveCount(0);
  }
  await expect(upload).toBeEnabled();
  await upload.setInputFiles("public/images/glb/jd017_e_web.glb");
  await expect(
    page.getByText("jd017_e_web.glb", { exact: true }),
  ).toBeVisible();
  await expect(alert).toHaveCount(0);
  expect(errors).toEqual([]);
});
