import { parseFragment, Tokenizer, type TokenHandler, type DefaultTreeAdapterTypes } from "parse5";
import { validateAboutContent, type AboutContent } from "./aboutContent";

export const MAX_ABOUT_HTML_BYTES = 512 * 1024;

type Element = DefaultTreeAdapterTypes.Element;
type Parent = DefaultTreeAdapterTypes.ParentNode;
type Attributes = Readonly<Record<string, string>>;
const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

function invalid(detail: string): never {
  throw new Error(`About HTML: ${detail} 템플릿의 data-about-* 표시와 요소 순서를 확인하세요.`);
}

function escape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** A compatible source representation, never executable HTML or a second saved document. */
export function aboutContentToHtml(content: AboutContent): string {
  validateAboutContent(content);
  const lines: string[] = [];
  const open = (depth: number, tag: string, attrs: Attributes = {}) => {
    lines.push(`${"  ".repeat(depth)}<${tag}${Object.entries(attrs).map(([key, value]) => ` ${key}="${escape(value)}"`).join("")}>`);
  };
  const close = (depth: number, tag: string) => { lines.push(`${"  ".repeat(depth)}</${tag}>`); };
  const field = (depth: number, tag: string, text: string, attrs: Attributes = {}) => {
    open(depth, tag, attrs);
    lines[lines.length - 1] += `${escape(text)}</${tag}>`;
  };
  open(0, "article", { "data-about-document": "1" });
  open(1, "section", { "data-about-section": "introduction" });
  field(2, "p", content.headings.eyebrow, { "data-about-field": "eyebrow" });
  field(2, "h1", content.introduction.title, { "data-about-field": "title" });
  field(2, "p", content.introduction.subtitle, { "data-about-field": "subtitle" });
  field(2, "p", content.introduction.paragraph, { "data-about-field": "paragraph" });
  open(2, "nav");
  field(3, "a", content.links.portfolioLabel, { "data-about-field": "portfolioLabel", href: "/portfolio" });
  field(3, "a", content.links.contactLabel, { "data-about-field": "contactLabel", href: "/contact" });
  close(2, "nav");
  close(1, "section");
  open(1, "section", { "data-about-section": "philosophy" });
  field(2, "h2", content.headings.philosophy);
  for (const entry of content.philosophy) {
    open(2, "section", { "data-about-id": entry.id });
    field(3, "h3", entry.title);
    field(3, "p", entry.subtitle, { "data-about-field": "subtitle" });
    field(3, "p", entry.paragraph, { "data-about-field": "paragraph" });
    close(2, "section");
  }
  close(1, "section");
  open(1, "section", { "data-about-section": "history" });
  field(2, "h2", content.headings.history);
  open(2, "ol");
  for (const entry of content.history) {
    open(3, "li");
    field(4, "time", entry.year);
    open(4, "ul");
    for (const event of entry.events) field(5, "li", event);
    close(4, "ul");
    close(3, "li");
  }
  close(2, "ol");
  close(1, "section");
  open(1, "section", { "data-about-section": "services" });
  field(2, "h2", content.headings.services);
  open(2, "dl");
  for (const entry of content.services) {
    open(3, "div");
    field(4, "dt", entry.name);
    field(4, "dd", entry.description);
    close(3, "div");
  }
  close(2, "dl");
  close(1, "section");
  close(0, "article");
  const source = lines.join("\n") + "\n";
  // Exercise the same parser/validator used on mode exit before exposing a source.
  // In particular, parse5 rejects lone surrogates and noncharacters rather than coercing them.
  const roundTrip = aboutHtmlToContent(source);
  if (!sameValues(content, roundTrip)) invalid("이 텍스트를 HTML로 손실 없이 표현할 수 없습니다. 원본 초안은 유지됩니다.");
  return source;
}

function sameValues(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== "object" || left === null || typeof right !== "object" || right === null) return false;
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && sameValues(a[key], b[key]));
}

function element(node: Element | undefined, tag: string, attrs: Attributes = {}): Element {
  if (!node || node.tagName !== tag || node.namespaceURI !== HTML_NAMESPACE ||
      node.attrs.length !== Object.keys(attrs).length || node.attrs.some(attr =>
        attr.namespace || attr.prefix || attrs[attr.name] !== attr.value || !Object.hasOwn(attrs, attr.name))) {
    invalid(`<${tag}> 요소 또는 속성이 올바르지 않습니다.`);
  }
  return node;
}

function children(parent: Parent, count?: number): Element[] {
  const result: Element[] = [];
  for (const node of parent.childNodes) {
    if (node.nodeName === "#text" && "value" in node && /^[\t\n\r\f ]*$/.test(node.value)) continue;
    if (!("tagName" in node)) invalid("구조 사이에 텍스트·주석을 넣을 수 없습니다.");
    result.push(node);
  }
  if (count !== undefined && result.length !== count) invalid("요소 개수 또는 순서가 올바르지 않습니다.");
  return result;
}

function text(node: Element | undefined, tag: string, attrs: Attributes = {}): string {
  const target = element(node, tag, attrs);
  let value = "";
  for (const child of target.childNodes) {
    if (!("value" in child) || child.nodeName !== "#text") invalid(`<${tag}>에는 텍스트만 넣을 수 있습니다. 인라인 태그를 제거하세요.`);
    value += child.value;
  }
  return value;
}

type TokenElement = { tag: string; parent: number; start: number; end: number };

const ALLOWED_ATTRIBUTES: Readonly<Record<string, readonly string[]>> = {
  article: ["data-about-document"], section: ["data-about-section", "data-about-id"],
  p: ["data-about-field"], h1: ["data-about-field"], h2: [], h3: [], nav: [],
  a: ["data-about-field", "href"], ol: [], li: [], time: [], ul: [], dl: [], div: [], dt: [], dd: [],
};

function parseError(error: { code: string; startLine?: number; startCol?: number }): never {
  invalid(`HTML 문법 오류 (${error.code}${error.startLine ? `, ${error.startLine}행 ${error.startCol}열` : ""})입니다. 명시적인 닫는 태그와 올바른 엔티티를 사용하세요.`);
}

/** Tokenizer is a pinned parse5 7.3.0 export. No full tree exists during this pass. */
function preflight(source: string): TokenElement[] {
  const tokens: TokenElement[] = [];
  const stack: number[] = [];
  const handler: TokenHandler = {
    onStartTag(token) {
      if (stack.length >= 16) invalid("HTML 중첩은 최대 16단계입니다. 불필요한 중첩을 제거하세요.");
      if (tokens.length >= 6000) invalid("HTML 시작 태그는 최대 6000개입니다. 요소 수를 줄이세요.");
      if (!Object.hasOwn(ALLOWED_ATTRIBUTES, token.tagName)) invalid(`<${token.tagName}> 태그는 지원하지 않습니다.`);
      if (token.selfClosing) invalid("자체 닫힘 태그는 지원하지 않습니다. 닫는 태그를 적으세요.");
      const allowed = ALLOWED_ATTRIBUTES[token.tagName];
      if (token.attrs.some(attr => !allowed.includes(attr.name))) invalid(`<${token.tagName}>의 지원하지 않는 속성을 제거하세요.`);
      tokens.push({ tag: token.tagName, parent: stack.at(-1) ?? -1, start: token.location!.startOffset, end: -1 });
      stack.push(tokens.length - 1);
    },
    onEndTag(token) {
      const current = stack.pop();
      if (current === undefined || tokens[current].tag !== token.tagName || token.attrs.length || token.selfClosing) invalid(`</${token.tagName}> 닫는 태그가 시작 태그와 일치하지 않습니다.`);
      tokens[current].end = token.location!.startOffset;
    },
    onComment() { invalid("주석은 지원하지 않습니다. 주석을 제거하세요."); },
    onDoctype() { invalid("DOCTYPE은 지원하지 않습니다. article 템플릿만 사용하세요."); },
    onEof() { if (stack.length) invalid("닫히지 않은 태그가 있습니다. 모든 닫는 태그를 적으세요."); },
    onCharacter() {},
    onWhitespaceCharacter() {},
    onNullCharacter() { invalid("NUL 문자는 지원하지 않습니다."); },
    onParseError: parseError,
  };
  new Tokenizer({ sourceCodeLocationInfo: true }, handler).write(source, true);
  return tokens;
}

function assertUnrepairedTree(fragment: Parent, tokens: TokenElement[]): void {
  const pending = fragment.childNodes.map(node => ({ node, parent: -1 })).reverse();
  let index = 0;
  let nodes = 1; // Include the fragment and every text/element node, not only start tags.
  while (pending.length) {
    if (++nodes > 12000) invalid("HTML 전체 노드는 최대 12000개입니다. 요소나 구조 사이 공백을 줄이세요.");
    const { node, parent } = pending.pop()!;
    if (!("tagName" in node)) continue;
    const token = tokens[index];
    const location = node.sourceCodeLocation;
    if (!token || token.tag !== node.tagName || token.parent !== parent ||
        token.start !== location?.startTag?.startOffset || token.end !== location?.endTag?.startOffset) {
      invalid("HTML 자동 보정이 필요한 구조입니다. 요소 중첩과 닫는 태그를 확인하세요.");
    }
    const current = index++;
    for (let child = node.childNodes.length - 1; child >= 0; child--) pending.push({ node: node.childNodes[child], parent: current });
  }
  if (index !== tokens.length) invalid("HTML 파서가 일부 요소를 변경했습니다. 원본 템플릿 구조를 사용하세요.");
}

/** Decode a strict template into a fresh, schema-validated model; never insert source into the DOM. */
export function aboutHtmlToContent(source: string): AboutContent {
  // Cheap code-unit bound must precede UTF-8 allocation; both precede tokenization.
  if (typeof source !== "string" || source.length > MAX_ABOUT_HTML_BYTES ||
      new TextEncoder().encode(source).byteLength > MAX_ABOUT_HTML_BYTES) {
    throw new Error("About HTML 소스는 UTF-8 기준 512 KiB 이하여야 합니다. 텍스트나 불필요한 공백을 줄이세요.");
  }
  const tokens = preflight(source);
  const fragment = parseFragment(source, { sourceCodeLocationInfo: true, onParseError: parseError });
  assertUnrepairedTree(fragment, tokens);
  const root = element(children(fragment, 1)[0], "article", { "data-about-document": "1" });
  const sections = children(root, 4);
  const intro = children(element(sections[0], "section", { "data-about-section": "introduction" }), 5);
  const nav = children(element(intro[4], "nav"), 2);
  const philosophy = children(element(sections[1], "section", { "data-about-section": "philosophy" }));
  const history = children(element(sections[2], "section", { "data-about-section": "history" }), 2);
  const services = children(element(sections[3], "section", { "data-about-section": "services" }), 2);
  const value: AboutContent = {
    schemaVersion: 1,
    headings: {
      eyebrow: text(intro[0], "p", { "data-about-field": "eyebrow" }),
      philosophy: text(philosophy[0], "h2"),
      history: text(history[0], "h2"),
      services: text(services[0], "h2"),
    },
    introduction: {
      title: text(intro[1], "h1", { "data-about-field": "title" }),
      subtitle: text(intro[2], "p", { "data-about-field": "subtitle" }),
      paragraph: text(intro[3], "p", { "data-about-field": "paragraph" }),
    },
    links: {
      portfolioLabel: text(nav[0], "a", { "data-about-field": "portfolioLabel", href: "/portfolio" }),
      contactLabel: text(nav[1], "a", { "data-about-field": "contactLabel", href: "/contact" }),
    },
    philosophy: philosophy.slice(1).map(node => {
      const id = node.attrs.find(attr => attr.name === "data-about-id")?.value ?? "";
      const fields = children(element(node, "section", { "data-about-id": id }), 3);
      return { id, title: text(fields[0], "h3"), subtitle: text(fields[1], "p", { "data-about-field": "subtitle" }), paragraph: text(fields[2], "p", { "data-about-field": "paragraph" }) };
    }),
    history: children(element(history[1], "ol")).map(node => {
      const fields = children(element(node, "li"), 2);
      return { year: text(fields[0], "time"), events: children(element(fields[1], "ul")).map(event => text(event, "li")) };
    }),
    services: children(element(services[1], "dl")).map(node => {
      const fields = children(element(node, "div"), 2);
      return { name: text(fields[0], "dt"), description: text(fields[1], "dd") };
    }),
  };
  validateAboutContent(value);
  return value;
}
