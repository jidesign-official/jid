import { ADMIN_PAGE_PATH } from "../helpers/admin-route";
import { test, expect } from "@playwright/test";
import { listDrafts, loadDraft, saveDraft } from "../../src/lib/admin/drafts";
import { ADMIN_LIMITS as L } from "../../src/lib/admin/types";
import { createHash } from "node:crypto";
import type { PackageData } from "../../src/lib/admin/package";

// Only the IndexedDB boundary is stubbed: saveDraft/loadDraft and structured
// cloning of records/Blobs remain real. No backend or publication validator.
function draftStore(readAll?: () => unknown) {
  const records = new Map<string, unknown>();
  const original = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: {
      open() {
        const request = {} as IDBOpenDBRequest;
        const db = {
          close() {},
          transaction() {
            const tx = {
              objectStore() {
                return {
                  getAll() {
                    const result = {} as IDBRequest;
                    queueMicrotask(() => {
                      Object.assign(result, {
                        result: readAll
                          ? readAll()
                          : structuredClone([...records.values()]),
                      });
                      result.onsuccess?.(new Event("success"));
                      queueMicrotask(() => tx.oncomplete?.());
                    });
                    return result;
                  },
                  get(id: string) {
                    const result = {} as IDBRequest;
                    queueMicrotask(() => {
                      Object.assign(result, {
                        result: structuredClone(records.get(id)),
                      });
                      result.onsuccess?.(new Event("success"));
                      queueMicrotask(() => tx.oncomplete?.());
                    });
                    return result;
                  },
                  put(record: { id: string }) {
                    const result = {} as IDBRequest;
                    queueMicrotask(() => {
                      records.set(record.id, structuredClone(record));
                      Object.assign(result, { result: record.id });
                      result.onsuccess?.(new Event("success"));
                      queueMicrotask(() => tx.oncomplete?.());
                    });
                    return result;
                  },
                };
              },
              oncomplete: undefined as (() => void) | undefined,
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
    restore() {
      if (original) Object.defineProperty(globalThis, "indexedDB", original);
      else Reflect.deleteProperty(globalThis, "indexedDB");
    },
  };
}

function unfinished(): PackageData {
  return {
    manifest: {
      schemaVersion: 1,
      project: { id: "jd0", title: "", category: "Product", thumbnail: "" },
      blocks: [{ id: "empty", type: "images", columns: 1, images: [] }],
      models: [],
      assets: [],
    },
    files: new Map(),
  };
}

for (const field of ["title", "projectId"] as const) {
  test(`source draft list rejects an object ${field} before it reaches React`, async () => {
    const store = draftStore();
    try {
      const record = {
        id: "broken-summary",
        title: "Draft",
        projectId: "jd0",
        updatedAt: 1,
        [field]: { invalid: "React child" },
      };
      store.records.set(record.id, record);
      await expect(listDrafts()).rejects.toThrow(/초안 목록.*손상.*ZIP/);
      expect(store.records.get(record.id)).toEqual(record);
    } finally {
      store.restore();
    }
  });
}

test("source draft list preserves plain strings, blank unfinished fields and newest-first order", async () => {
  const store = draftStore();
  try {
    expect(await listDrafts()).toEqual([]);
    const records = [
      { id: "blank", title: "", projectId: "", updatedAt: 1 },
      {
        id: "partial",
        title: "<strong>Plain title</strong>",
        projectId: "typed project / still unfinished?",
        updatedAt: 3,
      },
      {
        id: "x".repeat(80),
        title: "t".repeat(200),
        projectId: "p".repeat(80),
        updatedAt: 2,
      },
    ];
    for (const record of records)
      store.records.set(record.id, {
        ...record,
        manifest: unfinished().manifest,
      });
    expect(await listDrafts()).toEqual([records[1], records[2], records[0]]);
    expect(store.records.size).toBe(records.length);
  } finally {
    store.restore();
  }
});

const badSummaries: [string, unknown][] = [
  ["null", null],
  ["primitive", "draft"],
  ["array record", []],
  ["missing fields", { id: undefined, title: undefined }],
  ["object ID", { id: {} }],
  ["empty ID", { id: "" }],
  ["unsafe ID", { id: "../draft" }],
  ["overlong ID", { id: "x".repeat(81) }],
  ["null title", { title: null }],
  ["overlong title", { title: "x".repeat(201) }],
  ["null project ID", { projectId: null }],
  ["overlong project ID", { projectId: "x".repeat(81) }],
  ["string timestamp", { updatedAt: "1" }],
  ["NaN timestamp", { updatedAt: NaN }],
  ["infinite timestamp", { updatedAt: Infinity }],
  ["negative infinite timestamp", { updatedAt: -Infinity }],
];
for (const [name, value] of badSummaries) {
  test(`source draft list rejects malformed ${name} without deleting data`, async () => {
    const store = draftStore();
    try {
      const record =
        value !== null && typeof value === "object" && !Array.isArray(value)
          ? { id: "draft", title: "", projectId: "", updatedAt: 1, ...value }
          : value;
      store.records.set("draft", record);
      await expect(listDrafts()).rejects.toThrow(/초안 목록.*손상.*ZIP/);
      expect(store.records.get("draft")).toBe(record);
      expect(store.records.size).toBe(1);
    } finally {
      store.restore();
    }
  });
}

test("source draft list wraps non-array results and property-read failures in a recoverable error", async () => {
  for (const value of [
    null,
    {},
    "not an array",
    [
      {
        get title() {
          throw new Error("untrusted property read");
        },
      },
    ],
  ]) {
    // Fault injection stays at the IndexedDB boundary, not the summary guard.
    const store = draftStore(() => value);
    try {
      await expect(listDrafts()).rejects.toThrow(/초안 목록.*손상.*ZIP/);
    } finally {
      store.restore();
    }
  }
});

test("source draft guard rejects a manifest missing models and assets with a recoverable error", async () => {
  const store = draftStore();
  try {
    store.records.set("broken", {
      id: "broken",
      title: "Damaged draft",
      projectId: "jd046",
      updatedAt: 1,
      manifest: {
        project: { id: "jd046", title: "Damaged draft" },
        blocks: [],
      },
      files: [],
    });
    await expect(loadDraft("broken")).rejects.toThrow(/초안 데이터가 손상/);
  } finally {
    store.restore();
  }
});

const draftBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==",
  "base64",
);
function storedFixture() {
  const data = unfinished();
  data.manifest.blocks.push(
    { id: "heading", type: "heading", level: 2, text: "" },
    { id: "paragraph", type: "paragraph", text: "" },
    { id: "spacer", type: "spacer", size: "medium" },
    { id: "divider", type: "divider" },
    {
      id: "cover",
      type: "images",
      columns: 4,
      images: [{ assetId: "__proto__", alt: "", caption: "" }],
    },
  );
  data.manifest.assets.push({
    id: "__proto__",
    path: "assets/original.png",
    name: "original.png",
    kind: "image",
    sha256: createHash("sha256").update(draftBytes).digest("hex"),
    bytes: draftBytes.length,
    width: 1,
    height: 1,
  });
  return {
    id: "draft",
    title: "제목 없는 초안",
    projectId: data.manifest.project.id,
    updatedAt: 1,
    manifest: data.manifest,
    files: [["__proto__", new Blob([draftBytes], { type: "image/png" })]],
  };
}

test("source unfinished draft round trips blank fields, empty blocks and original Blob bytes", async () => {
  const store = draftStore();
  try {
    for (const id of ["", "j", "jd0", "jd046_"]) {
      const data = unfinished();
      data.manifest.project.id = id;
      await saveDraft("empty", data);
      const restored = await loadDraft("empty");
      expect(restored.manifest).toEqual(data.manifest);
      expect(restored.files.size).toBe(0);
    }
    const record = storedFixture();
    const data = {
      manifest: record.manifest,
      files: new Map(record.files as [string, Blob][]),
    };
    await saveDraft("bytes", data);
    const restored = await loadDraft("bytes");
    expect(restored.manifest).toEqual(data.manifest);
    expect(restored.files.get("__proto__")).toBeInstanceOf(Blob);
    expect(
      Buffer.from(await restored.files.get("__proto__")!.arrayBuffer()),
    ).toEqual(draftBytes);
    expect(restored.files.get("__proto__")!.type).toBe("image/png");
  } finally {
    store.restore();
  }
});

test("draft storage serializes binary bytes before opening IndexedDB instead of persisting Blob handles", async () => {
  const store = draftStore();
  try {
    const record = storedFixture();
    const data = {
      manifest: record.manifest,
      files: new Map(record.files as [string, Blob][]),
    };
    await saveDraft("binary", data);
    const saved = store.records.get("binary") as {
      files: [string, { data: ArrayBuffer; type: string }][];
    };
    expect(saved.files[0][1].data).toBeInstanceOf(ArrayBuffer);
    expect(Buffer.from(saved.files[0][1].data)).toEqual(draftBytes);
    expect(saved.files[0][1].type).toBe("image/png");
    const restored = await loadDraft("binary");
    expect(
      Buffer.from(await restored.files.get("__proto__")!.arrayBuffer()),
    ).toEqual(draftBytes);
  } finally {
    store.restore();
  }
});

test("binary draft records restore Blobs and reject malformed or mismatched byte records", async () => {
  const store = draftStore();
  try {
    const record = storedFixture();
    const data = Uint8Array.from(draftBytes).buffer;
    store.records.set("binary", {
      ...record,
      files: [["__proto__", { data, type: "image/png" }]],
    });
    const restored = await loadDraft("binary");
    expect(restored.files.get("__proto__")).toBeInstanceOf(Blob);
    expect(
      Buffer.from(await restored.files.get("__proto__")!.arrayBuffer()),
    ).toEqual(draftBytes);
    for (const value of [
      { data: [1, 2], type: "image/png" },
      { data: new ArrayBuffer(1), type: "image/png" },
      { data, type: 1 },
      { data, type: "image/png", extra: true },
    ]) {
      store.records.set("bad-binary", {
        ...record,
        files: [["__proto__", value]],
      });
      await expect(loadDraft("bad-binary")).rejects.toThrow(
        /초안 데이터가 손상/,
      );
    }
  } finally {
    store.restore();
  }
});

// These mutate cloned persisted values, not the production validation code.
const corruptions: [
  string,
  (record: ReturnType<typeof storedFixture>) => void,
][] = [
  [
    "schema version",
    (r) => {
      Object.assign(r.manifest, { schemaVersion: 2 });
    },
  ],
  [
    "project ID type",
    (r) => {
      Object.assign(r.manifest.project, { id: 46 });
    },
  ],
  [
    "project title type",
    (r) => {
      Object.assign(r.manifest.project, { title: {} });
    },
  ],
  [
    "project title limit",
    (r) => {
      r.manifest.project.title = "x".repeat(201);
    },
  ],
  [
    "project category",
    (r) => {
      Object.assign(r.manifest.project, { category: "Other" });
    },
  ],
  [
    "thumbnail type",
    (r) => {
      Object.assign(r.manifest.project, { thumbnail: [] });
    },
  ],
  [
    "thumbnail reference",
    (r) => {
      r.manifest.project.thumbnail = "missing";
    },
  ],
  [
    "models array",
    (r) => {
      Object.assign(r.manifest, { models: null });
    },
  ],
  [
    "model reference",
    (r) => {
      r.manifest.models = ["missing"];
    },
  ],
  [
    "model kind",
    (r) => {
      r.manifest.models = ["__proto__"];
    },
  ],
  [
    "models limit",
    (r) => {
      r.manifest.models = Array.from(
        { length: L.models + 1 },
        (_, i) => `model-${i}`,
      );
    },
  ],
  [
    "assets array",
    (r) => {
      Object.assign(r.manifest, { assets: {} });
    },
  ],
  [
    "assets limit",
    (r) => {
      r.manifest.assets = Array(L.assets + 1).fill(r.manifest.assets[0]);
    },
  ],
  [
    "asset null",
    (r) => {
      Object.assign(r.manifest, { assets: [null] });
    },
  ],
  [
    "asset ID type",
    (r) => {
      Object.assign(r.manifest.assets[0], { id: 1 });
    },
  ],
  [
    "asset ID duplicate",
    (r) => {
      r.manifest.assets.push({ ...r.manifest.assets[0] });
    },
  ],
  [
    "asset path traversal",
    (r) => {
      r.manifest.assets[0].path = "assets/../bad.png";
    },
  ],
  [
    "asset name type",
    (r) => {
      Object.assign(r.manifest.assets[0], { name: {} });
    },
  ],
  [
    "asset kind",
    (r) => {
      Object.assign(r.manifest.assets[0], { kind: "script" });
    },
  ],
  [
    "asset hash",
    (r) => {
      r.manifest.assets[0].sha256 = "bad";
    },
  ],
  [
    "asset bytes",
    (r) => {
      r.manifest.assets[0].bytes = -1;
    },
  ],
  [
    "asset image dimensions",
    (r) => {
      r.manifest.assets[0].width = L.imageSide + 1;
    },
  ],
  [
    "asset image pixels",
    (r) => {
      Object.assign(r.manifest.assets[0], { width: 8000, height: 8000 });
    },
  ],
  [
    "asset total byte limit",
    (r) => {
      r.manifest.assets[0].bytes = L.uncompressedBytes + 1;
    },
  ],
  [
    "blocks limit",
    (r) => {
      r.manifest.blocks = Array.from({ length: L.blocks + 1 }, (_, i) => ({
        id: `block-${i}`,
        type: "divider",
      }));
    },
  ],
  [
    "block null",
    (r) => {
      Object.assign(r.manifest, { blocks: [null] });
    },
  ],
  [
    "block duplicate ID",
    (r) => {
      r.manifest.blocks.push({ id: "empty", type: "divider" });
    },
  ],
  [
    "block type",
    (r) => {
      Object.assign(r.manifest.blocks[0], { type: "script" });
    },
  ],
  [
    "image columns",
    (r) => {
      Object.assign(r.manifest.blocks[0], { columns: 5 });
    },
  ],
  [
    "image array",
    (r) => {
      Object.assign(r.manifest.blocks[0], { images: null });
    },
  ],
  [
    "images limit",
    (r) => {
      Object.assign(r.manifest.blocks[0], {
        images: Array(L.imagesPerBlock + 1).fill({
          assetId: "__proto__",
          alt: "",
          caption: "",
        }),
      });
    },
  ],
  [
    "image reference",
    (r) => {
      Object.assign(r.manifest.blocks[0], {
        images: [{ assetId: "missing", alt: "", caption: "" }],
      });
    },
  ],
  [
    "image alt type",
    (r) => {
      Object.assign(r.manifest.blocks[0], {
        images: [{ assetId: "__proto__", alt: {}, caption: "" }],
      });
    },
  ],
  [
    "image caption limit",
    (r) => {
      Object.assign(r.manifest.blocks[0], {
        images: [{ assetId: "__proto__", alt: "", caption: "x".repeat(501) }],
      });
    },
  ],
  [
    "heading level",
    (r) => {
      Object.assign(r.manifest.blocks[1], { level: 1 });
    },
  ],
  [
    "heading text type",
    (r) => {
      Object.assign(r.manifest.blocks[1], { text: null });
    },
  ],
  [
    "paragraph text type",
    (r) => {
      Object.assign(r.manifest.blocks[2], { text: {} });
    },
  ],
  [
    "paragraph text limit",
    (r) => {
      Object.assign(r.manifest.blocks[2], { text: "x".repeat(10001) });
    },
  ],
  [
    "spacer size",
    (r) => {
      Object.assign(r.manifest.blocks[3], { size: "giant" });
    },
  ],
  [
    "file row null",
    (r) => {
      Object.assign(r, { files: [null] });
    },
  ],
  [
    "file row string",
    (r) => {
      Object.assign(r, { files: ["ab"] });
    },
  ],
  [
    "file row arity",
    (r) => {
      Object.assign(r, { files: [["__proto__", r.files[0][1], "extra"]] });
    },
  ],
  [
    "file non Blob",
    (r) => {
      Object.assign(r, { files: [["__proto__", { size: draftBytes.length }]] });
    },
  ],
  [
    "file missing",
    (r) => {
      r.files = [];
    },
  ],
  [
    "file unknown ID",
    (r) => {
      r.files[0][0] = "missing";
    },
  ],
  [
    "file duplicate ID",
    (r) => {
      r.files.push(r.files[0]);
    },
  ],
  [
    "file byte mismatch",
    (r) => {
      r.files[0][1] = new Blob(["bad"]);
    },
  ],
  [
    "file count limit",
    (r) => {
      r.files = Array(L.assets + 1).fill(r.files[0]);
    },
  ],
];
for (const [name, corrupt] of corruptions) {
  test(`source draft guard rejects malformed ${name}`, async () => {
    const store = draftStore();
    try {
      const record = storedFixture();
      corrupt(record);
      store.records.set("draft", record);
      await expect(loadDraft("draft")).rejects.toThrow(/초안 데이터가 손상/);
    } finally {
      store.restore();
    }
  });
}

for (const field of ["title", "projectId"] as const) {
  test(`malformed draft summary ${field} on initial load leaves the editor usable`, async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(ADMIN_PAGE_PATH);
    const record = {
      id: "broken-summary",
      title: "Draft",
      projectId: "jd0",
      updatedAt: 1,
      [field]: { invalid: "React child" },
    };
    await page.evaluate(async (record) => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("jid-public-editor-v1", 1);
        request.onupgradeneeded = () =>
          request.result.createObjectStore("drafts", { keyPath: "id" });
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("drafts", "readwrite");
          tx.objectStore("drafts").put(record);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = tx.onabort = () => {
            db.close();
            reject(tx.error);
          };
        };
      });
    }, record);
    await page.reload();
    const shell = page.locator("[data-admin-shell]");
    await expect(shell.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(shell.getByText(/초안 목록.*손상.*ZIP/)).toBeVisible();
    const title = page.getByLabel("프로젝트 제목", { exact: true });
    await title.fill("Still editable after malformed summary");
    page.on("dialog", (dialog) => dialog.accept());
    await page
      .getByRole("button", { name: "새 프로젝트", exact: true })
      .click();
    await expect(shell.getByRole("status")).toHaveText(
      "새 프로젝트를 시작합니다.",
    );
    await expect(title).toHaveValue("");
    await title.fill("New project after recovery");
    await expect(title).toHaveValue("New project after recovery");
    const retained = await page.evaluate(async (id) => {
      return new Promise<unknown>((resolve, reject) => {
        const request = indexedDB.open("jid-public-editor-v1", 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("drafts", "readonly");
          const row = tx.objectStore("drafts").get(id);
          tx.oncomplete = () => {
            db.close();
            resolve(row.result);
          };
          tx.onerror = tx.onabort = () => {
            db.close();
            reject(tx.error);
          };
        };
      });
    }, record.id);
    expect(retained).toEqual(record);
    expect(pageErrors).toEqual([]);
  });
}

test("corrupt IndexedDB draft reports recovery without replacing the current editor", async ({
  page,
}) => {
  await page.goto(ADMIN_PAGE_PATH);
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("jid-public-editor-v1", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("drafts", { keyPath: "id" });
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("drafts", "readwrite");
        tx.objectStore("drafts").put({
          id: "broken",
          title: "Damaged draft",
          projectId: "jd046",
          updatedAt: 1,
          manifest: {
            project: { id: "jd046", title: "Damaged draft" },
            blocks: [],
          },
          files: [],
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      };
    });
  });
  await page.reload();
  await page
    .getByLabel("프로젝트 제목", { exact: true })
    .fill("Retain my current editor");
  page.on("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "초안 불러오기 Damaged draft", exact: true })
    .click();
  await expect(
    page.locator("[data-admin-shell]").getByRole("alert"),
  ).toContainText("초안 데이터가 손상");
  await expect(page.getByLabel("프로젝트 제목", { exact: true })).toHaveValue(
    "Retain my current editor",
  );
  await page
    .getByLabel("프로젝트 제목", { exact: true })
    .fill("Still editable");
  await expect(page.getByLabel("프로젝트 제목", { exact: true })).toHaveValue(
    "Still editable",
  );
});
