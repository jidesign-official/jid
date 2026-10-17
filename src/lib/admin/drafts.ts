import { ADMIN_LIMITS as L, type AdminPackage } from "./types";
import { validateGlb, type PackageData } from "./package";
export type DraftSummary = {
  id: string;
  title: string;
  projectId: string;
  updatedAt: number;
};
type StoredBinary = { data: ArrayBuffer; type: string };
type StoredDraft = DraftSummary & {
  manifest: AdminPackage;
  files: [string, Blob | StoredBinary][];
};
const DB = "jid-public-editor-v1",
  STORE = "drafts";
function storageError(error: unknown): Error {
  const name = error instanceof DOMException ? error.name : "";
  return new Error(
    name === "QuotaExceededError"
      ? "브라우저 저장 공간이 부족합니다. ZIP으로 백업한 뒤 이전 초안을 삭제해 주세요."
      : "브라우저 초안 저장소를 사용할 수 없습니다. 비공개 모드 / 사이트 저장 설정을 확인하고 ZIP으로 백업해 주세요.",
  );
}
async function database(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") throw storageError(null);
  return new Promise((resolve, reject) => {
    let settled = false;
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB, 1);
    } catch (error) {
      reject(storageError(error));
      return;
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE))
        request.result.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => {
      if (settled) request.result.close();
      else {
        settled = true;
        resolve(request.result);
      }
    };
    request.onerror = () => {
      settled = true;
      reject(storageError(request.error));
    };
    request.onblocked = () => {
      settled = true;
      reject(
        new Error(
          "다른 탭이 초안 저장소를 사용 중입니다. 다른 편집기 탭을 닫고 다시 시도해 주세요.",
        ),
      );
    };
  });
}
async function transaction<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database();
  return new Promise<T>((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction(STORE, mode);
    } catch (error) {
      db.close();
      reject(storageError(error));
      return;
    }
    let result: T;
    let request: IDBRequest<T>;
    try {
      request = action(tx.objectStore(STORE));
    } catch (error) {
      tx.abort();
      db.close();
      reject(storageError(error));
      return;
    }
    request.onsuccess = () => {
      result = request.result;
    };
    tx.oncomplete = () => {
      db.close();
      resolve(result);
    };
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(storageError(tx.error ?? request.error));
    };
  });
}
export async function listDrafts(): Promise<DraftSummary[]> {
  const drafts: unknown = await transaction("readonly", (store) =>
    store.getAll(),
  );
  try {
    if (!Array.isArray(drafts)) throw new Error();
    // Only validate the summary here: unfinished drafts may have blank fields
    // and partial project IDs, and must not need a publishable manifest.
    return drafts
      .map((value: unknown) => {
        if (value === null || typeof value !== "object" || Array.isArray(value))
          throw new Error();
        const { id, title, projectId, updatedAt } = value as Record<
          string,
          unknown
        >;
        if (
          typeof id !== "string" ||
          !/^[a-zA-Z0-9_-]{1,80}$/.test(id) ||
          typeof title !== "string" ||
          title.length > 200 ||
          typeof projectId !== "string" ||
          projectId.length > 80 ||
          typeof updatedAt !== "number" ||
          !Number.isFinite(updatedAt)
        )
          throw new Error();
        return { id, title, projectId, updatedAt };
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    // Include runtime property-read failures; never pass corrupt values to
    // React or discard the original record as a side effect of listing it.
    throw new Error(
      "초안 목록 데이터가 손상되었습니다. 원본 ZIP을 가져와 주세요.",
    );
  }
}
export async function saveDraft(id: string, data: PackageData): Promise<void> {
  // WebKit can reject Blob/File backing stores with UnknownError. Materialize
  // exact bytes BEFORE opening the transaction; async reads inside it can also
  // make Safari auto-close the transaction. Older Blob records remain readable.
  const files: StoredDraft["files"] = [];
  for (const [key, blob] of data.files) {
    files.push([key, { data: await blob.arrayBuffer(), type: blob.type }]);
  }
  const record: StoredDraft = {
    id,
    title: data.manifest.project.title || "제목 없는 프로젝트",
    projectId: data.manifest.project.id,
    updatedAt: Date.now(),
    manifest: data.manifest,
    files,
  };
  await transaction("readwrite", (store) => store.put(record));
}
// Drafts are editable state, not publication packages: blank text, partial
// project IDs, a missing cover and empty image blocks are all intentional.
// Still treat persisted IndexedDB values as unknown before React sees them.
function assertStoredDraft(value: unknown): asserts value is StoredDraft {
  const check: (condition: unknown) => asserts condition = (condition) => {
    if (!condition)
      throw new Error(
        "초안 데이터가 손상되었습니다. 원본 ZIP을 가져와 주세요.",
      );
  };
  const object = (value: unknown): Record<string, unknown> => {
    check(value !== null && typeof value === "object" && !Array.isArray(value));
    return value as Record<string, unknown>;
  };
  const shape = (value: unknown, fields: string) => {
    const result = object(value);
    const expected = fields.split(" ");
    const keys = Object.keys(result);
    check(
      keys.length === expected.length &&
        keys.every((key) => expected.includes(key)),
    );
    return result;
  };
  const text = (value: unknown, max: number): value is string =>
    typeof value === "string" &&
    value.length <= max &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff]/u.test(value);
  const id = (value: unknown): value is string =>
    typeof value === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
  const positive = (value: unknown, max: number): value is number =>
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= max;

  const record = shape(value, "id title projectId updatedAt manifest files");
  check(id(record.id) && text(record.title, 200) && text(record.projectId, 80));
  check(
    typeof record.updatedAt === "number" &&
      Number.isSafeInteger(record.updatedAt) &&
      record.updatedAt >= 0,
  );
  const manifest = shape(
    record.manifest,
    "schemaVersion project blocks models assets",
  );
  check(manifest.schemaVersion === 1);
  const project = shape(manifest.project, "id title category thumbnail");
  check(text(project.id, 80) && text(project.title, 200));
  check(project.category === "Product" || project.category === "UX/UI");
  check(project.thumbnail === "" || id(project.thumbnail));
  check(Array.isArray(manifest.assets) && manifest.assets.length <= L.assets);
  const assets = new Map<string, { kind: "image" | "model"; bytes: number }>();
  const paths = new Set<string>();
  for (const entry of manifest.assets) {
    const a = object(entry);
    check(a.kind === "image" || a.kind === "model");
    shape(
      a,
      "id path name kind sha256 bytes" +
        (a.kind === "image" ? " width height" : ""),
    );
    check(id(a.id) && !assets.has(a.id));
    check(
      typeof a.path === "string" &&
        /^assets\/[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp|glb)$/.test(a.path) &&
        !paths.has(a.path),
    );
    check((a.kind === "model") === a.path.endsWith(".glb"));
    check(text(a.name, 500) && a.name.trim().length > 0);
    check(typeof a.sha256 === "string" && /^[a-f0-9]{64}$/.test(a.sha256));
    check(positive(a.bytes, L.uncompressedBytes));
    if (a.kind === "image")
      check(
        positive(a.width, L.imageSide) &&
          positive(a.height, L.imageSide) &&
          a.width * a.height <= L.imagePixels,
      );
    paths.add(a.path);
    assets.set(a.id, { kind: a.kind, bytes: a.bytes });
  }
  const reference = (value: unknown, kind: "image" | "model") =>
    typeof value === "string" && assets.get(value)?.kind === kind;
  check(project.thumbnail === "" || reference(project.thumbnail, "image"));
  check(Array.isArray(manifest.models) && manifest.models.length <= L.models);
  check(
    new Set(manifest.models).size === manifest.models.length &&
      manifest.models.every((value) => reference(value, "model")),
  );
  check(Array.isArray(manifest.blocks) && manifest.blocks.length <= L.blocks);
  const blockIds = new Set<string>();
  for (const entry of manifest.blocks) {
    const b = object(entry);
    check(id(b.id) && !blockIds.has(b.id));
    blockIds.add(b.id);
    switch (b.type) {
      case "images":
        shape(b, "id type columns images");
        check(
          b.columns === 1 ||
            b.columns === 2 ||
            b.columns === 3 ||
            b.columns === 4,
        );
        check(Array.isArray(b.images) && b.images.length <= L.imagesPerBlock);
        for (const entry of b.images) {
          const image = shape(entry, "assetId alt caption");
          check(
            reference(image.assetId, "image") &&
              text(image.alt, 300) &&
              text(image.caption, 500),
          );
        }
        break;
      case "heading":
        shape(b, "id type level text");
        check((b.level === 2 || b.level === 3) && text(b.text, 200));
        break;
      case "paragraph":
        shape(b, "id type text");
        check(text(b.text, 10000));
        break;
      case "spacer":
        shape(b, "id type size");
        check(b.size === "small" || b.size === "medium" || b.size === "large");
        break;
      case "divider":
        shape(b, "id type");
        break;
      default:
        check(false);
    }
  }
  check(
    Array.isArray(record.files) &&
      record.files.length === assets.size &&
      record.files.length <= L.assets,
  );
  const fileIds = new Set<string>();
  let total = new TextEncoder().encode(JSON.stringify(manifest)).byteLength;
  for (const row of record.files) {
    check(Array.isArray(row) && row.length === 2);
    const [key, payload] = row;
    check(id(key) && !fileIds.has(key));
    let size: number;
    if (payload instanceof Blob) {
      size = payload.size;
    } else {
      const binary = shape(payload, "data type");
      check(binary.data instanceof ArrayBuffer && text(binary.type, 200));
      size = binary.data.byteLength;
    }
    check(size === assets.get(key)?.bytes);
    fileIds.add(key);
    total += size;
    check(total <= L.uncompressedBytes);
  }
}

export async function loadDraft(id: string): Promise<PackageData> {
  const record = await transaction<unknown>("readonly", (store) =>
    store.get(id),
  );
  if (!record)
    throw new Error(
      "초안을 찾을 수 없습니다. 다른 탭에서 삭제되었을 수 있습니다.",
    );
  assertStoredDraft(record);
  const files = new Map(
    record.files.map(([key, value]) => [
      key,
      value instanceof Blob
        ? value
        : new Blob([value.data], { type: value.type }),
    ]),
  );
  // Old drafts may predate today's GLB policy. Validate every model asset,
  // including unused ones, before any editable/previewable state is returned.
  // Keep draft-only blank fields and image bytes out of publication validation.
  for (const asset of record.manifest.assets) {
    if (asset.kind !== "model") continue;
    try {
      validateGlb(new Uint8Array(await files.get(asset.id)!.arrayBuffer()));
    } catch (error) {
      const reason = error instanceof Error ? error.message : "GLB 검증 실패";
      throw new Error(
        `초안의 3D 모델 "${asset.name}"을 불러올 수 없습니다. ${reason} 원본 초안은 보존됩니다. 모델을 수정해 새 ZIP으로 가져와 주세요.`,
      );
    }
  }
  return { manifest: record.manifest, files };
}
export async function deleteDraft(id: string): Promise<void> {
  await transaction("readwrite", (store) => store.delete(id));
}
