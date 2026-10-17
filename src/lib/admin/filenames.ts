import type { AdminAsset, AdminPackage } from "./types";

/**
 * Return an independent manifest with readable ZIP entry names; only assets.path changes.
 * Call full package/binary validation first. Blob/byte Maps remain keyed by stable asset IDs
 * and are deliberately not accepted here, so renaming never rewrites or duplicates bytes.
 */
export function withCanonicalAssetFilenames(
  manifest: AdminPackage,
): AdminPackage {
  const projectId = manifest.project.id;
  if (
    typeof projectId !== "string" ||
    /^jd[0-9]{3}(?:_[a-z]+)?$/.exec(projectId)?.[0] !== projectId
  ) {
    throw new Error("프로젝트 ID 형식이 올바르지 않습니다.");
  }
  const assetById = new Map<string, AdminAsset>();
  const originalPaths = new Set<string>();
  for (const asset of manifest.assets) {
    if (assetById.has(asset.id)) throw new Error("중복 에셋 ID입니다.");
    const path = asset.path;
    const match =
      typeof path === "string"
        ? /^assets\/[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp|glb)$/.exec(path)
        : null;
    if (!match || match[0] !== path || originalPaths.has(path.toLowerCase())) {
      throw new Error("에셋 파일 경로가 안전하지 않거나 중복됩니다.");
    }
    if (
      (asset.kind !== "image" && asset.kind !== "model") ||
      (asset.kind === "model") !== (match[1] === "glb")
    ) {
      throw new Error("에셋 종류와 확장자가 일치하지 않습니다.");
    }
    originalPaths.add(path.toLowerCase());
    assetById.set(asset.id, asset);
  }

  const assigned = new Map<string, string>();
  const generatedPaths = new Set<string>();
  const assign = (id: string, suffix: string, kind: AdminAsset["kind"]) => {
    const asset = assetById.get(id);
    if (!asset || asset.kind !== kind)
      throw new Error(
        "에셋 참조 또는 대표·본문·모델 역할이 올바르지 않습니다.",
      );
    if (assigned.has(id)) return;
    const basename = `${projectId}_${suffix}.${asset.path.split(".").at(-1)}`;
    if (basename.length > 80)
      throw new Error(
        "ZIP 파일명은 80자 이하여야 합니다. 프로젝트 ID를 줄여 주세요.",
      );
    const path = `assets/${basename}`;
    if (generatedPaths.has(path.toLowerCase()))
      throw new Error("ZIP 파일명이 중복됩니다.");
    generatedPaths.add(path.toLowerCase());
    assigned.set(id, path);
  };
  assign(manifest.project.thumbnail, "thumbs", "image");
  let bodyIndex = 0;
  for (const block of manifest.blocks) {
    if (block.type !== "images") continue;
    for (const image of block.images) {
      // The cover takes precedence. Repeated body references keep their first name.
      if (!assigned.has(image.assetId)) bodyIndex++;
      assign(
        image.assetId,
        `body_${String(bodyIndex).padStart(2, "0")}`,
        "image",
      );
    }
  }
  const modelIds = new Set<string>();
  manifest.models.forEach((id, index) => {
    if (modelIds.has(id)) throw new Error("모델 참조가 중복됩니다.");
    modelIds.add(id);
    assign(id, `model_${String(index + 1).padStart(2, "0")}`, "model");
  });
  if (assigned.size !== manifest.assets.length)
    throw new Error("사용하지 않는 에셋이 있습니다.");
  const result = structuredClone(manifest);
  result.assets.forEach((asset) => {
    asset.path = assigned.get(asset.id)!;
  });
  return result;
}
