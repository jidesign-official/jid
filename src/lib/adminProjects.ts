import fs from "node:fs";
import path from "node:path";
import type { AdminProject, PortfolioContentBlock } from "./admin/types";

// Server/build-only. Client components receive resolved serializable props only.
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length <= max;
const identifier = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value);

function validBlock(
  value: unknown,
  media: (value: unknown, model?: boolean) => boolean,
): value is PortfolioContentBlock {
  if (!object(value) || !identifier(value.id)) return false;
  switch (value.type) {
    case "heading":
      return (value.level === 2 || value.level === 3) && text(value.text, 200);
    case "paragraph":
      return text(value.text, 10_000);
    case "spacer":
      return ["small", "medium", "large"].includes(value.size as string);
    case "divider":
      return true;
    case "images":
      return (
        Number.isInteger(value.columns) &&
        Number(value.columns) >= 1 &&
        Number(value.columns) <= 4 &&
        Array.isArray(value.images) &&
        value.images.length >= 1 &&
        value.images.length <= 12 &&
        value.images.every(
          (image) =>
            object(image) &&
            media(image.src) &&
            Number.isInteger(image.width) &&
            Number.isInteger(image.height) &&
            Number(image.width) >= 1 &&
            Number(image.height) >= 1 &&
            Number(image.width) <= 8192 &&
            Number(image.height) <= 8192 &&
            Number(image.width) * Number(image.height) <= 40_000_000 &&
            text(image.alt, 300) &&
            text(image.caption, 500),
        )
      );
    default:
      return false;
  }
}

function validProject(value: unknown): value is AdminProject {
  if (
    !object(value) ||
    typeof value.id !== "string" ||
    !/^jd\d{3}(?:_[a-z]+)?$/.test(value.id) ||
    value.folder !== value.id ||
    !text(value.title, 200) ||
    !value.title.trim() ||
    !["Product", "UX/UI"].includes(value.category as string) ||
    typeof value.packageSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.packageSha256)
  )
    return false;
  const prefix = `/_admin_media/${value.id}/${value.packageSha256.slice(0, 16)}/`;
  const media = (url: unknown, model = false) =>
    typeof url === "string" &&
    url.startsWith(prefix) &&
    (model
      ? /^[a-zA-Z0-9_-]{1,80}\.glb$/
      : /^[a-zA-Z0-9_-]{1,80}\.(?:png|jpg|jpeg|webp)$/
    ).test(url.slice(prefix.length));
  return (
    media(value.image) &&
    Array.isArray(value.blocks) &&
    value.blocks.length <= 100 &&
    value.blocks.every((block) => validBlock(block, media)) &&
    new Set(value.blocks.map((block) => block.id)).size ===
      value.blocks.length &&
    Array.isArray(value.models) &&
    value.models.length <= 4 &&
    value.models.every((url) => media(url, true)) &&
    new Set(value.models).size === value.models.length
  );
}

export function getAdminProjects(root = process.cwd()): AdminProject[] {
  const filename = path.join(root, ".generated", "admin-projects.json");
  let source: string;
  try {
    source = fs.readFileSync(filename, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error("Cannot read admin project registry", { cause: error });
  }
  let registry: unknown;
  try {
    registry = JSON.parse(source);
  } catch (error) {
    throw new Error("Invalid admin project registry JSON", { cause: error });
  }
  if (
    !object(registry) ||
    registry.schemaVersion !== 1 ||
    !Array.isArray(registry.projects) ||
    !registry.projects.every(validProject) ||
    new Set(registry.projects.map((project) => project.id)).size !==
      registry.projects.length
  ) {
    throw new Error("Invalid admin project registry");
  }
  return registry.projects;
}

export function getAdminProject(
  id: string,
  root = process.cwd(),
): AdminProject | undefined {
  return getAdminProjects(root).find((project) => project.id === id);
}
