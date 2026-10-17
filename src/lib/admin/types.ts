export const ADMIN_LIMITS = {
  packageBytes: 25 * 1024 * 1024,
  uncompressedBytes: 50 * 1024 * 1024,
  assets: 60,
  blocks: 100,
  models: 4,
  imagesPerBlock: 12,
  imageSide: 8192,
  imagePixels: 40_000_000,
} as const;

export type AdminAsset = {
  id: string;
  path: string;
  name: string;
  kind: "image" | "model";
  sha256: string;
  bytes: number;
  width?: number;
  height?: number;
};
export type ImageReference = { assetId: string; alt: string; caption: string };
export type ContentTextBlock =
  | { id: string; type: "heading"; level: 2 | 3; text: string }
  | { id: string; type: "paragraph"; text: string }
  | { id: string; type: "spacer"; size: "small" | "medium" | "large" }
  | { id: string; type: "divider" };
export type AdminBlock =
  | ContentTextBlock
  | {
      id: string;
      type: "images";
      columns: 1 | 2 | 3 | 4;
      images: ImageReference[];
    };
export type AdminPackage = {
  schemaVersion: 1;
  project: {
    id: string;
    title: string;
    category: "Product" | "UX/UI";
    thumbnail: string;
  };
  blocks: AdminBlock[];
  models: string[];
  assets: AdminAsset[];
};
export type ResolvedImage = {
  src: string;
  width: number;
  height: number;
  alt: string;
  caption: string;
};
export type PortfolioContentBlock =
  | ContentTextBlock
  | {
      id: string;
      type: "images";
      columns: 1 | 2 | 3 | 4;
      images: ResolvedImage[];
    };
export type AdminProject = {
  id: string;
  folder: string;
  title: string;
  category: "Product" | "UX/UI";
  image: string;
  blocks: PortfolioContentBlock[];
  models: string[];
  packageSha256: string;
};
export type AdminCatalogProject = {
  id: string;
  folder: string;
  title: string;
  category: string;
  image: string;
};
