import fs from "node:fs";
import path from "node:path";
import { getAdminProject } from "./adminProjects";

// Explicitly opt projects into the supplied web-ready assets, in display order.
// Never fall back to legacy portfolio GLBs: those originals may be edited independently.
const projectModelFiles: Readonly<Record<string, readonly string[]>> = {
  jd001: ["jd001_web.glb"],
  jd003: ["jd003_web.glb"],
  jd004_a: ["jd004_a_web.glb"],
  jd004_b: ["jd004_b_web.glb"],
  jd005_a: ["jd005_a_web.glb"],
  jd005_b: ["jd005_b_web.glb"],
  jd006: ["jd006_web.glb"],
  jd008_b: ["jd008_b_web.glb"],
  jd008_c: ["jd008_c_web.glb"],
  jd008_e: ["jd008_e_web.glb"],
  jd011: ["jd011_web.glb"],
  jd013: ["jd013_web.glb"],
  jd015_a: ["jd015_a_web.glb"],
  jd015_c: ["jd015_c-001_web.glb", "jd015_c-002_web.glb"],
  jd019_a: ["jd019_a_web.glb"],
  jd019_b: ["jd019_b_web.glb"],
  jd020: ["jd020_web.glb"],
  jd023: ["jd023-001_web.glb", "jd023-002_web.glb", "jd023-003_web.glb"],
  jd025_b: ["jd025_b_web.glb"],
  jd025_c: ["jd025_c_web.glb"],
  jd026: ["jd026_web.glb"],
  jd027: ["jd027_web.glb"],
  jd030: ["jd030_web.glb"],
  jd034_c: ["jd034_c_web.glb"],
  jd035: ["jd035_web.glb"],
  jd017_e: ["jd017_e_web.glb"],
  jd037: ["jd037_web.glb"],
  jd039: ["jd039_web.glb"],
  jd040: ["jd040_web.glb"],
  jd042: ["jd042_web.glb"],
  jd043: ["jd043_web.glb"],
  jd044: ["jd044_web.glb"],
  jd045: ["jd045_web.glb"],
  jd041: ["jd041-001_web.glb", "jd041-002_web.glb"],
};

export function getProjectModelPaths(folderName: string, root = process.cwd()): string[] {
  const adminProject = getAdminProject(folderName, root);
  if (adminProject) {
    // A CMS entry never probes or falls back to legacy assets.
    return adminProject.models.filter((url) => {
      try { return fs.statSync(path.join(root, "public", url)).isFile(); }
      catch (error) {
        if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return false;
        throw error;
      }
    });
  }
  if (!Object.hasOwn(projectModelFiles, folderName)) return [];
  return projectModelFiles[folderName]
    .filter((modelFile) => fs.existsSync(path.join(root, "public", "images", "glb", modelFile)))
    .map((modelFile) => `/images/glb/${modelFile}`);
}

export function getProjectModelPath(folderName: string, root = process.cwd()): string | null {
  return getProjectModelPaths(folderName, root)[0] ?? null;
}
