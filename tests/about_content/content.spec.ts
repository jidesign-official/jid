import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import os from "node:os";
import vm from "node:vm";
import ts from "typescript";

const root = path.resolve(__dirname, "../..");
const load = createRequire(__filename);
type Client = typeof import("../../src/lib/aboutContent");
function client(): Client {
  expect(fs.existsSync(path.join(root, "src/lib/aboutContent.ts")), "client-safe About content module exists").toBe(true);
  return load("../../src/lib/aboutContent") as Client;
}

test("defaults reproduce the original business copy and return independent deep copies", () => {
  const api = client();
  const originals = load("../../src/data/about") as typeof import("../../src/data/about");
  const expected = {
    schemaVersion: 1,
    headings: { eyebrow: "About Us", philosophy: "Design Philosophy", history: "Company History", services: "Our Services" },
    introduction: originals.aboutIntroduction,
    philosophy: originals.aboutPhilosophy,
    history: originals.companyHistory,
    services: originals.aboutServices,
    links: { portfolioLabel: "View Portfolio", contactLabel: "Start a Project" },
  };
  expect(api.ABOUT_CONTENT_FILENAME).toBe("about-content.json");
  expect(api.MAX_ABOUT_CONTENT_BYTES).toBe(65536);
  const first = api.createDefaultAboutContent();
  expect(first).toEqual(expected);
  const businessStrings = [
    ...Object.values(first.introduction),
    ...first.philosophy.flatMap(({ title, subtitle, paragraph }) => [title, subtitle, paragraph]),
    ...first.history.flatMap(({ year, events }) => [year, ...events]),
    ...first.services.flatMap(({ name, description }) => [name, description]),
  ];
  expect(businessStrings).toHaveLength(54);
  first.introduction.title = "changed";
  first.headings.eyebrow = "changed";
  first.links.contactLabel = "changed";
  first.philosophy[0].title = "changed";
  first.history[0].events[0] = "changed";
  first.services[0].name = "changed";
  expect(api.createDefaultAboutContent()).toEqual(expected);
});

test("validator enforces exact JSON object fields at every schema level", () => {
  const api: Client = client();
  const valid = api.createDefaultAboutContent();
  expect(() => api.validateAboutContent(valid)).not.toThrow();
  const objects = [
    (v: typeof valid) => v,
    (v: typeof valid) => v.headings,
    (v: typeof valid) => v.introduction,
    (v: typeof valid) => v.philosophy[0],
    (v: typeof valid) => v.history[0],
    (v: typeof valid) => v.services[0],
    (v: typeof valid) => v.links,
  ];
  for (const target of objects) {
    for (const mutation of ["extra", "missing", "symbol", "getter", "hidden", "prototype"]) {
      const value = api.createDefaultAboutContent();
      const object = target(value) as unknown as Record<string | symbol, unknown>;
      const key = Object.keys(object)[0];
      if (mutation === "extra") object.extra = "invalid";
      if (mutation === "missing") delete object[key];
      if (mutation === "symbol") object[Symbol("invalid")] = true;
      if (mutation === "getter") Object.defineProperty(object, key, { get() { throw new Error("getter executed"); } });
      if (mutation === "hidden") Object.defineProperty(object, key, { enumerable: false });
      if (mutation === "prototype") Object.setPrototypeOf(object, { inherited: true });
      expect(() => api.validateAboutContent(value), `${mutation} ${key}`).toThrow(/[가-힣]/);
    }
  }
  for (const value of [null, [], 1, "text", true, new Date(), new Map(), Object.assign(() => {}, valid)]) {
    expect(() => api.validateAboutContent(value)).toThrow(/[가-힣]/);
  }
  for (const version of ["1", 0, 2, null, NaN]) {
    expect(() => api.validateAboutContent({ ...valid, schemaVersion: version })).toThrow(/schemaVersion/);
  }
});

test("text validation preserves literal text and enforces every field length and control boundary", () => {
  const api: Client = client();
  const fields: [string[], number][] = [
    ...["eyebrow", "philosophy", "history", "services"].map(k => [["headings", k], 120] as [string[], number]),
    ...["portfolioLabel", "contactLabel"].map(k => [["links", k], 120] as [string[], number]),
    [["introduction", "title"], 240], [["introduction", "subtitle"], 500], [["introduction", "paragraph"], 6000],
    [["philosophy", "0", "title"], 240], [["philosophy", "0", "subtitle"], 500], [["philosophy", "0", "paragraph"], 6000],
    [["services", "0", "name"], 240], [["services", "0", "description"], 2000], [["history", "0", "events", "0"], 1000],
  ];
  for (const [keys, max] of fields) {
    const set = (replacement: unknown) => {
      const value = api.createDefaultAboutContent();
      let target = value as unknown as Record<string, unknown>;
      for (const key of keys.slice(0, -1)) target = target[key] as Record<string, unknown>;
      target[keys.at(-1)!] = replacement;
      return value;
    };
    for (const text of ["x".repeat(max), "😀".repeat(max / 2), " \t\n<em>한국어 & \\\"</em> \n"]) {
      const value = set(text);
      expect(() => api.validateAboutContent(value), keys.join(".")).not.toThrow();
    }
    for (const text of ["x".repeat(max + 1), "😀".repeat(max / 2) + "x", "", " \n\t\r", null, 3, {}, "x\u0000", "x\u0008", "x\r", "x\u001f", "x\u007f"]) {
      expect(() => api.validateAboutContent(set(text)), keys.join(".")).toThrow(/[가-힣]/);
    }
  }
});

test("structured lists enforce cardinality, dense JSON arrays, exact unique identities and stable order", () => {
  const api: Client = client();
  type Content = ReturnType<Client["createDefaultAboutContent"]>;
  for (const [field, max] of [["philosophy", 12], ["history", 100], ["services", 30]] as const) {
    const valid = api.createDefaultAboutContent();
    const item = valid[field][0];
    const make = (i: number) => field === "philosophy" ? { ...item, id: `item-${i}` } : field === "history" ? { ...item, year: String(1000 + i), events: ["event", "event"] } : { ...item, name: `Service ${i}` };
    for (const length of [0, max]) {
      expect(() => api.validateAboutContent({ ...valid, [field]: Array.from({ length }, (_, i) => make(i)) })).not.toThrow();
    }
    for (const array of [null, {}, "array", Array.from({ length: max + 1 }, (_, i) => make(i)), new Array(1), [undefined], Object.assign([item], { extra: true })]) {
      expect(() => api.validateAboutContent({ ...valid, [field]: array })).toThrow(/[가-힣]/);
    }
    const accessor = [item];
    Object.defineProperty(accessor, "0", { get() { throw new Error("array getter executed"); } });
    expect(() => api.validateAboutContent({ ...valid, [field]: accessor })).toThrow(/[가-힣]/);
  }
  const edit = (mutate: (value: Content) => void) => { const value = api.createDefaultAboutContent(); mutate(value); return value; };
  for (const id of ["A", "-id", "1id", "한글", "a_", "a\n", "a".repeat(65), "about-introduction", "about-philosophy", "about-history", "about-services"]) {
    expect(() => api.validateAboutContent(edit(v => { v.philosophy[0].id = id; }))).toThrow(/[가-힣]/);
  }
  expect(() => api.validateAboutContent(edit(v => { v.philosophy[0].id = "a".repeat(64); }))).not.toThrow();
  expect(() => api.validateAboutContent(edit(v => { v.philosophy[1].id = v.philosophy[0].id; }))).toThrow(/중복/);
  expect(() => api.validateAboutContent(edit(v => { v.services[1].name = v.services[0].name; }))).toThrow(/중복/);
  expect(() => api.validateAboutContent(edit(v => { v.services[1].name = v.services[0].name + " "; }))).not.toThrow();
  for (const year of ["0999", "0000", "10000", "２０２４", "2024\n", " 2024", 2024]) {
    expect(() => api.validateAboutContent(edit(v => { v.history[0].year = year as string; }))).toThrow(/[가-힣]/);
  }
  expect(() => api.validateAboutContent(edit(v => { v.history[1].year = v.history[0].year; }))).toThrow(/중복/);
  for (const events of [[], Array(31).fill("event"), new Array(1), null, "event", Object.assign(["event"], { extra: true })]) {
    expect(() => api.validateAboutContent(edit(v => { v.history[0].events = events as string[]; }))).toThrow(/[가-힣]/);
  }
  const ordered = edit(v => { v.history = [{ year: "9999", events: Array(30).fill("duplicate") }, { year: "1000", events: ["last"] }]; v.philosophy.reverse(); v.services.reverse(); });
  const before = JSON.stringify(ordered);
  expect(() => api.validateAboutContent(ordered)).not.toThrow();
  expect(JSON.stringify(ordered)).toBe(before);
});

test("parser and exporter round-trip exact text and order with fresh data and Korean malformed-JSON errors", () => {
  const api: Client = client();
  const value = api.createDefaultAboutContent();
  value.introduction.paragraph = " \t\n<script>alert(1)</script> 한글 \\\" 😀 \n";
  value.history.reverse();
  value.philosophy.reverse();
  value.services = [];
  const source = JSON.stringify(value, null, 2) + "\n";
  expect(api.serializeAboutContent(value)).toBe(source);
  const parsed = api.parseAboutContent(source);
  expect(parsed).toEqual(value);
  parsed.history[0].events[0] = "changed";
  expect(api.parseAboutContent(source)).toEqual(value);
  for (const bad of ["", "{", "{}x", "[]", "null", "true", "{\"schemaVersion\":1,}", "\uFEFF" + source]) {
    expect(() => api.parseAboutContent(bad)).toThrow(/[가-힣]/);
  }
  expect(() => api.serializeAboutContent({ ...value, introduction: { ...value.introduction, title: "" } })).toThrow(/[가-힣]/);
});

test("parser rejects duplicate and escaped-alias keys in every object and caps lexical nesting before JSON.parse", () => {
  const api = client();
  const source = JSON.stringify(api.createDefaultAboutContent());
  for (const key of ["schemaVersion", "eyebrow", "title", "id", "year", "name", "portfolioLabel"]) {
    const pattern = new RegExp(`"${key}":([^,}]+)`);
    const match = source.match(pattern)!;
    expect(match, key).not.toBeNull();
    for (const alias of [key, key.slice(0, -1) + "\\u" + key.charCodeAt(key.length - 1).toString(16).padStart(4, "0")]) {
      const bad = source.replace(pattern, `${match[0]},"${alias}":${match[1]}`);
      expect(() => api.parseAboutContent(bad), key).toThrow(/중복/);
    }
  }
  const withSecondObject = source.replace('"events":[', '"events":[],"events":[');
  expect(() => api.parseAboutContent(withSecondObject)).toThrow(/중복/);
  const tooDeep = "[".repeat(9) + "0" + "]".repeat(9);
  expect(() => api.parseAboutContent(tooDeep)).toThrow(/8/);
  expect(() => api.parseAboutContent("[".repeat(8) + "0" + "]".repeat(8))).toThrow(/객체/);
  const text = api.createDefaultAboutContent();
  text.introduction.paragraph = '[[[[[[[[[[[[{{{{{\\"title\\":1,\\"title\\":2}';
  expect(api.parseAboutContent(JSON.stringify(text))).toEqual(text);
});

test("input, validated data and canonical export enforce independent UTF-8 64 KiB budgets", () => {
  const api: Client = client();
  const source = JSON.stringify(api.createDefaultAboutContent());
  const remaining = api.MAX_ABOUT_CONTENT_BYTES - Buffer.byteLength(source);
  expect(api.parseAboutContent(source + " ".repeat(remaining))).toEqual(api.createDefaultAboutContent());
  expect(() => api.parseAboutContent(source + " ".repeat(remaining + 1))).toThrow(/64 KiB/);
  expect(() => api.parseAboutContent("가".repeat(22000))).toThrow(/64 KiB/);
  expect(() => api.parseAboutContent(null as unknown as string)).toThrow(/[가-힣]/);
  const oversized = api.createDefaultAboutContent();
  oversized.philosophy = Array.from({ length: 12 }, (_, i) => ({ id: `id-${i}`, title: "title", subtitle: "subtitle", paragraph: "가".repeat(6000) }));
  expect(() => api.validateAboutContent(oversized)).toThrow(/64 KiB/);
  expect(() => api.serializeAboutContent(oversized)).toThrow(/64 KiB/);
  const edge = api.createDefaultAboutContent();
  edge.philosophy = [];
  edge.history = [];
  edge.services = Array.from({ length: 30 }, (_, i) => ({ name: `s${i}`, description: "x".repeat(1950) }));
  edge.introduction.paragraph = "x";
  const padding = api.MAX_ABOUT_CONTENT_BYTES - Buffer.byteLength(JSON.stringify(edge, null, 2) + "\n");
  expect(padding).toBeGreaterThan(0);
  expect(padding).toBeLessThan(6000);
  edge.introduction.paragraph += "x".repeat(padding);
  expect(Buffer.byteLength(api.serializeAboutContent(edge))).toBe(65536);
  edge.introduction.paragraph += "x";
  expect(() => api.validateAboutContent(edge)).not.toThrow();
  expect(api.parseAboutContent(JSON.stringify(edge))).toEqual(edge);
  expect(() => api.serializeAboutContent(edge)).toThrow(/64 KiB/);
});

function temporaryRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "jid-about-content-"));
}
function server(): typeof import("../../src/lib/aboutContentServer") {
  expect(fs.existsSync(path.join(root, "src/lib/aboutContentServer.ts")), "server About content reader exists").toBe(true);
  return load("../../src/lib/aboutContentServer") as typeof import("../../src/lib/aboutContentServer");
}

test("server defaults only from an isolated initially missing file and returns fresh copies", () => {
  const api = client();
  const folder = temporaryRoot();
  try {
    const first = server().getAboutContent(folder);
    expect(first).toEqual(api.createDefaultAboutContent());
    first.history[0].events[0] = "changed";
    expect(server().getAboutContent(folder)).toEqual(api.createDefaultAboutContent());
    expect(fs.readdirSync(folder)).toEqual([]);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test("server reads custom root JSON only and rejects invalid, nonregular, linked, oversized and malformed UTF-8 files", () => {
  const api = client();
  const folder = temporaryRoot();
  const filename = path.join(folder, api.ABOUT_CONTENT_FILENAME);
  try {
    const value = api.createDefaultAboutContent();
    value.introduction.paragraph = "custom <script>inert</script> 한글 😀";
    value.history.reverse();
    value.philosophy = [];
    fs.writeFileSync(filename, api.serializeAboutContent(value));
    fs.writeFileSync(path.join(folder, "portfolio-settings.json"), "invalid ignored unrelated file");
    expect(server().getAboutContent(folder)).toEqual(value);
    fs.writeFileSync(filename, JSON.stringify(value));
    expect(server().getAboutContent(folder)).toEqual(value);
    for (const data of ["", "{", "{}", "null", ' {"schemaVersion":1,"schemaVersion":1}', " ".repeat(65537), Buffer.from([0xc3, 0x28]), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(value))])]) {
      fs.writeFileSync(filename, data);
      expect(() => server().getAboutContent(folder)).toThrow(/[가-힣]/);
    }
    fs.rmSync(filename);
    fs.mkdirSync(filename);
    expect(() => server().getAboutContent(folder)).toThrow(/일반 파일/);
    fs.rmdirSync(filename);
    const target = path.join(folder, "target.json");
    fs.writeFileSync(target, JSON.stringify(value));
    fs.symlinkSync(target, filename);
    expect(() => server().getAboutContent(folder)).toThrow(/일반 파일/);
    fs.unlinkSync(target);
    expect(() => server().getAboutContent(folder)).toThrow(/일반 파일/);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

type FileOperations = { -readonly [K in keyof typeof fs]?: (typeof fs)[K] };
function serverWithFS(overrides: FileOperations): ReturnType<typeof server> {
  const filename = path.join(root, "src/lib/aboutContentServer.ts");
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, Buffer, TextDecoder, process: { cwd: () => root },
    require(name: string) {
      if (name === "node:fs") return { ...fs, ...overrides };
      if (name === "node:path") return path;
      if (name === "./aboutContent") return client();
      throw new Error(`Unexpected server dependency ${name}`);
    },
  }, { filename, timeout: 1000 });
  return exports as ReturnType<typeof server>;
}

test("server fails closed on replaced, changed, disappeared or inconsistent snapshots and always closes descriptors", () => {
  const api = client();
  for (const mode of ["replaced-before-open", "changed-during-read", "replaced-during-read", "missing-during-read", "size-mismatch"]) {
    const folder = temporaryRoot();
    const filename = path.join(folder, api.ABOUT_CONTENT_FILENAME);
    const source = api.serializeAboutContent(api.createDefaultAboutContent());
    fs.writeFileSync(filename, source);
    let closed = 0;
    let changed = false;
    const different = () => { const other = path.join(folder, "other.json"); fs.writeFileSync(other, source); fs.renameSync(other, filename); };
    const overrides: FileOperations = {
      closeSync(fd) { closed++; fs.closeSync(fd); },
      openSync: ((name: fs.PathLike, flags: number, ...rest: unknown[]) => {
        expect(flags & fs.constants.O_NOFOLLOW).not.toBe(0);
        expect(flags & fs.constants.O_NONBLOCK).not.toBe(0);
        if (mode === "replaced-before-open") different();
        return fs.openSync(name, flags, rest[0] as fs.Mode | undefined);
      }) as typeof fs.openSync,
      readSync: ((fd: number, buffer: Buffer, offset: number, length: number, position: number | null) => {
        const count = fs.readSync(fd, buffer, offset, length, position);
        if (count && !changed) {
          changed = true;
          if (mode === "changed-during-read") fs.utimesSync(filename, 100, 100);
          if (mode === "replaced-during-read") different();
          if (mode === "missing-during-read") fs.unlinkSync(filename);
        }
        return count;
      }) as typeof fs.readSync,
    };
    if (mode === "size-mismatch") {
      overrides.lstatSync = ((name: fs.PathLike) => Object.assign(fs.lstatSync(name), { size: Buffer.byteLength(source) + 1 })) as typeof fs.lstatSync;
      overrides.fstatSync = ((fd: number) => Object.assign(fs.fstatSync(fd), { size: Buffer.byteLength(source) + 1 })) as typeof fs.fstatSync;
    }
    try {
      expect(() => serverWithFS(overrides).getAboutContent(folder), mode).toThrow(/[가-힣]/);
      expect(closed, mode).toBe(1);
    } finally { fs.rmSync(folder, { recursive: true, force: true }); }
  }
});

test("server uses bounded partial reads despite lying stat sizes and fails closed on unreadable paths", () => {
  const api = client();
  const folder = temporaryRoot();
  const filename = path.join(folder, api.ABOUT_CONTENT_FILENAME);
  const source = api.serializeAboutContent(api.createDefaultAboutContent());
  try {
    fs.writeFileSync(filename, source);
    let read = 0;
    let closed = 0;
    const shortReader = serverWithFS({
      readSync: ((fd: number, buffer: Buffer, offset: number, length: number, position: number | null) => {
        const count = fs.readSync(fd, buffer, offset, Math.min(length, 47), position); read += count; return count;
      }) as typeof fs.readSync,
      closeSync(fd) { closed++; fs.closeSync(fd); },
    });
    expect(shortReader.getAboutContent(folder)).toEqual(api.createDefaultAboutContent());
    expect(read).toBe(Buffer.byteLength(source));
    expect(closed).toBe(1);
    fs.writeFileSync(filename, "x".repeat(70000));
    read = 0; closed = 0;
    const bounded = serverWithFS({
      lstatSync: ((name: fs.PathLike) => Object.assign(fs.lstatSync(name), { size: 1 })) as typeof fs.lstatSync,
      fstatSync: ((fd: number) => Object.assign(fs.fstatSync(fd), { size: 1 })) as typeof fs.fstatSync,
      readSync: ((fd: number, buffer: Buffer, offset: number, length: number, position: number | null) => {
        expect(buffer.length).toBe(65537);
        const count = fs.readSync(fd, buffer, offset, Math.min(length, 53), position); read += count; return count;
      }) as typeof fs.readSync,
      closeSync(fd) { closed++; fs.closeSync(fd); },
    });
    expect(() => bounded.getAboutContent(folder)).toThrow(/[가-힣]/);
    expect(read).toBe(65537);
    expect(closed).toBe(1);
    const denied = () => { throw Object.assign(new Error("denied"), { code: "EACCES" }); };
    expect(() => serverWithFS({ lstatSync: denied }).getAboutContent(folder)).toThrow(/[가-힣]/);
    fs.writeFileSync(filename, source);
    expect(() => serverWithFS({ openSync: denied }).getAboutContent(folder)).toThrow(/[가-힣]/);
    expect(() => serverWithFS({ openSync: () => { throw Object.assign(new Error("gone"), { code: "ENOENT" }); } }).getAboutContent(folder)).toThrow(/[가-힣]/);
    expect(() => serverWithFS({ readSync: denied }).getAboutContent(folder)).toThrow(/[가-힣]/);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test("client module executes without Node globals/imports and guards parsing/export before amplification", () => {
  const context = vm.createContext({ TextEncoder, exports: {} });
  const compile = (filename: string) => ts.transpileModule(fs.readFileSync(path.join(root, filename), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInContext(compile("src/data/about.ts"), context);
  const originals = context.exports;
  context.exports = {};
  context.require = (name: string) => { if (name !== "../data/about") throw new Error(`Node/import forbidden: ${name}`); return originals; };
  vm.runInContext(compile("src/lib/aboutContent.ts"), context, { timeout: 1000 });
  const result = vm.runInContext(`(() => {
    if (typeof process !== 'undefined' || typeof Buffer !== 'undefined') throw Error('Node globals present');
    const value = exports.createDefaultAboutContent();
    const source = exports.serializeAboutContent(value);
    const parsed = exports.parseAboutContent(source);
    if (JSON.stringify(parsed) !== JSON.stringify(value)) throw Error('Round-trip changed data');
    const parse = JSON.parse;
    let calls = 0;
    JSON.parse = (...args) => { calls++; return parse(...args); };
    for (const bad of ['x'.repeat(65537), '['.repeat(9) + '0' + ']'.repeat(9)]) {
      try { exports.parseAboutContent(bad); throw Error('Expected input rejection'); }
      catch (error) { if (!/[가-힣]/.test(error.message)) throw error; }
    }
    JSON.parse = parse;
    if (calls !== 0) throw Error('Unsafe input reached JSON.parse');
    const stringify = JSON.stringify;
    let objectCalls = 0;
    JSON.stringify = (node, ...args) => { if (node && typeof node === 'object') objectCalls++; return stringify(node, ...args); };
    value.philosophy = Array.from({length:12}, (_, i) => ({id:'p-' + i, title:'t', subtitle:'s', paragraph:'가'.repeat(6000)}));
    try { exports.serializeAboutContent(value); throw Error('Expected export rejection'); }
    catch (error) { if (!/64 KiB/.test(error.message)) throw error; }
    JSON.stringify = stringify;
    if (objectCalls !== 0) throw Error('Oversized object was stringified before rejection');
    return { safe: true, source };
  })()`, context, { timeout: 1000 });
  expect(result.safe).toBe(true);
  expect(client().parseAboutContent(result.source)).toEqual(client().createDefaultAboutContent());
});

test("actual checkout content is validated without assuming it equals original defaults", () => {
  const api: Client = client();
  const content = server().getAboutContent(root);
  expect(() => api.validateAboutContent(content)).not.toThrow();
  expect(api.parseAboutContent(JSON.stringify(content))).toEqual(content);
  expect(serverWithFS({}).getAboutContent()).toEqual(content);
});
