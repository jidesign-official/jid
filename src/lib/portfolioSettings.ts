export type PortfolioSettings = {
  schemaVersion: 1;
  order: string[];
  hidden: string[];
  featured: string[];
};

export const PORTFOLIO_SETTINGS_FILENAME = "portfolio-settings.json";
export const MAX_PORTFOLIO_SETTINGS_BYTES = 64 * 1024;
export const DEFAULT_FEATURED_IDS = ["jd025_c", "jd008_b", "jd005_b", "jd013"];

export function createDefaultPortfolioSettings(projectIds: readonly string[]): PortfolioSettings {
  return normalizePortfolioSettings({ schemaVersion: 1, order: [], hidden: [], featured: [...DEFAULT_FEATURED_IDS] }, projectIds);
}

const validId = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 80 &&
  /^jd[0-9]{3}(?:_[a-z]+)?$/.exec(value)?.[0] === value;

export function validatePortfolioSettings(value: unknown, projectIds: readonly string[]): asserts value is PortfolioSettings {
  if (!Array.isArray(projectIds) || projectIds.length > 1000 ||
      !Array.from(projectIds).every(validId) || new Set(projectIds).size !== projectIds.length) {
    throw new Error("전체 프로젝트 목록은 올바른 ID를 중복 없이 1000개 이내로 포함해야 합니다.");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("설정은 네 필드를 가진 JSON 객체여야 합니다.");
  }
  const keys = Reflect.ownKeys(value);
  const required = ["schemaVersion", "order", "hidden", "featured"];
  if (keys.length !== required.length || !required.every(key => Object.hasOwn(value, key))) {
    throw new Error("설정에는 schemaVersion, order, hidden, featured만 모두 있어야 합니다.");
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1) {
    throw new Error("schemaVersion은 숫자 1이어야 합니다.");
  }
  const knownIds = new Set(projectIds);
  for (const name of ["order", "hidden", "featured"] as const) {
    const list = record[name];
    if (!Array.isArray(list) || list.length > 1000) {
      throw new Error(`${name}는 ID를 1000개 이내로 담은 배열이어야 합니다.`);
    }
    const seen = new Set<string>();
    for (const id of list) {
      if (!validId(id) || !knownIds.has(id)) {
        throw new Error(`${name}에 올바르지 않거나 현재 목록에 없는 ID가 있습니다. 프로젝트 삭제 시 설정의 참조도 수정하세요.`);
      }
      if (seen.has(id)) throw new Error(`${name}의 ID가 중복되었습니다: ${id}`);
      seen.add(id);
    }
  }
  const featured = record.featured as string[];
  const hidden = new Set(record.hidden as string[]);
  if (featured.length !== 4) {
    throw new Error("메인 대표 항목은 서로 다른 프로젝트를 정확히 4개 선택해야 합니다.");
  }
  if (featured.some(id => hidden.has(id))) {
    throw new Error("게시 제외된 프로젝트는 메인 대표 항목으로 선택할 수 없습니다. 복원하거나 다른 항목을 선택하세요.");
  }
}

export function normalizePortfolioSettings(value: PortfolioSettings, baselineIds: readonly string[]): PortfolioSettings {
  validatePortfolioSettings(value, baselineIds);
  const included = new Set(value.order);
  return {
    schemaVersion: 1,
    order: [...value.order, ...baselineIds.filter(id => !included.has(id))],
    hidden: [...value.hidden],
    featured: [...value.featured],
  };
}

function assertSourceSize(source: string): void {
  // Check UTF-16 length first so encoding cannot allocate from an unbounded input.
  if (typeof source !== "string" || source.length > MAX_PORTFOLIO_SETTINGS_BYTES ||
      new TextEncoder().encode(source).byteLength > MAX_PORTFOLIO_SETTINGS_BYTES) {
    throw new Error("설정 파일은 UTF-8 기준 64 KiB 이하여야 합니다.");
  }
}

function rejectDuplicateRootKeys(source: string): void {
  // Scan strings without recursing into values; JSON.parse remains the syntax authority.
  // Decoding each root key also detects aliases such as hidden and hidd\\u0065n.
  const keys = new Set<string>();
  let depth = 0;
  for (let i = 0; i < source.length; i++) {
    const token = source[i];
    if (token === '"') {
      const start = i++;
      while (i < source.length && source[i] !== '"') {
        if (source[i] === "\\") i++;
        i++;
      }
      let next = i + 1;
      while (next < source.length && /[\t\n\r ]/.test(source[next])) next++;
      if (depth === 1 && source[next] === ":") {
        const key: string = JSON.parse(source.slice(start, i + 1));
        if (keys.has(key)) throw new Error(`설정의 최상위 필드가 중복되었습니다: ${key}`);
        keys.add(key);
      }
    } else if (token === "{" || token === "[") depth++;
    else if (token === "}" || token === "]") depth--;
  }
}

export function parsePortfolioSettings(source: string, projectIds: readonly string[]): PortfolioSettings {
  assertSourceSize(source);
  let value: unknown;
  try {
    rejectDuplicateRootKeys(source);
    value = JSON.parse(source);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("설정 JSON 형식이 올바르지 않습니다. 파일의 쉼표, 따옴표와 괄호를 확인하세요.");
    }
    throw error;
  }
  validatePortfolioSettings(value, projectIds);
  return normalizePortfolioSettings(value, projectIds);
}

export function serializePortfolioSettings(value: PortfolioSettings, projectIds: readonly string[]): string {
  const source = JSON.stringify(normalizePortfolioSettings(value, projectIds), null, 2) + "\n";
  assertSourceSize(source);
  return source;
}
