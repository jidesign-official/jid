import { aboutIntroduction, aboutPhilosophy, aboutServices, companyHistory } from "../data/about";

export type AboutContent = {
  schemaVersion: 1;
  headings: { eyebrow: string; philosophy: string; history: string; services: string };
  introduction: { title: string; subtitle: string; paragraph: string };
  philosophy: { id: string; title: string; subtitle: string; paragraph: string }[];
  history: { year: string; events: string[] }[];
  services: { name: string; description: string }[];
  links: { portfolioLabel: string; contactLabel: string };
};

export const ABOUT_CONTENT_FILENAME = "about-content.json";
export const MAX_ABOUT_CONTENT_BYTES = 64 * 1024;

function object(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new Error(`${label}은 JSON 객체여야 합니다.`);
  }
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || !keys.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable && Object.hasOwn(descriptor, "value");
  })) {
    throw new Error(`${label}에는 ${keys.join(", ")} 필드만 모두 있어야 합니다. 누락·추가 필드를 확인하세요.`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, max: number, label: string): void {
  if (typeof value !== "string" || value.length > max || !/\S/u.test(value) || /[\u0000-\u0008\u000b-\u001f\u007f]/u.test(value)) {
    throw new Error(`${label}은 공백만이 아닌 ${max}자 이내 텍스트여야 합니다. 줄바꿈·탭 외 제어 문자를 제거하세요.`);
  }
}

function list(value: unknown, min: number, max: number, label: string): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length < min || value.length > max || Reflect.ownKeys(value).length !== value.length + 1) {
    throw new Error(`${label}은 ${min}~${max}개 항목의 JSON 배열이어야 합니다.`);
  }
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) throw new Error(`${label}의 빈 항목·접근자 속성을 제거하세요.`);
  }
  return value;
}

function unique(value: string, seen: Set<string>, label: string): void {
  if (seen.has(value)) throw new Error(`${label}이 중복되었습니다. 서로 다른 값을 사용하세요: ${value}`);
  seen.add(value);
}

export function validateAboutContent(value: unknown): asserts value is AboutContent {
  const content = object(value, ["schemaVersion", "headings", "introduction", "philosophy", "history", "services", "links"], "About 콘텐츠");
  if (content.schemaVersion !== 1) throw new Error("schemaVersion은 숫자 1이어야 합니다.");
  const headings = object(content.headings, ["eyebrow", "philosophy", "history", "services"], "headings");
  for (const [key, value] of Object.entries(headings)) text(value, 120, `headings.${key}`);
  const intro = object(content.introduction, ["title", "subtitle", "paragraph"], "introduction");
  text(intro.title, 240, "introduction.title");
  text(intro.subtitle, 500, "introduction.subtitle");
  text(intro.paragraph, 6000, "introduction.paragraph");
  const links = object(content.links, ["portfolioLabel", "contactLabel"], "links");
  for (const [key, value] of Object.entries(links)) text(value, 120, `links.${key}`);
  const ids = new Set<string>();
  const years = new Set<string>();
  const names = new Set<string>();
  const reserved = new Set(["about-introduction", "about-philosophy", "about-history", "about-services"]);
  for (const block of list(content.philosophy, 0, 12, "philosophy")) {
    const entry = object(block, ["id", "title", "subtitle", "paragraph"], "philosophy");
    if (typeof entry.id !== "string" || /^[a-z][a-z0-9-]{0,63}$/.exec(entry.id)?.[0] !== entry.id || reserved.has(entry.id)) {
      throw new Error("philosophy.id는 예약 ID가 아닌 영문 소문자로 시작하는 64자 이내 영문 소문자·숫자·하이픈이어야 합니다.");
    }
    unique(entry.id, ids, "philosophy.id");
    text(entry.title, 240, "philosophy.title");
    text(entry.subtitle, 500, "philosophy.subtitle");
    text(entry.paragraph, 6000, "philosophy.paragraph");
  }
  for (const block of list(content.history, 0, 100, "history")) {
    const entry = object(block, ["year", "events"], "history");
    if (typeof entry.year !== "string" || /^[1-9][0-9]{3}$/.exec(entry.year)?.[0] !== entry.year) {
      throw new Error("history.year는 1000~9999 범위의 네 자리 ASCII 숫자 문자열이어야 합니다.");
    }
    unique(entry.year, years, "history.year");
    for (const event of list(entry.events, 1, 30, "history.events")) text(event, 1000, "history.events");
  }
  for (const block of list(content.services, 0, 30, "services")) {
    const entry = object(block, ["name", "description"], "services");
    text(entry.name, 240, "services.name");
    unique(entry.name as string, names, "services.name");
    text(entry.description, 2000, "services.description");
  }
  assertEncodedSize(content);
}

function sizeError(): never {
  throw new Error("About 콘텐츠 파일은 UTF-8 기준 64 KiB 이하여야 합니다. 텍스트나 항목 수를 줄이세요.");
}

function assertSourceSize(source: string): void {
  // Check code units before allocating the UTF-8 buffer.
  if (typeof source !== "string" || source.length > MAX_ABOUT_CONTENT_BYTES || new TextEncoder().encode(source).byteLength > MAX_ABOUT_CONTENT_BYTES) sizeError();
}

function assertEncodedSize(value: unknown, pretty = false): void {
  // Only called after strict schema validation: leaves/cardinalities/depth are already bounded.
  // Count tokens incrementally, before stringify can amplify the entire object or add indentation.
  let size = pretty ? 1 : 0; // canonical export's trailing newline
  const add = (bytes: number) => { size += bytes; if (size > MAX_ABOUT_CONTENT_BYTES) sizeError(); };
  const visit = (node: unknown, depth: number): void => {
    if (node === null || typeof node !== "object") {
      add(new TextEncoder().encode(JSON.stringify(node)).byteLength);
      return;
    }
    const array = Array.isArray(node);
    const entries = Object.entries(node);
    add(2); // opening/closing bracket or brace
    if (entries.length && pretty) add(2 + depth * 2); // first/last newline and closing indent
    for (let i = 0; i < entries.length; i++) {
      if (i) add(pretty ? 2 : 1); // comma and optional newline
      if (pretty) add((depth + 1) * 2);
      const [key, child] = entries[i];
      if (!array) add(new TextEncoder().encode(JSON.stringify(key)).byteLength + (pretty ? 2 : 1));
      visit(child, depth + 1);
    }
  };
  visit(value, 0);
}

function inspectJSON(source: string): void {
  // Bounded iterative scan: never recurse into untrusted input. JSON.parse is the syntax authority.
  // Decode each object key to catch escaped aliases at *every* nesting level.
  const stack: (Set<string> | null)[] = [];
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
      const keys = stack[stack.length - 1];
      if (keys && source[next] === ":") {
        const key: string = JSON.parse(source.slice(start, i + 1));
        if (keys.has(key)) throw new Error(`About JSON 필드가 중복되었습니다. 중복 필드를 제거하세요: ${key}`);
        keys.add(key);
      }
    } else if (token === "{" || token === "[") {
      stack.push(token === "{" ? new Set<string>() : null);
      if (stack.length > 8) throw new Error("About JSON 중첩은 최대 8단계입니다. 불필요한 중첩을 제거하세요.");
    } else if (token === "}" || token === "]") stack.pop();
  }
}

export function parseAboutContent(source: string): AboutContent {
  assertSourceSize(source);
  let value: unknown;
  try {
    inspectJSON(source);
    value = JSON.parse(source);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new Error("About JSON 형식이 올바르지 않습니다. 쉼표·따옴표·괄호를 확인하세요.");
  }
  validateAboutContent(value);
  return value;
}

export function serializeAboutContent(value: AboutContent): string {
  validateAboutContent(value);
  assertEncodedSize(value, true);
  return JSON.stringify(value, null, 2) + "\n";
}

export function createDefaultAboutContent(): AboutContent {
  return {
    schemaVersion: 1,
    headings: { eyebrow: "About Us", philosophy: "Design Philosophy", history: "Company History", services: "Our Services" },
    introduction: { ...aboutIntroduction },
    philosophy: aboutPhilosophy.map(block => ({ ...block })),
    history: companyHistory.map(entry => ({ year: entry.year, events: [...entry.events] })),
    services: aboutServices.map(service => ({ ...service })),
    links: { portfolioLabel: "View Portfolio", contactLabel: "Start a Project" },
  };
}
