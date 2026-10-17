import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { listDrafts, loadDraft } from "../../src/lib/admin/drafts";
import { validateGlb } from "../../src/lib/admin/package";
import type { AdminPackage } from "../../src/lib/admin/types";

// Node-only: mock only IndexedDB, never the current binary validator. Nothing
// here imports a loader, creates a preview URL, decodes geometry or uses a GPU.
type Representation = "legacy Blob" | "ArrayBuffer + MIME";
type DraftRecord = {
  id: string;
  title: string;
  projectId: string;
  updatedAt: number;
  manifest: AdminPackage;
  files: [string, Blob | { data: ArrayBuffer; type: string }][];
};
function glb(root: object, binary?: Buffer): Buffer {
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
function smallModel(mode?: number): Buffer {
  // A genuine four-vertex strip/fan or three-vertex triangle, with real BIN data.
  const coordinates =
    mode === 5 || mode === 6
      ? [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]
      : [0, 0, 0, 1, 0, 0, 0, 1, 0];
  const binary = Buffer.alloc(coordinates.length * 4);
  coordinates.forEach((value, i) => binary.writeFloatLE(value, i * 4));
  return glb(
    {
      asset: { version: "2.0" },
      buffers: [{ byteLength: binary.length }],
      bufferViews: [{ buffer: 0, byteLength: binary.length }],
      accessors: [
        {
          componentType: 5126,
          type: "VEC3",
          count: coordinates.length / 3,
          bufferView: 0,
          min: [0, 0, 0],
          max: [1, 1, 0],
        },
      ],
      meshes: [
        {
          primitives: [
            {
              attributes: { POSITION: 0 },
              ...(mode === undefined ? {} : { mode }),
            },
          ],
        },
      ],
      nodes: [{ mesh: 0 }],
      scenes: [{ nodes: [0] }],
      scene: 0,
    },
    binary,
  );
}
function modelRecord(
  data: Buffer,
  representation: Representation,
  referenced = true,
): DraftRecord {
  const manifest: AdminPackage = {
    schemaVersion: 1,
    project: { id: "jd0", title: "", category: "Product", thumbnail: "" },
    blocks: [{ id: "unfinished", type: "images", columns: 1, images: [] }],
    models: referenced ? ["model"] : [],
    assets: [
      {
        id: "model",
        path: "assets/model.glb",
        name: "original-model.glb",
        kind: "model",
        bytes: data.length,
        sha256: createHash("sha256").update(data).digest("hex"),
      },
    ],
  };
  return {
    id: "draft",
    title: "",
    projectId: "jd0",
    updatedAt: 1,
    manifest,
    files: [
      [
        "model",
        representation === "legacy Blob"
          ? new Blob([Uint8Array.from(data)], { type: "model/gltf-binary" })
          : { data: Uint8Array.from(data).buffer, type: "model/gltf-binary" },
      ],
    ],
  };
}
function restoreStore(record: ReturnType<typeof modelRecord>) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  const modes: string[] = [];
  const records = new Map([[record.id, record]]);
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: {
      open() {
        const request = {} as IDBOpenDBRequest;
        const db = {
          close() {},
          transaction(_store: string, mode: string) {
            modes.push(mode);
            if (mode !== "readonly")
              throw new Error("Restore must never write/delete a record");
            const tx = {
              oncomplete: undefined as (() => void) | undefined,
              objectStore() {
                const read = (value: unknown) => {
                  const result = {} as IDBRequest;
                  queueMicrotask(() => {
                    Object.assign(result, { result: structuredClone(value) });
                    result.onsuccess?.(new Event("success"));
                    queueMicrotask(() => tx.oncomplete?.());
                  });
                  return result;
                };
                return {
                  get(id: string) {
                    return read(records.get(id));
                  },
                  getAll() {
                    return read([...records.values()]);
                  },
                };
              },
            };
            return tx;
          },
        };
        queueMicrotask(() => {
          Object.assign(request, { result: db });
          request.onsuccess?.(new Event("success"));
        });
        return request;
      },
    },
  });
  return {
    records,
    modes,
    restore() {
      if (original) Object.defineProperty(globalThis, "indexedDB", original);
      else Reflect.deleteProperty(globalThis, "indexedDB");
    },
  };
}

for (const representation of ["legacy Blob", "ArrayBuffer + MIME"] as const) {
  for (const mode of [5, 6]) {
    test(`restored draft policy rejects tiny genuine mode${mode} in ${representation} before resolving`, async () => {
      const data = smallModel(mode);
      expect(data.length).toBeLessThan(1000);
      expect(() => validateGlb(data)).toThrow(/TRIANGLES/);
      const record = modelRecord(data, representation);
      const before = structuredClone(record);
      const store = restoreStore(record);
      try {
        await expect(loadDraft(record.id)).rejects.toThrow(
          /초안.*3D.*TRIANGLES/,
        );
        expect(store.records.get(record.id)).toEqual(before);
        expect(await listDrafts()).toEqual([
          {
            id: record.id,
            title: "",
            projectId: "jd0",
            updatedAt: 1,
          },
        ]);
        expect(store.modes.every((mode) => mode === "readonly")).toBe(true);
      } finally {
        store.restore();
      }
    });
  }
}

// These tiny JSON-only exhaustion fixtures are validator-only input: there is
// deliberately no backing buffer allocation for the declared accessor count.
function referenceProbe(placement: "definitions" | "scenes"): Buffer {
  const primitive = { attributes: { POSITION: 0 } };
  return glb({
    asset: { version: "2.0" },
    accessors: [{ componentType: 5126, type: "VEC3", count: 999999 }],
    meshes: [
      {
        primitives:
          placement === "definitions" ? Array(6).fill(primitive) : [primitive],
      },
    ],
    nodes: [{ mesh: 0 }],
    scenes: Array.from({ length: placement === "scenes" ? 6 : 1 }, () => ({
      nodes: [0],
    })),
    scene: 0,
  });
}
const unsupportedModels: [string, () => Buffer, RegExp][] = [
  ...[0, 1, 2, 3, 7].map((mode): [string, () => Buffer, RegExp] => [
    `unsupported topology ${mode}`,
    () => smallModel(mode),
    /TRIANGLES/,
  ]),
  [
    "reference definition budget",
    () => referenceProbe("definitions"),
    /참조 처리량/,
  ],
  [
    "nondefault scene reference budget",
    () => referenceProbe("scenes"),
    /참조 처리량/,
  ],
  [
    "animation",
    () => glb({ asset: { version: "2.0" }, animations: [{}] }),
    /정적 제품 모델/,
  ],
  [
    "skeleton",
    () => glb({ asset: { version: "2.0" }, skins: [{}] }),
    /정적 제품 모델/,
  ],
  [
    "morph target",
    () =>
      glb({
        asset: { version: "2.0" },
        accessors: [{ componentType: 5126, type: "VEC3", count: 3 }],
        meshes: [
          {
            primitives: [
              { attributes: { POSITION: 0 }, targets: [{ POSITION: 0 }] },
            ],
          },
        ],
      }),
    /모프 타깃/,
  ],
  ["invalid GLB binary", () => Buffer.from("not a model file"), /GLB/],
];
for (const representation of ["legacy Blob", "ArrayBuffer + MIME"] as const) {
  for (const [name, fixture, reason] of unsupportedModels) {
    test(`restored draft policy enforces real current ${name} for ${representation}`, async () => {
      const data = fixture();
      expect(data.length).toBeLessThan(1500);
      expect(() => validateGlb(data)).toThrow(reason);
      const record = modelRecord(data, representation);
      const before = structuredClone(record);
      const store = restoreStore(record);
      try {
        // Repeated attempts remain recoverable, not a destructive migration.
        for (let attempt = 0; attempt < 2; attempt++) {
          const error = await loadDraft(record.id).catch(
            (error: unknown) => error,
          );
          expect(error).toBeInstanceOf(Error);
          expect((error as Error).message).toMatch(reason);
          expect((error as Error).message).toMatch(
            /초안.*3D.*original-model\.glb/,
          );
          expect((error as Error).message).toMatch(
            /원본 초안.*보존.*모델.*수정.*ZIP/,
          );
          expect(store.records.get(record.id)).toEqual(before);
          expect(store.records.size).toBe(1);
        }
        expect(store.modes).toEqual(["readonly", "readonly"]);
      } finally {
        store.restore();
      }
    });
  }
  for (const [name, data, reason] of [
    ["strip", smallModel(5), /TRIANGLES/],
    ["fan", smallModel(6), /TRIANGLES/],
    ["reference budget", referenceProbe("scenes"), /참조 처리량/],
  ] as const) {
    test(`restored draft policy checks later unreferenced ${name} asset in ${representation}`, async () => {
      const record = modelRecord(smallModel(), representation);
      const unused = modelRecord(data, representation, false);
      record.manifest.assets.push({
        ...unused.manifest.assets[0],
        id: "unused",
        path: "assets/unused.glb",
        name: "unused-model.glb",
      });
      record.files.push(["unused", unused.files[0][1]]);
      const before = structuredClone(record);
      const store = restoreStore(record);
      try {
        const error = await loadDraft(record.id).catch(
          (error: unknown) => error,
        );
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toMatch(/unused-model\.glb/);
        expect((error as Error).message).toMatch(reason);
        expect(store.records.get(record.id)).toEqual(before);
        expect(store.modes).toEqual(["readonly"]);
      } finally {
        store.restore();
      }
    });
  }
  for (const mode of [undefined, 4]) {
    for (const referenced of [false, true]) {
      test(`restored draft policy permits genuine static mode${mode ?? "default"} referenced=${referenced} in ${representation}`, async () => {
        const data = smallModel(mode);
        expect(() => validateGlb(data)).not.toThrow();
        const record = modelRecord(data, representation, referenced);
        const before = structuredClone(record);
        const store = restoreStore(record);
        try {
          const restored = await loadDraft(record.id);
          expect(restored.manifest).toEqual(record.manifest);
          expect(restored.files.size).toBe(1);
          const blob = restored.files.get("model")!;
          expect(blob.type).toBe("model/gltf-binary");
          expect(Buffer.from(await blob.arrayBuffer())).toEqual(data);
          expect(
            createHash("sha256")
              .update(Buffer.from(await blob.arrayBuffer()))
              .digest("hex"),
          ).toBe(record.manifest.assets[0].sha256);
          expect(store.records.get(record.id)).toEqual(before);
          expect(store.modes).toEqual(["readonly"]);
        } finally {
          store.restore();
        }
      });
    }
  }
  test(`restored draft policy preserves real static original in ${representation}`, async () => {
    const path = "public/images/glb/jd017_e_web.glb";
    const data = await fs.readFile(path);
    expect(() => validateGlb(data)).not.toThrow();
    const record = modelRecord(data, representation);
    const before = structuredClone(record);
    const store = restoreStore(record);
    try {
      const restored = await loadDraft(record.id);
      expect(restored.manifest).toEqual(record.manifest);
      expect(
        Buffer.from(await restored.files.get("model")!.arrayBuffer()),
      ).toEqual(data);
      expect(store.records.get(record.id)).toEqual(before);
      expect(await fs.readFile(path)).toEqual(data);
    } finally {
      store.restore();
    }
  });
  for (const mode of [undefined, 6]) {
    test(`restored draft policy awaits binary validation before mode${mode ?? "default"} ${representation} settles`, async () => {
      const record = modelRecord(smallModel(mode), representation);
      const store = restoreStore(record);
      const originalRead = Blob.prototype.arrayBuffer;
      let release!: () => void;
      let started!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const reading = new Promise<void>((resolve) => {
        started = resolve;
      });
      Blob.prototype.arrayBuffer = async function () {
        started();
        await gate;
        return originalRead.call(this);
      };
      try {
        let settled = false;
        const pending = loadDraft(record.id);
        void pending.then(
          () => {
            settled = true;
          },
          () => {
            settled = true;
          },
        );
        await reading;
        expect(settled).toBe(false);
        release();
        if (mode === undefined)
          await expect(pending).resolves.toHaveProperty(
            "manifest",
            record.manifest,
          );
        else await expect(pending).rejects.toThrow(/TRIANGLES/);
      } finally {
        release();
        Blob.prototype.arrayBuffer = originalRead;
        store.restore();
      }
    });
  }
}

test("restored draft structural guard runs before model bytes are read", async () => {
  const record = modelRecord(smallModel(5), "legacy Blob");
  Object.assign(record.manifest.project, { title: {} });
  const before = structuredClone(record);
  const store = restoreStore(record);
  const originalRead = Blob.prototype.arrayBuffer;
  let reads = 0;
  Blob.prototype.arrayBuffer = async () => {
    reads++;
    throw new Error("must not read");
  };
  try {
    await expect(loadDraft(record.id)).rejects.toThrow(/초안 데이터가 손상/);
    expect(reads).toBe(0);
    expect(store.records.get(record.id)).toEqual(before);
  } finally {
    Blob.prototype.arrayBuffer = originalRead;
    store.restore();
  }
});

test("restored draft binary read failure is recoverable and retains the original", async () => {
  const record = modelRecord(smallModel(), "legacy Blob");
  const before = structuredClone(record);
  const store = restoreStore(record);
  const originalRead = Blob.prototype.arrayBuffer;
  Blob.prototype.arrayBuffer = async () => {
    throw new Error("binary read unavailable");
  };
  try {
    await expect(loadDraft(record.id)).rejects.toThrow(
      /3D.*binary read unavailable.*보존.*ZIP/,
    );
    expect(store.records.get(record.id)).toEqual(before);
  } finally {
    Blob.prototype.arrayBuffer = originalRead;
    store.restore();
  }
});

test("restored blank unfinished drafts without models remain allowed without reading image bytes", async () => {
  const originalRead = Blob.prototype.arrayBuffer;
  Blob.prototype.arrayBuffer = async () => {
    throw new Error("Images must not be read or decoded on restore");
  };
  try {
    for (const projectId of ["", "j", "jd0", "jd046_"]) {
      for (const withImage of [false, true]) {
        const record = modelRecord(smallModel(), "ArrayBuffer + MIME");
        record.projectId = record.manifest.project.id = projectId;
        record.manifest.models = [];
        record.manifest.assets = [];
        record.files = [];
        if (withImage) {
          // Draft image validation remains structural, not publication/decode validation.
          const image = Buffer.from("unfinished image bytes");
          record.manifest.assets.push({
            id: "image",
            path: "assets/image.png",
            name: "image.png",
            kind: "image",
            bytes: image.length,
            sha256: createHash("sha256").update(image).digest("hex"),
            width: 1,
            height: 1,
          });
          record.files.push([
            "image",
            { data: Uint8Array.from(image).buffer, type: "image/png" },
          ]);
        }
        const before = structuredClone(record);
        const store = restoreStore(record);
        try {
          const restored = await loadDraft(record.id);
          expect(restored.manifest).toEqual(record.manifest);
          expect(restored.files.size).toBe(withImage ? 1 : 0);
          expect(store.records.get(record.id)).toEqual(before);
        } finally {
          store.restore();
        }
      }
    }
  } finally {
    Blob.prototype.arrayBuffer = originalRead;
  }
});
