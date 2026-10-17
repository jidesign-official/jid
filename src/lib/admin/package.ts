import { zipSync, strToU8 } from "fflate";
import { withCanonicalAssetFilenames } from "./filenames";
import { ADMIN_LIMITS as L, type AdminAsset, type AdminPackage } from "./types";

export type PackageData = { manifest: AdminPackage; files: Map<string, Blob> };
const fail = (message: string): never => {
  throw new Error(message);
};
const check: (condition: unknown, message: string) => asserts condition = (
  condition,
  message,
) => {
  if (!condition) fail(message);
};
const idPattern = /^[a-zA-Z0-9_-]{1,80}$/;
const validId = (id: unknown): id is string =>
  typeof id === "string" && idPattern.test(id);
function shape(value: unknown, fields: string, label: string): void {
  check(
    value && typeof value === "object" && !Array.isArray(value),
    "잘못된 " + label,
  );
  const expected = fields.split(" ");
  const keys = Object.keys(value);
  check(
    keys.length === expected.length &&
      keys.every((key) => expected.includes(key)),
    label + " 필드가 올바르지 않습니다.",
  );
}
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let i = 0; i < 8; i++)
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function validateImage(data: Uint8Array): void {
  const info = imageHeader(data.subarray(0, 1024 * 1024));
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const ascii = (p: number, n: number) =>
    String.fromCharCode(...data.subarray(p, p + n));
  if (info.ext === "png") {
    let offset = 8,
      seenData = false,
      seenHeader = false;
    while (offset < data.length) {
      check(offset + 12 <= data.length, "PNG 청크가 잘렸습니다.");
      const length = v.getUint32(offset),
        end = offset + length + 12,
        kind = ascii(offset + 4, 4);
      check(end <= data.length, "PNG 데이터가 잘렸습니다.");
      check(
        crc32(data.subarray(offset + 4, end - 4)) === v.getUint32(end - 4),
        "PNG CRC 오류",
      );
      if (!seenHeader) {
        check(kind === "IHDR" && length === 13, "PNG IHDR 오류");
        const depth = data[offset + 16],
          color = data[offset + 17];
        const allowed: Record<number, number[]> = {
          0: [1, 2, 4, 8, 16],
          2: [8, 16],
          3: [1, 2, 4, 8],
          4: [8, 16],
          6: [8, 16],
        };
        check(
          allowed[color]?.includes(depth) &&
            data[offset + 18] === 0 &&
            data[offset + 19] === 0 &&
            data[offset + 20] <= 1,
          "PNG 형식 오류",
        );
        seenHeader = true;
      } else check(kind !== "IHDR", "PNG 중복 IHDR");
      if (kind === "IDAT") seenData = true;
      if (kind === "IEND") {
        check(length === 0 && end === data.length && seenData, "PNG IEND 오류");
        return;
      }
      offset = end;
    }
    fail("PNG IEND가 없습니다.");
  }
  if (info.ext === "jpg") {
    check(
      data[data.length - 2] === 255 && data[data.length - 1] === 217,
      "JPEG 끝 서명 오류",
    );
    let p = 2;
    let seenFrame = false;
    while (p < data.length - 2) {
      check(data[p] === 255, "JPEG 마커 오류");
      while (data[p] === 255) p++;
      const marker = data[p++];
      check(![0, 0xd8, 0xd9].includes(marker), "JPEG 마커 오류");
      if (marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      check(p + 2 <= data.length, "JPEG 잘린 세그먼트");
      const length = v.getUint16(p);
      check(
        length >= 2 && p + length <= data.length - 2,
        "JPEG 세그먼트 길이 오류",
      );
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker)
      ) {
        check(
          length >= 8 && data[p + 7] > 0 && length === 8 + 3 * data[p + 7],
          "JPEG SOF 오류",
        );
        check(
          v.getUint16(p + 3) === info.height &&
            v.getUint16(p + 5) === info.width,
          "JPEG 크기 충돌",
        );
        seenFrame = true;
      }
      if (marker === 0xda) {
        check(
          seenFrame && p + length < data.length - 2,
          "JPEG 이미지 데이터가 없습니다.",
        );
        return;
      }
      p += length;
    }
    fail("JPEG 스캔 데이터가 없습니다.");
  }
  check(v.getUint32(4, true) + 8 === data.length, "WebP RIFF 길이 오류");
  let p = 12,
    canvas = false,
    frame = false,
    dimensions = false;
  while (p < data.length) {
    check(p + 8 <= data.length, "WebP 청크 오류");
    const kind = ascii(p, 4),
      length = v.getUint32(p + 4, true),
      start = p + 8,
      end = start + length;
    check(end + (length % 2) <= data.length, "WebP 데이터가 잘렸습니다.");
    if (kind === "VP8X") {
      check(!canvas && p === 12 && length === 10, "WebP 확장 헤더 오류");
      canvas = true;
    }
    if (kind === "VP8 ") {
      check(
        !dimensions &&
          length >= 10 &&
          !(data[start] & 1) &&
          ascii(start + 3, 3) === "\u009d\u0001*",
        "WebP VP8 오류",
      );
      check(
        (v.getUint16(start + 6, true) & 0x3fff) === info.width &&
          (v.getUint16(start + 8, true) & 0x3fff) === info.height,
        "WebP 크기 충돌",
      );
      frame = true;
      dimensions = true;
    }
    if (kind === "VP8L") {
      check(
        !dimensions &&
          length >= 5 &&
          data[start] === 0x2f &&
          v.getUint32(start + 1, true) >>> 29 === 0,
        "WebP lossless 오류",
      );
      const bits = v.getUint32(start + 1, true);
      check(
        (bits & 0x3fff) + 1 === info.width &&
          ((bits >>> 14) & 0x3fff) + 1 === info.height,
        "WebP 크기 충돌",
      );
      frame = true;
      dimensions = true;
    }
    if (kind === "ANMF") {
      check(canvas && length >= 16, "WebP 애니메이션 오류");
      frame = true;
    }
    p = end + (length % 2);
  }
  check(frame, "WebP 이미지 프레임이 없습니다.");
}
function strictJson(
  data: Uint8Array,
  onPrimitiveModeNumber?: (token: string) => void,
  onTextureNumber?: (token: string) => void,
  onMetadataBytes?: (bytes: number) => void,
): unknown {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(data);
  const tokens = text.matchAll(
    /"(?:[^"\\]|\\.)*"|[{}\[\],:]|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g,
  );
  const stack: ({
    keys: Set<string>;
    key: boolean;
    property?: string;
  } | null)[] = [];
  // Container positions: root=0, meshes[]=1/2, primitives[]=3/4,
  // textures[]=5/6, samplers[]=7/8, texture extensions=9, alternate=10;
  // Metadata accounting: core asset=11, buffers[]=12/13, images[]=14/15.
  // -1 denotes unrelated metadata, including keys containing dots/brackets.
  const locations: number[] = [];
  let tokenCount = 0;
  let metadataBytes = 0;
  const encoder = new TextEncoder();
  for (const [token] of tokens) {
    check(++tokenCount <= 200_000, "JSON 토큰이 너무 많습니다.");
    const top = stack[stack.length - 1];
    if (onMetadataBytes) {
      const location = locations[locations.length - 1];
      const excludedString =
        token.startsWith('"') &&
        top &&
        !top.key &&
        ((location === 11 && top.property === "generator") ||
          ((location === 13 || location === 15) && top.property === "uri"));
      // Compact SOURCE tokens preserve escapes and numeric spelling identically
      // in JS/Python. +32 per number bounds finite-double stringify expansion.
      // Exclusions are string VALUES at exact structural paths, never names or
      // lookalike keys. Original parsed JSON and upload bytes are never changed.
      metadataBytes += excludedString ? 2 : encoder.encode(token).length;
      if (/^-?\d/.test(token)) metadataBytes += 32;
    }
    if (token === "{" || token === "[") {
      if (onPrimitiveModeNumber || onTextureNumber || onMetadataBytes) {
        const parent = locations[locations.length - 1];
        locations.push(
          stack.length === 0 && token === "{"
            ? 0
            : parent === 0 && top?.property === "meshes" && token === "["
              ? 1
              : parent === 1 && top === null && token === "{"
                ? 2
                : parent === 2 &&
                    top?.property === "primitives" &&
                    token === "["
                  ? 3
                  : parent === 3 && top === null && token === "{"
                    ? 4
                    : parent === 0 &&
                        top?.property === "textures" &&
                        token === "["
                      ? 5
                      : parent === 5 && top === null && token === "{"
                        ? 6
                        : parent === 0 &&
                            top?.property === "samplers" &&
                            token === "["
                          ? 7
                          : parent === 7 && top === null && token === "{"
                            ? 8
                            : parent === 6 &&
                                top?.property === "extensions" &&
                                token === "{"
                              ? 9
                              : parent === 9 &&
                                  [
                                    "EXT_texture_webp",
                                    "EXT_texture_avif",
                                  ].includes(top?.property ?? "") &&
                                  token === "{"
                                ? 10
                                : parent === 0 &&
                                    top?.property === "asset" &&
                                    token === "{"
                                  ? 11
                                  : parent === 0 &&
                                      top?.property === "buffers" &&
                                      token === "["
                                    ? 12
                                    : parent === 12 &&
                                        top === null &&
                                        token === "{"
                                      ? 13
                                      : parent === 0 &&
                                          top?.property === "images" &&
                                          token === "["
                                        ? 14
                                        : parent === 14 &&
                                            top === null &&
                                            token === "{"
                                          ? 15
                                          : -1,
        );
      }
      stack.push(token === "{" ? { keys: new Set(), key: true } : null);
    } else if (token === "}" || token === "]") {
      stack.pop();
      if (onPrimitiveModeNumber || onTextureNumber || onMetadataBytes)
        locations.pop();
    } else if (token === "," && top) top.key = true;
    else if (token === ":" && top) top.key = false;
    else if (token.startsWith('"') && top?.key) {
      const key = JSON.parse(token) as string;
      check(!top.keys.has(key), "JSON 중복 키가 있습니다.");
      top.keys.add(key);
      top.property = key;
    } else if (
      onPrimitiveModeNumber &&
      top?.property === "mode" &&
      locations[locations.length - 1] === 4 &&
      /^-?\d/.test(token)
    )
      onPrimitiveModeNumber(token);
    else if (
      onTextureNumber &&
      /^-?\d/.test(token) &&
      ((locations[locations.length - 1] === 6 &&
        ["source", "sampler"].includes(top?.property ?? "")) ||
        (locations[locations.length - 1] === 8 &&
          ["magFilter", "minFilter", "wrapS", "wrapT"].includes(
            top?.property ?? "",
          )) ||
        (locations[locations.length - 1] === 10 && top?.property === "source"))
    )
      onTextureNumber(token);
    check(stack.length <= 64, "JSON 중첩이 너무 깊습니다.");
  }
  onMetadataBytes?.(metadataBytes);
  return JSON.parse(text, (_key, value: unknown) => {
    check(
      typeof value !== "number" || Number.isFinite(value),
      "JSON 숫자는 유한해야 합니다.",
    );
    return value;
  });
}
const bytes = (blob: Blob) =>
  blob.arrayBuffer().then((value) => new Uint8Array(value));
async function decodeImage(blob: Blob): Promise<void> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(blob);
      bitmap.close();
    } catch {
      fail("이미지를 디코드할 수 없습니다. 원본 파일을 확인해 주세요.");
    }
    return;
  }
  if (typeof Image === "undefined") return;
  await new Promise<void>((resolve, reject) => {
    const url = URL.createObjectURL(blob),
      image = new Image();
    const finish = (error?: Error) => {
      clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      image.removeAttribute("src");
      URL.revokeObjectURL(url);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(
      () => finish(new Error("이미지 디코드 시간이 초과되었습니다.")),
      15000,
    );
    image.onload = () => finish();
    image.onerror = () =>
      finish(
        new Error("이미지를 디코드할 수 없습니다. 원본 파일을 확인해 주세요."),
      );
    image.src = url;
  });
}
export async function sha256(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new Uint8Array(data).buffer,
  );
  return Array.from(new Uint8Array(digest), (x) =>
    x.toString(16).padStart(2, "0"),
  ).join("");
}
function imageHeader(b: Uint8Array): {
  ext: string;
  width: number;
  height: number;
} {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const ascii = (start: number, end: number) =>
    String.fromCharCode(...b.subarray(start, end));
  let width = 0,
    height = 0,
    ext = "";
  if (
    b.length >= 24 &&
    b.slice(0, 8).every((n, i) => n === [137, 80, 78, 71, 13, 10, 26, 10][i]) &&
    ascii(12, 16) === "IHDR"
  ) {
    ext = "png";
    width = v.getUint32(16);
    height = v.getUint32(20);
  } else if (
    b.length >= 12 &&
    ascii(0, 4) === "RIFF" &&
    ascii(8, 12) === "WEBP"
  ) {
    ext = "webp";
    let p = 12;
    while (p + 8 <= b.length) {
      const chunk = ascii(p, p + 4),
        length = v.getUint32(p + 4, true),
        start = p + 8;
      if (chunk === "VP8X" && length >= 10 && start + 10 <= b.length) {
        width = 1 + b[start + 4] + (b[start + 5] << 8) + (b[start + 6] << 16);
        height = 1 + b[start + 7] + (b[start + 8] << 8) + (b[start + 9] << 16);
        break;
      }
      if (
        chunk === "VP8 " &&
        length >= 10 &&
        start + 10 <= b.length &&
        b[start + 3] === 0x9d &&
        b[start + 4] === 1 &&
        b[start + 5] === 0x2a
      ) {
        width = v.getUint16(start + 6, true) & 0x3fff;
        height = v.getUint16(start + 8, true) & 0x3fff;
        break;
      }
      if (
        chunk === "VP8L" &&
        length >= 5 &&
        start + 5 <= b.length &&
        b[start] === 0x2f
      ) {
        width = 1 + b[start + 1] + ((b[start + 2] & 0x3f) << 8);
        height =
          1 +
          (b[start + 2] >> 6) +
          (b[start + 3] << 2) +
          ((b[start + 4] & 15) << 10);
        break;
      }
      p = start + length + (length % 2);
    }
  } else if (b.length >= 4 && b[0] === 255 && b[1] === 216) {
    ext = "jpg";
    let p = 2;
    while (p + 3 < b.length) {
      check(b[p] === 255, "JPEG 헤더가 올바르지 않습니다.");
      while (b[p] === 255) p++;
      const marker = b[p++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (p + 2 > b.length) break;
      const length = v.getUint16(p);
      check(length >= 2, "JPEG 길이가 올바르지 않습니다.");
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker) &&
        p + 7 <= b.length
      ) {
        height = v.getUint16(p + 3);
        width = v.getUint16(p + 5);
        break;
      }
      p += length;
    }
  }
  check(
    ext && width > 0 && height > 0,
    "PNG, JPEG, WebP 이미지의 유효한 크기 헤더가 필요합니다.",
  );
  check(
    width <= L.imageSide &&
      height <= L.imageSide &&
      width * height <= L.imagePixels,
    "이미지는 한 변 8192px, 40MP 이하여야 합니다.",
  );
  return { ext, width, height };
}
function dataResource(uri: unknown): { mime: string; data: Uint8Array } {
  check(typeof uri === "string", "GLB URI 형식 오류");
  const match =
    /^data:(image\/(?:png|jpeg|webp)|application\/octet-stream);base64,((?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?)$/.exec(
      uri,
    );
  check(
    match && match[2].length > 0,
    "GLB는 PNG / JPEG / WebP / octet-stream base64 데이터 URI만 지원합니다. 외부 URI는 허용되지 않습니다.",
  );
  const decoded = atob(match[2]);
  check(
    decoded.length <= L.uncompressedBytes,
    "GLB 내장 리소스가 너무 큽니다.",
  );
  return {
    mime: match[1],
    data: Uint8Array.from(decoded, (c) => c.charCodeAt(0)),
  };
}
type GlbView = {
  buffer?: number;
  byteOffset?: number;
  byteLength?: number;
  byteStride?: number;
};
type GlbAccessor = {
  componentType?: number;
  type?: string;
  count?: number;
  byteOffset?: number;
  bufferView?: number;
  normalized?: boolean;
  sparse?: {
    count?: number;
    indices?: {
      bufferView?: number;
      byteOffset?: number;
      componentType?: number;
    };
    values?: { bufferView?: number; byteOffset?: number };
  };
};
function validateAccessors(
  accessors: GlbAccessor[],
  views: GlbView[],
  buffer: Uint8Array,
): number[] {
  check(Array.isArray(accessors), "GLB accessors 오류");
  const components = new Map([
    [5120, 1],
    [5121, 1],
    [5122, 2],
    [5123, 2],
    [5125, 4],
    [5126, 4],
  ]);
  const layouts = new Map<string, [number, number]>([
    ["SCALAR", [1, 1]],
    ["VEC2", [1, 2]],
    ["VEC3", [1, 3]],
    ["VEC4", [1, 4]],
    ["MAT2", [2, 2]],
    ["MAT3", [3, 3]],
    ["MAT4", [4, 4]],
  ]);
  const maxGeometry = 64 * 1024 * 1024;
  const integer = (n: unknown, min: number, max: number): n is number =>
    typeof n === "number" && Number.isSafeInteger(n) && n >= min && n <= max;
  let budget = 0;
  const referenceCosts: number[] = [];
  const region = (
    index: number | undefined,
    offset: number,
    count: number,
    element: number,
    alignment: number,
    strideAllowed = false,
  ) => {
    check(integer(index, 0, views.length - 1), "GLB accessor bufferView 오류");
    const view = views[index],
      length = view.byteLength!;
    check(
      integer(offset, 0, length) &&
        offset % alignment === 0 &&
        ((view.byteOffset ?? 0) + offset) % alignment === 0,
      "GLB accessor 정렬 오류",
    );
    const stride = view.byteStride ?? element;
    check(
      (strideAllowed || view.byteStride === undefined) &&
        stride >= element &&
        stride % alignment === 0,
      "GLB accessor stride 오류",
    );
    check(
      offset + (count - 1) * stride + element <= length,
      "GLB accessor 범위 오류",
    );
    return (view.byteOffset ?? 0) + offset;
  };
  for (const accessor of accessors) {
    check(
      accessor && typeof accessor === "object" && !Array.isArray(accessor),
      "GLB accessor 오류",
    );
    const component = accessor.componentType,
      kind = accessor.type,
      count = accessor.count;
    check(
      typeof component === "number" &&
        components.has(component) &&
        typeof kind === "string" &&
        layouts.has(kind),
      "GLB accessor component/type 오류",
    );
    check(integer(count, 1, maxGeometry / 4), "GLB accessor count 오류");
    const size = components.get(component)!,
      [columns, rows] = layouts.get(kind)!;
    const alignment = columns > 1 ? Math.max(size, 4) : size;
    const element = columns * Math.ceil((rows * size) / alignment) * alignment;
    const referenceCost = count * columns * rows * Math.max(size, 4);
    budget += referenceCost;
    check(
      budget <= maxGeometry,
      "GLB decoded geometry는 64MiB 이하여야 합니다.",
    );
    if (accessor.normalized !== undefined)
      check(
        typeof accessor.normalized === "boolean" &&
          (!accessor.normalized ||
            [5120, 5121, 5122, 5123].includes(component)),
        "GLB accessor normalized 오류",
      );
    const offset = accessor.byteOffset === undefined ? 0 : accessor.byteOffset;
    if (accessor.bufferView !== undefined) {
      region(accessor.bufferView, offset, count, element, alignment, true);
      budget += views[accessor.bufferView].byteLength!;
    } else check(integer(offset, 0, 0), "GLB zero-filled accessor offset 오류");
    if (accessor.sparse !== undefined) {
      const sparse = accessor.sparse;
      check(
        sparse && typeof sparse === "object" && integer(sparse.count, 1, count),
        "GLB sparse count 오류",
      );
      const { indices, values } = sparse;
      check(
        indices &&
          values &&
          typeof indices === "object" &&
          typeof values === "object",
        "GLB sparse 소스 오류",
      );
      check(
        typeof indices.componentType === "number" &&
          [5121, 5123, 5125].includes(indices.componentType),
        "GLB sparse index component 오류",
      );
      const indexSize = components.get(indices.componentType)!;
      const start = region(
        indices.bufferView,
        indices.byteOffset === undefined ? 0 : indices.byteOffset,
        sparse.count,
        indexSize,
        indexSize,
      );
      region(
        values.bufferView,
        values.byteOffset === undefined ? 0 : values.byteOffset,
        sparse.count,
        element,
        alignment,
      );
      budget += sparse.count * (element + indexSize);
      check(
        budget <= maxGeometry,
        "GLB decoded geometry는 64MiB 이하여야 합니다.",
      );
      const data = new DataView(
        buffer.buffer,
        buffer.byteOffset,
        buffer.byteLength,
      );
      let previous = -1;
      for (let i = 0; i < sparse.count; i++) {
        const p = start + i * indexSize;
        const index =
          indexSize === 1
            ? data.getUint8(p)
            : indexSize === 2
              ? data.getUint16(p, true)
              : data.getUint32(p, true);
        check(
          previous < index && index < count,
          "GLB sparse index 범위 / 순서 오류",
        );
        previous = index;
      }
    }
    check(
      budget <= maxGeometry,
      "GLB decoded geometry는 64MiB 이하여야 합니다.",
    );
    referenceCosts.push(referenceCost);
  }
  return referenceCosts;
}
function validateGlbGraph(
  root: Record<string, unknown>,
  accessorCosts: number[],
): {
  nodeDefs: number;
  primitiveDefs: number;
  sceneDefs: number;
  expandedNodes: number;
  expandedPrimitives: number;
} {
  const maxExpanded = 4096;
  // Independent conservative work metric, not an exact GPU-memory cap.
  const maxReferencedGeometry = 64 * 1024 * 1024;
  const addWork = (total: number, cost: number): number => {
    check(
      cost <= maxReferencedGeometry - total,
      "GLB 반복 참조 처리량은 64MiB 이하여야 합니다. 메시 / 장면의 반복 참조를 줄이거나 모델을 단순화해 주세요.",
    );
    return total + cost;
  };
  for (const field of ["animations", "skins"] as const)
    if (Object.hasOwn(root, field))
      check(
        Array.isArray(root[field]) && root[field].length === 0,
        `새 업로드 GLB의 애니메이션 / 스켈레톤(${field})은 지원하지 않습니다. 정적 제품 모델로 내보내 주세요.`,
      );
  const emptyWeights = (value: Record<string, unknown>) => {
    if (Object.hasOwn(value, "weights"))
      check(
        Array.isArray(value.weights) && value.weights.length === 0,
        "새 업로드 GLB의 가중치(weights)는 빈 배열만 허용됩니다. 정적 제품 모델로 내보내 주세요.",
      );
  };
  const record: (
    value: unknown,
    label: string,
  ) => asserts value is Record<string, unknown> = (value, label) =>
    check(
      value && typeof value === "object" && !Array.isArray(value),
      `GLB ${label} 오류`,
    );
  const records = (value: unknown, label: string, max: number) => {
    check(
      Array.isArray(value) && value.length <= max,
      `GLB ${label} limit ${max}`,
    );
    for (const item of value) record(item, label);
    return value as Record<string, unknown>[];
  };
  const reference: (
    value: unknown,
    length: number,
  ) => asserts value is number = (value, length) =>
    check(
      typeof value === "number" &&
        Number.isSafeInteger(value) &&
        value >= 0 &&
        value < length,
      "GLB reference / 참조 오류",
    );
  const references = (value: unknown, length: number): number[] => {
    check(Array.isArray(value), "GLB graph reference list 오류");
    for (const index of value) reference(index, length);
    return value as number[];
  };
  const meshes = records(
    root.meshes === undefined ? [] : root.meshes,
    "meshes",
    1024,
  );
  const nodes = records(
    root.nodes === undefined ? [] : root.nodes,
    "nodes",
    maxExpanded,
  );
  const scenes = records(
    root.scenes === undefined ? [] : root.scenes,
    "scenes",
    maxExpanded,
  );
  const accessorCount = accessorCosts.length;
  let definedPrimitives = 0;
  let definedWork = 0;
  const meshCosts: number[] = [];
  const primitiveCounts = meshes.map((mesh) => {
    emptyWeights(mesh);
    const primitives = records(mesh.primitives, "primitives", maxExpanded);
    check(primitives.length > 0, "GLB mesh primitives 오류");
    definedPrimitives += primitives.length;
    check(
      definedPrimitives <= maxExpanded,
      "GLB primitive definitions exceed 4096",
    );
    let meshWork = 0;
    const chargeReference = (index: unknown) => {
      reference(index, accessorCount);
      definedWork = addWork(definedWork, accessorCosts[index]);
      meshWork = addWork(meshWork, accessorCosts[index]);
    };
    for (const primitive of primitives) {
      if (Object.hasOwn(primitive, "mode"))
        check(
          typeof primitive.mode === "number" &&
            Number.isSafeInteger(primitive.mode) &&
            primitive.mode === 4,
          "새 업로드 GLB는 기본 삼각형(TRIANGLES, mode 4)만 지원합니다. strip / fan 대신 삼각형으로 내보내 주세요.",
        );
      record(primitive.attributes, "primitive attributes");
      check(
        !Object.keys(primitive.attributes).some(
          (semantic) =>
            semantic.startsWith("JOINTS_") || semantic.startsWith("WEIGHTS_"),
        ),
        "새 업로드 GLB의 스켈레톤 속성(JOINTS_ / WEIGHTS_)은 지원하지 않습니다. 정적 제품 모델로 내보내 주세요.",
      );
      for (const index of Object.values(primitive.attributes))
        chargeReference(index);
      if (primitive.indices !== undefined) chargeReference(primitive.indices);
      if (primitive.targets !== undefined) {
        const targets = records(
          primitive.targets,
          "morph targets",
          maxExpanded,
        );
        for (const target of targets)
          for (const index of Object.values(target))
            reference(index, accessorCount);
        check(
          targets.length === 0,
          "새 업로드 GLB의 모프 타깃(morph targets)은 지원하지 않습니다. 정적 제품 모델로 내보내 주세요.",
        );
      }
    }
    meshCosts.push(meshWork);
    return primitives.length;
  });
  const parents = new Uint16Array(nodes.length);
  const usedMeshes = new Set<number>();
  const children = nodes.map((node) => {
    emptyWeights(node);
    check(
      !Object.hasOwn(node, "skin"),
      "새 업로드 GLB의 스켈레톤(node.skin)은 지원하지 않습니다. 정적 제품 모델로 내보내 주세요.",
    );
    if (node.mesh !== undefined) {
      reference(node.mesh, meshes.length);
      usedMeshes.add(node.mesh);
    }
    const list = references(
      node.children === undefined ? [] : node.children,
      nodes.length,
    );
    for (const child of list)
      check(
        ++parents[child] === 1,
        "GLB graph repeated child / multiple parents",
      );
    return list;
  });
  const states = new Uint8Array(nodes.length);
  const stats: [number, number, number, number][] = [];
  // Memoized subtree counts never instantiate loader nodes or enumerate expansion.
  const visit = (
    index: number,
    depth: number,
  ): [number, number, number, number] => {
    check(depth <= 64, "GLB graph depth exceeds 64");
    check(states[index] !== 1, "GLB graph cycle");
    if (states[index] === 2) return stats[index];
    states[index] = 1;
    const mesh = nodes[index].mesh as number | undefined;
    let count = 1,
      primitives = mesh === undefined ? 0 : primitiveCounts[mesh],
      height = 1,
      work = mesh === undefined ? 0 : meshCosts[mesh];
    for (const child of children[index]) {
      const [childCount, childPrimitives, childHeight, childWork] = visit(
        child,
        depth + 1,
      );
      count += childCount;
      primitives += childPrimitives;
      work = addWork(work, childWork);
      height = Math.max(height, childHeight + 1);
      check(
        count <= maxExpanded && primitives <= maxExpanded,
        "GLB expansion exceeds 4096",
      );
      check(height <= 64, "GLB graph depth exceeds 64");
    }
    states[index] = 2;
    return (stats[index] = [count, primitives, height, work]);
  };
  for (let i = 0; i < nodes.length; i++) visit(i, 1);
  if (root.scene !== undefined) reference(root.scene, scenes.length);
  let expandedNodes = 0;
  // Uninstantiated mesh definitions still consume the same primitive budget.
  let expandedPrimitives = primitiveCounts.reduce(
    (sum, count, i) => sum + (usedMeshes.has(i) ? 0 : count),
    0,
  );
  // Definition work is an independent bound, not added again to instance work.
  let expandedWork = 0;
  for (let i = 0; i < meshes.length; i++)
    if (!usedMeshes.has(i)) expandedWork = addWork(expandedWork, meshCosts[i]);
  const sceneRoots = new Set<number>();
  const charge = (index: number) => {
    expandedWork = addWork(expandedWork, stats[index][3]);
    expandedNodes += stats[index][0];
    expandedPrimitives += stats[index][1];
    check(
      expandedNodes <= maxExpanded && expandedPrimitives <= maxExpanded,
      "GLB expansion exceeds 4096 nodes / mesh primitives",
    );
  };
  for (const scene of scenes) {
    const roots = references(
      scene.nodes === undefined ? [] : scene.nodes,
      nodes.length,
    );
    const unique = new Set<number>();
    for (const index of roots) {
      check(
        parents[index] === 0 && !unique.has(index),
        "GLB graph scene roots must be unique and parentless",
      );
      unique.add(index);
      sceneRoots.add(index);
      charge(index); // Count each scene instance, including nondefault scenes.
    }
  }
  // Also charge every unused tree once; absence of scenes is valid metadata.
  for (let i = 0; i < nodes.length; i++)
    if (parents[i] === 0 && !sceneRoots.has(i)) charge(i);
  return {
    nodeDefs: nodes.length,
    primitiveDefs: definedPrimitives,
    sceneDefs: scenes.length,
    expandedNodes,
    expandedPrimitives,
  };
}
function validateGlbTextures(
  root: Record<string, unknown>,
  imagePixels: number[],
): void {
  const textures = root.textures === undefined ? [] : root.textures;
  const samplers = root.samplers === undefined ? [] : root.samplers;
  check(
    Array.isArray(textures) && textures.length <= 128,
    "GLB textures limit 128",
  );
  check(
    Array.isArray(samplers) && samplers.length <= 128,
    "GLB samplers limit 128",
  );
  const enums = {
    magFilter: [9728, 9729],
    minFilter: [9728, 9729, 9984, 9985, 9986, 9987],
    wrapS: [33071, 33648, 10497],
    wrapT: [33071, 33648, 10497],
  };
  for (const sampler of samplers) {
    check(
      sampler && typeof sampler === "object" && !Array.isArray(sampler),
      "GLB sampler 오류",
    );
    for (const [field, allowed] of Object.entries(enums))
      if (Object.hasOwn(sampler, field))
        check(
          typeof sampler[field] === "number" &&
            allowed.includes(sampler[field]),
          `GLB sampler ${field} 오류`,
        );
  }
  let work = 0;
  for (const texture of textures) {
    check(
      texture && typeof texture === "object" && !Array.isArray(texture),
      "GLB texture 오류",
    );
    if (Object.hasOwn(texture, "sampler"))
      check(
        typeof texture.sampler === "number" &&
          Number.isSafeInteger(texture.sampler) &&
          texture.sampler >= 0 &&
          texture.sampler < samplers.length,
        "GLB texture sampler 참조 오류",
      );
    const sources: unknown[] = [];
    if (Object.hasOwn(texture, "source")) sources.push(texture.source);
    if (Object.hasOwn(texture, "extensions")) {
      const extensions = texture.extensions;
      check(
        extensions &&
          typeof extensions === "object" &&
          !Array.isArray(extensions),
        "GLB texture extensions 오류",
      );
      for (const name of ["EXT_texture_webp", "EXT_texture_avif"])
        if (Object.hasOwn(extensions, name)) {
          const alternate = extensions[name];
          check(
            alternate &&
              typeof alternate === "object" &&
              !Array.isArray(alternate),
            "GLB texture source extension 오류",
          );
          sources.push(alternate.source);
        }
    }
    check(sources.length > 0, "GLB texture source가 필요합니다.");
    for (const source of sources) {
      check(
        typeof source === "number" &&
          Number.isSafeInteger(source) &&
          source >= 0 &&
          source < imagePixels.length,
        "GLB texture source 참조 오류",
      );
      // Sum EVERY potential source slot, even aliases, and every definition.
      // Two color-space cache variants in the current uncustomized Three loader.
      work += 2 * imagePixels[source];
      check(
        work <= 40_000_000,
        "GLB 텍스처 반복 처리량은 40,000,000 base-level pixel units 이하여야 합니다. 텍스처 정의의 반복 참조를 줄이거나 이미지를 축소해 주세요.",
      );
    }
  }
}
function validateGlbMetadata(
  root: Record<string, unknown>,
  sourceBytes: number,
  graph: ReturnType<typeof validateGlbGraph>,
  imageDefs: number,
): void {
  const materials = root.materials === undefined ? [] : root.materials;
  check(Array.isArray(materials), "GLB materials는 객체 배열이어야 합니다.");
  for (const material of materials)
    check(
      material && typeof material === "object" && !Array.isArray(material),
      "GLB material 오류",
    );
  const maximum = 64 * 1024 * 1024;
  const message =
    "GLB 메타데이터 반복 처리량은 64MiB 이하여야 합니다. extras / 확장 / 이름을 줄이거나 반복 메시 / 장면 / 재질 참조를 줄여 주세요.";
  check(sourceBytes > 0 && sourceBytes <= maximum, message);
  const maxClones = Math.floor(maximum / sourceBytes);
  let clones = 1;
  const charge = (count: number, factor: number) => {
    // Check remaining/division BEFORE multiplying; never enumerate clones.
    check(count <= Math.floor((maxClones - clones) / factor), message);
    clones += count * factor;
  };
  for (const count of Object.values(graph)) charge(count, 4);
  // TRIANGLES only: three boolean material flags => <=8 variants + base.
  charge(materials.length + 1, 9); // Include the implicit default material.
  charge((root.textures as unknown[] | undefined)?.length ?? 0, 4);
  charge(imageDefs, 1);
  const pending: unknown[] = [...materials];
  while (pending.length) {
    const value = pending.pop();
    if (Array.isArray(value)) pending.push(...value);
    else if (value && typeof value === "object")
      for (const [key, child] of Object.entries(value)) {
        // All material subobjects, including unknown extensions/extras. No
        // dedupe/reference filtering. Metallic/roughness assigns the slot twice.
        if (key.endsWith("Texture"))
          charge(key === "metallicRoughnessTexture" ? 2 : 1, 2);
        pending.push(child);
      }
  }
}
export function validateGlb(b: Uint8Array): void {
  check(b.length >= 20, "GLB 파일이 너무 짧습니다.");
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  check(
    v.getUint32(0, true) === 0x46546c67 &&
      v.getUint32(4, true) === 2 &&
      v.getUint32(8, true) === b.length,
    "유효한 GLB 2.0 파일이 아닙니다.",
  );
  let offset = 12,
    chunks = 0,
    json: unknown,
    integerPrimitiveModes = true,
    integerTextureNumbers = true,
    metadataBytes = 0,
    binaryLength: number | undefined,
    binary: Uint8Array = new Uint8Array();
  while (offset < b.length) {
    check(offset + 8 <= b.length, "GLB 청크 헤더 오류");
    const length = v.getUint32(offset, true),
      type = v.getUint32(offset + 4, true);
    offset += 8;
    check(
      length % 4 === 0 && offset + length <= b.length,
      "GLB 청크 길이 오류",
    );
    if (chunks === 0) {
      check(type === 0x4e4f534a, "첫 GLB 청크는 JSON이어야 합니다.");
      try {
        // JS erases decimal/exponent spelling during JSON.parse. Retain
        // field-specific checks for parity with the importer's integer rules.
        json = strictJson(
          b.subarray(offset, offset + length),
          (token) => {
            integerPrimitiveModes &&= token === "4";
          },
          (token) => {
            integerTextureNumbers &&= /^-?\d+$/.test(token);
          },
          (value) => {
            metadataBytes = value;
          },
        );
      } catch {
        fail("GLB JSON 오류");
      }
    } else {
      check(
        chunks === 1 && type === 0x004e4942,
        "지원하지 않는 GLB 청크입니다.",
      );
      binaryLength = length;
      binary = b.subarray(offset, offset + length);
    }
    offset += length;
    chunks++;
  }
  check(
    integerPrimitiveModes,
    "새 업로드 GLB는 정수 4의 기본 삼각형(TRIANGLES)만 지원합니다. mode의 소수 / 지수 표기를 제거하고 삼각형으로 내보내 주세요.",
  );
  check(
    integerTextureNumbers,
    "GLB texture source / sampler 필드는 정수 표기여야 합니다.",
  );
  const root = json as {
    asset?: { version?: string; minVersion?: string };
    buffers?: { byteLength?: number; uri?: string }[];
    bufferViews?: GlbView[];
    accessors?: GlbAccessor[];
    images?: { bufferView?: number; mimeType?: string; uri?: string }[];
  };
  check(
    root &&
      root.asset?.version === "2.0" &&
      (!root.asset.minVersion || root.asset.minVersion === "2.0"),
    "GLB asset.version 2.0이 필요합니다.",
  );
  const pending: unknown[] = [root];
  while (pending.length) {
    const value = pending.pop();
    if (Array.isArray(value)) {
      for (const child of value) pending.push(child);
      continue;
    }
    if (!value || typeof value !== "object") continue;
    for (const [key, child] of Object.entries(value)) {
      if (key === "uri") dataResource(child);
      if (
        [
          "KHR_draco_mesh_compression",
          "EXT_meshopt_compression",
          "KHR_texture_basisu",
          "EXT_mesh_gpu_instancing",
        ].includes(key)
      )
        fail("Draco / Meshopt / BasisU / GPU instancing은 지원하지 않습니다.");
      if (key === "extensionsRequired" || key === "extensionsUsed")
        check(
          Array.isArray(child) &&
            child.every((x) => typeof x === "string") &&
            !child.some((x) =>
              [
                "KHR_draco_mesh_compression",
                "EXT_meshopt_compression",
                "KHR_texture_basisu",
                "EXT_mesh_gpu_instancing",
              ].includes(x),
            ),
          "지원하지 않는 GLB 디코더입니다.",
        );
      pending.push(child);
    }
  }
  const buffers = root.buffers ?? [];
  check(Array.isArray(buffers) && buffers.length <= 1, "GLB 버퍼 오류");
  let bufferLength = 0;
  let bufferData: Uint8Array = binary;
  if (buffers.length) {
    bufferLength = buffers[0]?.byteLength ?? 0;
    check(
      Number.isInteger(bufferLength) &&
        bufferLength > 0 &&
        bufferLength <= L.uncompressedBytes,
      "GLB 버퍼 길이 오류",
    );
    if (buffers[0].uri !== undefined) {
      const resource = dataResource(buffers[0].uri);
      bufferData = resource.data;
      check(
        resource.mime === "application/octet-stream" &&
          resource.data.length === bufferLength &&
          binaryLength === undefined,
        "GLB 데이터 URI / 버퍼 길이가 다릅니다.",
      );
    } else
      check(
        binaryLength !== undefined &&
          binaryLength >= bufferLength &&
          binaryLength <= bufferLength + 3,
        "GLB BIN / 버퍼 길이가 다릅니다.",
      );
  } else check(binaryLength === undefined, "GLB 미참조 BIN 청크");
  // Independent encoded-source-copy work: definitions, never unique regions.
  // Preflight every view before accessor/sparse processing can read its bytes.
  const maxSourceCopy = 64 * 1024 * 1024;
  let sourceCopyRemaining = maxSourceCopy;
  const chargeSourceCopy = (length: number) => {
    check(
      length <= sourceCopyRemaining,
      "GLB 인코딩 원본 복사 처리량(encoded-source-copy)은 64MiB 이하여야 합니다. bufferView / 이미지 원본 또는 반복 정의를 줄여 주세요.",
    );
    sourceCopyRemaining -= length;
  };
  const views = root.bufferViews ?? [];
  check(Array.isArray(views), "GLB bufferViews 오류");
  for (const view of views) {
    const start = view?.byteOffset === undefined ? 0 : view.byteOffset,
      length = view?.byteLength ?? 0;
    check(
      view?.buffer === 0 &&
        Number.isInteger(start) &&
        Number.isInteger(length) &&
        start >= 0 &&
        length > 0 &&
        start + length <= bufferLength,
      "GLB bufferView 범위 오류",
    );
    if (view.byteStride !== undefined)
      check(
        Number.isInteger(view.byteStride) &&
          view.byteStride >= 4 &&
          view.byteStride <= 252 &&
          view.byteStride % 4 === 0,
        "GLB bufferView stride 오류",
      );
    chargeSourceCopy(length);
  }
  const images = root.images ?? [];
  check(
    Array.isArray(images) && images.length <= 60,
    "GLB images는 최대 60개입니다.",
  );
  const resolvedImages: { data: Uint8Array; mime: string }[] = [];
  for (const image of images) {
    let imageData: Uint8Array, mime: string;
    if (image?.uri !== undefined) {
      check(image.bufferView === undefined, "GLB 이미지 소스 중복");
      const resource = dataResource(image.uri);
      check(
        resource.mime.startsWith("image/") &&
          (!image.mimeType || image.mimeType === resource.mime),
        "GLB 이미지 데이터 URI MIME 오류",
      );
      imageData = resource.data;
      mime = resource.mime;
    } else {
      check(
        Number.isInteger(image?.bufferView) &&
          image.bufferView! >= 0 &&
          image.bufferView! < views.length &&
          ["image/png", "image/jpeg", "image/webp"].includes(
            image.mimeType ?? "",
          ),
        "GLB 내장 이미지 오류",
      );
      const view = views[image.bufferView!],
        start = view.byteOffset ?? 0;
      imageData = bufferData.subarray(start, start + view.byteLength!);
      mime = image.mimeType!;
    }
    // Each image record adds its encoded source bytes, even for the same
    // bufferView/URI. Charge before any container scan or CRC work.
    chargeSourceCopy(imageData.byteLength);
    resolvedImages.push({ data: imageData, mime });
  }
  const accessorCosts = validateAccessors(
    root.accessors === undefined ? [] : root.accessors,
    views,
    bufferData,
  );
  const graph = validateGlbGraph(root, accessorCosts);
  let texturePixels = 0;
  const imagePixels: number[] = [];
  for (const { data: imageData, mime } of resolvedImages) {
    const info = imageHeader(imageData.subarray(0, 1024 * 1024));
    check(
      mime === `image/${info.ext === "jpg" ? "jpeg" : info.ext}`,
      "GLB 이미지 MIME / 형식 오류",
    );
    validateImage(imageData);
    imagePixels.push(info.width * info.height);
    texturePixels += info.width * info.height;
    check(
      texturePixels <= L.imagePixels,
      "GLB 내장 이미지 합계는 40MP 이하여야 합니다.",
    );
  }
  validateGlbTextures(root, imagePixels);
  validateGlbMetadata(root, metadataBytes, graph, images.length);
}
export async function inspectAsset(
  file: File,
  id: string,
): Promise<{ asset: AdminAsset; blob: Blob }> {
  check(validId(id), "잘못된 에셋 ID");
  check(
    file.size > 0 && file.size <= L.uncompressedBytes,
    "파일은 0바이트 초과, 50MiB 이하여야 합니다. ZIP 전체는 25MiB 이하여야 합니다.",
  );
  const extension = file.name.split(".").pop()?.toLowerCase();
  let dimensions: { ext: string; width: number; height: number } | undefined;
  if (extension !== "glb") {
    dimensions = imageHeader(await bytes(file.slice(0, 1024 * 1024)));
    check(
      extension === dimensions.ext ||
        (extension === "jpeg" && dimensions.ext === "jpg"),
      "파일 확장자와 실제 이미지 형식이 다릅니다.",
    );
  }
  const data = await bytes(file);
  if (extension === "glb") validateGlb(data);
  else {
    validateImage(data);
    await decodeImage(file);
  }
  const ext = extension === "jpeg" ? "jpeg" : (dimensions?.ext ?? "glb");
  return {
    asset: {
      id,
      path: `assets/${id}.${ext}`,
      name: file.name,
      kind: dimensions ? "image" : "model",
      sha256: await sha256(data),
      bytes: data.length,
      ...(dimensions
        ? { width: dimensions.width, height: dimensions.height }
        : {}),
    },
    blob: file,
  };
}
export function validatePackage(
  manifest: AdminPackage,
  legacyIds: readonly string[] = [],
): void {
  shape(manifest, "schemaVersion project blocks models assets", "패키지");
  check(
    manifest && manifest.schemaVersion === 1,
    "지원하지 않는 패키지 버전입니다.",
  );
  const { project, blocks, models, assets } = manifest;
  shape(project, "id title category thumbnail", "프로젝트");
  check(
    project &&
      typeof project.id === "string" &&
      /^jd\d{3}(?:_[a-z]+)?$/.test(project.id),
    "프로젝트 ID는 jd046 또는 jd046_a 형식이어야 합니다.",
  );
  check(
    !legacyIds.includes(project.id),
    "기존 레거시 프로젝트 ID는 덮어쓸 수 없습니다.",
  );
  const text = (s: unknown, max: number, required = false) =>
    typeof s === "string" &&
    s.length <= max &&
    (!required || s.trim().length > 0) &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff]/u.test(s);
  check(text(project.title, 200, true), "제목을 1~200자로 입력해 주세요.");
  check(
    ["Product", "UX/UI"].includes(project.category),
    "올바른 카테고리를 선택해 주세요.",
  );
  check(
    Array.isArray(assets) && assets.length <= L.assets,
    "에셋은 최대 60개입니다.",
  );
  const ids = new Set<string>(),
    paths = new Set<string>();
  for (const a of assets) {
    shape(
      a,
      "id path name kind sha256 bytes" +
        (a.kind === "image" ? " width height" : ""),
      "에셋",
    );
    check(
      a && validId(a.id) && !ids.has(a.id),
      "에셋 ID가 올바르지 않거나 중복됩니다.",
    );
    ids.add(a.id);
    check(
      typeof a.path === "string" &&
        /^assets\/[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp|glb)$/.test(a.path) &&
        !paths.has(a.path.toLowerCase()),
      "에셋 경로가 올바르지 않거나 중복됩니다.",
    );
    paths.add(a.path.toLowerCase());
    check(
      text(a.name, 500, true) &&
        ["image", "model"].includes(a.kind) &&
        /^[a-f0-9]{64}$/.test(a.sha256) &&
        Number.isSafeInteger(a.bytes) &&
        a.bytes > 0 &&
        a.bytes <= L.uncompressedBytes,
      "에셋 메타데이터 오류",
    );
    check(
      (a.kind === "model") === a.path.endsWith(".glb"),
      "에셋 종류와 확장자가 다릅니다.",
    );
    if (a.kind === "image")
      check(
        Number.isInteger(a.width) &&
          Number.isInteger(a.height) &&
          a.width! > 0 &&
          a.height! > 0 &&
          a.width! <= L.imageSide &&
          a.height! <= L.imageSide &&
          a.width! * a.height! <= L.imagePixels,
        "이미지 크기 제한을 초과했습니다.",
      );
  }
  const asset = (id: unknown, kind: string) =>
    validId(id) && assets.some((a) => a.id === id && a.kind === kind);
  check(asset(project.thumbnail, "image"), "대표 이미지를 업로드해 주세요.");
  check(
    Array.isArray(models) &&
      models.length <= L.models &&
      new Set(models).size === models.length &&
      models.every((id) => asset(id, "model")),
    "3D 모델은 중복 없이 최대 4개입니다.",
  );
  check(
    Array.isArray(blocks) && blocks.length <= L.blocks,
    "블록은 최대 100개입니다.",
  );
  const used = new Set([project.thumbnail, ...models]),
    blockIds = new Set<string>();
  for (const b of blocks) {
    check(b && validId(b.id) && !blockIds.has(b.id), "블록 ID 오류");
    blockIds.add(b.id);
    switch (b.type) {
      case "images":
        shape(b, "id type columns images", "이미지 블록");
        check(
          [1, 2, 3, 4].includes(b.columns) &&
            Array.isArray(b.images) &&
            b.images.length >= 1 &&
            b.images.length <= L.imagesPerBlock,
          "이미지 블록에 1~12개 이미지를 추가해 주세요.",
        );
        for (const i of b.images) {
          shape(i, "assetId alt caption", "이미지 참조");
          check(
            asset(i.assetId, "image") &&
              text(i.alt, 300) &&
              text(i.caption, 500),
            "이미지 참조 / 설명 오류",
          );
          used.add(i.assetId);
        }
        break;
      case "heading":
        shape(b, "id type level text", "제목 블록");
        check(
          [2, 3].includes(b.level) && text(b.text, 200, true),
          "제목 블록 내용을 입력해 주세요.",
        );
        break;
      case "paragraph":
        shape(b, "id type text", "본문 블록");
        check(text(b.text, 10000, true), "본문 내용을 입력해 주세요.");
        break;
      case "spacer":
        shape(b, "id type size", "여백 블록");
        check(["small", "medium", "large"].includes(b.size), "여백 크기 오류");
        break;
      case "divider":
        shape(b, "id type", "구분선 블록");
        break;
      default:
        fail("지원하지 않는 블록입니다.");
    }
  }
  check(
    assets.every((a) => used.has(a.id)),
    "참조되지 않는 에셋이 있습니다.",
  );
}
async function verifiedEntries(
  manifest: AdminPackage,
  files: Map<string, Blob>,
): Promise<Record<string, Uint8Array>> {
  const entries = Object.create(null) as Record<string, Uint8Array>;
  entries["project.json"] = strToU8(JSON.stringify(manifest, null, 2));
  check(
    entries["project.json"].length <= 1024 * 1024,
    "project.json이 너무 큽니다.",
  );
  let total = entries["project.json"].length;
  for (const a of manifest.assets) {
    const blob = files.get(a.id);
    check(blob, "원본 에셋 파일이 없습니다.");
    check(blob.size === a.bytes, "에셋 파일 크기가 다릅니다.");
    total += blob.size;
    check(
      total <= L.uncompressedBytes,
      "압축 해제 크기는 50MiB 이하여야 합니다.",
    );
    const data = await bytes(blob);
    check((await sha256(data)) === a.sha256, "에셋 체크섬이 다릅니다.");
    if (a.kind === "model") validateGlb(data);
    else {
      validateImage(data);
      const info = imageHeader(data.subarray(0, 1024 * 1024));
      check(
        a.width === info.width &&
          a.height === info.height &&
          (a.path.endsWith(`.${info.ext}`) ||
            (info.ext === "jpg" && a.path.endsWith(".jpeg"))),
        "이미지 메타데이터가 실제 파일과 다릅니다.",
      );
      await decodeImage(blob);
    }
    entries[a.path] = data;
  }
  return entries;
}
export async function createPackage(
  manifest: AdminPackage,
  files: Map<string, Blob>,
  legacyIds: readonly string[] = [],
): Promise<Blob> {
  validatePackage(manifest, legacyIds);
  const namedManifest = withCanonicalAssetFilenames(manifest);
  validatePackage(namedManifest, legacyIds);
  const entries = await verifiedEntries(namedManifest, files);
  const zipped = zipSync(entries, { level: 6 });
  check(
    zipped.length <= L.packageBytes,
    "ZIP은 25MiB 이하여야 합니다. 이미지 / 모델 수를 줄여 주세요.",
  );
  return new Blob([new Uint8Array(zipped)], { type: "application/zip" });
}
type ZipMember = {
  size: number;
  crc: number;
  method: number;
  start: number;
  end: number;
};
function zipDirectory(data: Uint8Array): Map<string, ZipMember> {
  check(data.length >= 22, "ZIP 파일이 너무 짧습니다.");
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let end = data.length - 22;
  const minimum = Math.max(0, data.length - 65557);
  for (; end >= minimum; end--)
    if (v.getUint32(end, true) === 0x06054b50) break;
  check(end >= minimum, "ZIP 디렉터리를 찾을 수 없습니다.");
  check(
    v.getUint16(end + 4, true) === 0 &&
      v.getUint16(end + 6, true) === 0 &&
      v.getUint16(end + 8, true) === v.getUint16(end + 10, true),
    "분할 ZIP은 지원하지 않습니다.",
  );
  check(
    end + 22 + v.getUint16(end + 20, true) === data.length,
    "ZIP 끝 길이 오류",
  );
  const count = v.getUint16(end + 10, true);
  check(
    count >= 1 && count <= L.assets + 1,
    "ZIP 항목 수 제한을 초과했습니다.",
  );
  let p = v.getUint32(end + 16, true),
    total = 0;
  const directory = new Map<string, ZipMember>();
  const ranges: [number, number][] = [];
  const foldedNames = new Set<string>();
  check(p + v.getUint32(end + 12, true) === end, "ZIP 중앙 디렉터리 길이 오류");
  const centralStart = p;
  for (let i = 0; i < count; i++) {
    check(
      p + 46 <= end && v.getUint32(p, true) === 0x02014b50,
      "ZIP 중앙 디렉터리 오류",
    );
    const flags = v.getUint16(p + 8, true),
      method = v.getUint16(p + 10, true),
      compressed = v.getUint32(p + 20, true),
      size = v.getUint32(p + 24, true),
      n = v.getUint16(p + 28, true),
      extra = v.getUint16(p + 30, true),
      comment = v.getUint16(p + 32, true),
      mode = v.getUint32(p + 38, true) >>> 16;
    check(
      !(flags & 1) &&
        [0, 8].includes(method) &&
        [0, 0x8000].includes(mode & 0xf000) &&
        !(v.getUint32(p + 38, true) & 16),
      "암호화 / 링크 / 디렉터리 ZIP은 허용되지 않습니다.",
    );
    check(p + 46 + n + extra + comment <= end, "ZIP 항목 길이 오류");
    const name = new TextDecoder("utf-8", { fatal: true }).decode(
      data.subarray(p + 46, p + 46 + n),
    );
    check(
      name === "project.json" ||
        /^assets\/[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp|glb)$/.test(name),
      "허용되지 않는 ZIP 경로입니다.",
    );
    check(!foldedNames.has(name.toLowerCase()), "중복 ZIP 경로입니다.");
    foldedNames.add(name.toLowerCase());
    const crc = v.getUint32(p + 16, true);
    total += size;
    check(
      total <= L.uncompressedBytes,
      "압축 해제 크기는 50MiB 이하여야 합니다.",
    );
    check(
      name !== "project.json" || size <= 1024 * 1024,
      "project.json이 너무 큽니다.",
    );
    const local = v.getUint32(p + 42, true);
    check(
      local + 30 <= centralStart && v.getUint32(local, true) === 0x04034b50,
      "ZIP 로컬 헤더 오류",
    );
    const localName = v.getUint16(local + 26, true),
      localExtra = v.getUint16(local + 28, true),
      payload = local + 30 + localName + localExtra,
      payloadEnd = payload + compressed;
    check(
      payloadEnd <= centralStart &&
        new TextDecoder("utf-8", { fatal: true }).decode(
          data.subarray(local + 30, local + 30 + localName),
        ) === name &&
        v.getUint16(local + 6, true) === flags &&
        v.getUint16(local + 8, true) === method,
      "ZIP 로컬 헤더 불일치",
    );
    if (!(flags & 8))
      check(
        v.getUint32(local + 14, true) === crc &&
          v.getUint32(local + 18, true) === compressed &&
          v.getUint32(local + 22, true) === size,
        "ZIP CRC / 크기 헤더 불일치",
      );
    check(
      !ranges.some(([a, b]) => local < b && payloadEnd > a),
      "ZIP 데이터 범위가 겹칩니다.",
    );
    directory.set(name, { size, crc, method, start: payload, end: payloadEnd });
    ranges.push([local, payloadEnd]);
    p += 46 + n + extra + comment;
  }
  check(
    p === end && directory.has("project.json"),
    "ZIP 디렉터리 또는 project.json 오류",
  );
  return directory;
}
export async function readPackage(file: File): Promise<PackageData> {
  check(
    file.size > 0 && file.size <= L.packageBytes,
    "ZIP은 25MiB 이하여야 합니다.",
  );
  const data = await bytes(file),
    names = zipDirectory(data);
  let expanded = 0;
  const entries = Object.create(null) as Record<string, Uint8Array>;
  for (const [name, meta] of names) {
    const output = new Uint8Array(meta.size);
    let written = 0;
    const accept = (chunk: Uint8Array) => {
      expanded += chunk.length;
      check(
        written + chunk.length <= meta.size && expanded <= L.uncompressedBytes,
        "ZIP 압축 해제 제한 오류",
      );
      output.set(chunk, written);
      written += chunk.length;
    };
    if (meta.method === 0) accept(data.subarray(meta.start, meta.end));
    else {
      // Native streaming inflation validates real DEFLATE EOF and rejects trailing
      // bytes. Never trust ZIP originalSize or a caller-supplied final flag.
      let position = meta.start;
      const input = new ReadableStream<BufferSource>({
        pull(controller) {
          if (position === meta.end) {
            controller.close();
            return;
          }
          const end = Math.min(position + 256, meta.end);
          controller.enqueue(data.subarray(position, end));
          position = end;
        },
      });
      const reader = input
        .pipeThrough(new DecompressionStream("deflate-raw"))
        .getReader();
      try {
        while (true) {
          const result = await reader.read();
          if (result.done) break;
          accept(result.value);
        }
      } catch (error) {
        await reader.cancel().catch(() => {});
        throw error;
      } finally {
        reader.releaseLock();
      }
    }
    check(written === meta.size, "ZIP CRC / 크기 오류");
    entries[name] = output;
  }
  check(
    Object.keys(entries).length === names.size,
    "ZIP 항목이 일치하지 않습니다.",
  );
  let manifest: AdminPackage;
  for (const [name, meta] of names)
    check(
      entries[name]?.length === meta.size && crc32(entries[name]) === meta.crc,
      "ZIP CRC / 크기 오류",
    );
  try {
    manifest = strictJson(entries["project.json"]) as AdminPackage;
  } catch {
    return fail("project.json JSON을 읽을 수 없습니다.");
  }
  validatePackage(manifest);
  check(
    file.name === `${manifest.project.id}.zip`,
    "ZIP 파일명은 프로젝트 ID와 같아야 합니다.",
  );
  check(
    names.size === manifest.assets.length + 1,
    "참조되지 않는 ZIP 파일이 있습니다.",
  );
  const files = new Map<string, Blob>();
  for (const a of manifest.assets) {
    check(entries[a.path], "ZIP 에셋이 없습니다.");
    files.set(a.id, new Blob([new Uint8Array(entries[a.path])]));
  }
  await verifiedEntries(manifest, files);
  return { manifest, files };
}
