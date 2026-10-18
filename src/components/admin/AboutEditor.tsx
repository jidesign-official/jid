"use client";

import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { aboutContentToHtml, aboutHtmlToContent, MAX_ABOUT_HTML_BYTES } from "@/lib/aboutHtml";
import {
  ABOUT_CONTENT_FILENAME,
  MAX_ABOUT_CONTENT_BYTES,
  parseAboutContent,
  serializeAboutContent,
  type AboutContent,
} from "@/lib/aboutContent";
import { getAssetPath } from "@/lib/basePath";
import styles from "./AboutEditor.module.css";

const REPO = "https://github.com/jidesign-official/jid";
const clone = (value: AboutContent): AboutContent => JSON.parse(JSON.stringify(value));
// Object property order is representation, while array order and every value are content.
const fingerprint = (value: AboutContent) => JSON.stringify(value, (_key, entry: unknown) =>
  entry && typeof entry === "object" && !Array.isArray(entry)
    ? Object.fromEntries(Object.entries(entry).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0))
    : entry);
const explanation = (error: unknown) => error instanceof Error ? error.message : "파일 내용을 확인하고 다시 시도해 주세요.";
function moved<T>(items: T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function TextField({ label, value, maxLength, onChange, multiline = false }: {
  label: string; value: string; maxLength: number;
  onChange: (value: string) => void; multiline?: boolean;
}) {
  return <label className={styles.field}>
    <span>{label}</span>
    {multiline
      ? <textarea aria-label={label} value={value} maxLength={maxLength} rows={4} onChange={(event) => onChange(event.target.value)} />
      : <input aria-label={label} value={value} maxLength={maxLength} onChange={(event) => onChange(event.target.value)} />}
  </label>;
}
function MoveControls({ label, index, length, onMove, onDelete }: {
  label: string; index: number; length: number;
  onMove: (delta: number) => void; onDelete: () => void;
}) {
  return <div className={styles.controls}>
    <button type="button" aria-label={`${label} 위로`} disabled={index === 0} onClick={() => onMove(-1)}>↑</button>
    <button type="button" aria-label={`${label} 아래로`} disabled={index === length - 1} onClick={() => onMove(1)}>↓</button>
    <button type="button" className={styles.delete} aria-label={`${label} 삭제`} onClick={onDelete}>삭제</button>
  </div>;
}

export default function AboutEditor({ initialContent, onDirtyChange }: {
  initialContent: AboutContent;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [content, setContent] = useState(() => clone(initialContent));
  const [mode, setMode] = useState<"editor" | "html">("editor");
  // Generate only on request: valid JSON may contain text HTML cannot represent losslessly.
  const [htmlSource, setHtmlSource] = useState("");
  const [appliedSource, setAppliedSource] = useState("");
  const [modeError, setModeError] = useState("");
  const modeId = useId();
  const [status, setStatus] = useState("변경 사항은 이 탭에만 유지됩니다. 새로고침하면 사라집니다.");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const busyLock = useRef(false), mounted = useRef(false), epoch = useRef(0);
  const dirtyRef = useRef(false);
  const downloads = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const initialFingerprint = useMemo(() => fingerprint(initialContent), [initialContent]);
  const draftFingerprint = useMemo(() => fingerprint(content), [content]);
  const dirty = draftFingerprint !== initialFingerprint || htmlSource !== appliedSource;
  const validation = useMemo(() => {
    try { return { text: serializeAboutContent(mode === "html" ? aboutHtmlToContent(htmlSource) : content), error: "" }; }
    catch (cause) { return { text: "", error: `내보낼 수 없습니다. ${mode === "html" ? "HTML 소스를" : "입력 내용을"} 확인해 주세요: ${explanation(cause)}` }; }
  }, [content, mode, htmlSource]);
  useEffect(() => { dirtyRef.current = dirty; onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    mounted.current = true;
    const urls = downloads.current;
    return () => {
      mounted.current = false;
      // Invalidate async file jobs before releasing download resources.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      epoch.current++;
      for (const [url, timer] of urls) { clearTimeout(timer); URL.revokeObjectURL(url); }
      urls.clear();
    };
  }, []);
  function switchMode(next: "editor" | "html"): boolean {
    if (busyLock.current) return false;
    if (next === mode) return true;
    try {
      if (next === "html") {
        // A valid compact publication can exceed the pretty-JSON export budget.
        // Keep both editing views available so the user can reduce that content.
        const generated = aboutContentToHtml(content);
        setHtmlSource(generated);
        setAppliedSource(generated);
      } else {
        const restored = aboutHtmlToContent(htmlSource);
        const generated = aboutContentToHtml(restored);
        setContent(restored);
        setHtmlSource(generated);
        setAppliedSource(generated);
        dirtyRef.current = fingerprint(restored) !== initialFingerprint;
      }
      setMode(next);
      setModeError("");
      return true;
    } catch (cause) {
      setModeError(`모드를 바꾸지 못했습니다. 현재 편집 내용은 유지됩니다: ${explanation(cause)}`);
      return false;
    }
  }
  function modeKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? "editor" : event.key === "End" ? "html" : mode === "editor" ? "html" : "editor";
    if (switchMode(next)) document.getElementById(`${modeId}-${next}-tab`)?.focus();
  }
  function editSource(value: string) {
    if (busyLock.current) return;
    dirtyRef.current = draftFingerprint !== initialFingerprint || value !== appliedSource;
    setHtmlSource(value);
    setModeError("");
  }
  function edit(update: (value: AboutContent) => AboutContent) {
    if (busyLock.current) return;
    dirtyRef.current = true;
    setModeError("");
    setContent((value) => update(value));
  }
  async function importContent(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || busyLock.current) return;
    busyLock.current = true;
    const token = ++epoch.current;
    const active = () => mounted.current && epoch.current === token;
    setBusy(true);
    try {
      if (file.size > MAX_ABOUT_CONTENT_BYTES) throw new Error("파일은 64KiB 이하여야 합니다. 내용을 줄여 다시 가져와 주세요.");
      const source = await file.text();
      if (!active()) return;
      const restored = parseAboutContent(source);
      const generated = mode === "html" ? aboutContentToHtml(restored) : "";
      if (dirtyRef.current && !window.confirm("게시되지 않은 About 변경 사항을 가져온 파일로 바꾸시겠습니까? 현재 로컬 편집 내용이 사라집니다.")) return;
      setContent(restored);
      setHtmlSource(generated);
      setAppliedSource(generated);
      setModeError("");
      dirtyRef.current = fingerprint(restored) !== initialFingerprint;
      setError("");
      setStatus("About JSON을 가져왔습니다. 아직 게시되지 않았습니다.");
    } catch (cause) {
      if (active()) setError(`가져오지 못했습니다. 현재 편집 내용은 유지됩니다: ${explanation(cause)}`);
    } finally {
      if (active()) { busyLock.current = false; setBusy(false); }
    }
  }
  function remove(label: string, action: () => void) {
    if (!busyLock.current && window.confirm(`${label} 항목을 삭제하시겠습니까? GitHub에 게시된 내용은 바로 바뀌지 않습니다.`)) action();
  }
  function addPhilosophy() {
    if (content.philosophy.length >= 12 || busyLock.current) return;
    let id: string;
    do { id = `philosophy-${crypto.randomUUID()}`; } while (content.philosophy.some((item) => item.id === id));
    edit((c) => ({ ...c, philosophy: [...c.philosophy, { id, title: "", subtitle: "", paragraph: "" }] }));
  }
  function resetPublished() {
    if (busyLock.current) return;
    if (!window.confirm("이 탭의 모든 로컬 변경 사항을 지우고 현재 게시된 About 내용으로 되돌리시겠습니까? GitHub의 파일은 바뀌지 않습니다.")) return;
    epoch.current++;
    setContent(clone(initialContent));
    // Reset also works for published JSON that cannot be represented as HTML.
    setMode("editor");
    setHtmlSource("");
    setAppliedSource("");
    setModeError("");
    dirtyRef.current = false;
    setError("");
    setStatus("현재 게시된 About 내용으로 되돌렸습니다. 이 탭의 로컬 변경 사항만 지웠습니다.");
  }
  function exportContent() {
    if (validation.error || busyLock.current) return;
    try {
      const url = URL.createObjectURL(new Blob([validation.text], { type: "application/json;charset=utf-8" }));
      const timer = setTimeout(() => { URL.revokeObjectURL(url); downloads.current.delete(url); }, 1000);
      downloads.current.set(url, timer);
      const link = document.createElement("a");
      link.href = url;
      link.download = ABOUT_CONTENT_FILENAME;
      document.body.appendChild(link);
      try { link.click(); } finally { link.remove(); }
      setStatus("About JSON을 내려받았습니다. 아직 게시되지 않았습니다. GitHub 루트에 업로드하고 커밋해 주세요.");
    } catch (cause) { setError(`내보내지 못했습니다: ${explanation(cause)}`); }
  }
  return <div className={styles.editor} data-about-editor aria-busy={busy}>
    <section className={styles.heading}>
      <span className={styles.eyebrow}>ABOUT CONTENT / LOCAL EDITOR</span>
      <h1>About Us 편집.</h1>
      <p>JiD의 소개와 생각, 쌓아 온 이야기를 다듬으세요. 레이아웃과 링크 주소는 그대로 유지됩니다.</p>
      <a href={getAssetPath("/about/")} target="_blank" rel="noopener noreferrer">현재 게시된 About 보기 ↗</a>
    </section>
    <div className={styles.stateBar}>
      <strong>{dirty ? "게시되지 않은 About 변경" : "현재 게시된 About 내용"}</strong>
      <span>새로고침하면 이 탭의 로컬 변경 사항이 사라집니다.</span>
    </div>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {modeError && <p className={styles.error} role="alert">{modeError}</p>}
    <p className={styles.status} role="status" aria-live="polite">{busy ? "About 파일을 읽고 검증하고 있습니다…" : status}</p>
    <div className={styles.modeTabs} role="tablist" aria-label="About 편집 방식">
      <button type="button" role="tab" id={`${modeId}-editor-tab`} aria-controls={`${modeId}-editor-panel`} aria-selected={mode === "editor"} tabIndex={mode === "editor" ? 0 : -1} disabled={busy} onKeyDown={modeKey} onClick={() => switchMode("editor")}>에디터</button>
      <button type="button" role="tab" id={`${modeId}-html-tab`} aria-controls={`${modeId}-html-panel`} aria-selected={mode === "html"} tabIndex={mode === "html" ? 0 : -1} disabled={busy} onKeyDown={modeKey} onClick={() => switchMode("html")}>HTML</button>
    </div>
    <div className={styles.layout}>
      {mode === "editor" ? <fieldset className={styles.forms} role="tabpanel" id={`${modeId}-editor-panel`} aria-labelledby={`${modeId}-editor-tab`} aria-label="About 텍스트 편집" disabled={busy}>
        <section className={styles.card} aria-label="섹션 제목 편집">
          <div className={styles.sectionHeading}><span>01</span><h2>페이지의 첫인상</h2></div>
          <p className={styles.hint}>각 섹션의 제목과 소개 문구를 편집합니다. 모든 필드는 일반 텍스트입니다.</p>
          <TextField label={"상단 작은 제목"} value={content.headings.eyebrow} maxLength={120} onChange={(value) => edit((c) => ({ ...c, headings: { ...c.headings, eyebrow: value } }))} />
          <TextField label={"철학 섹션 제목"} value={content.headings.philosophy} maxLength={120} onChange={(value) => edit((c) => ({ ...c, headings: { ...c.headings, philosophy: value } }))} />
          <TextField label={"연혁 섹션 제목"} value={content.headings.history} maxLength={120} onChange={(value) => edit((c) => ({ ...c, headings: { ...c.headings, history: value } }))} />
          <TextField label={"서비스 섹션 제목"} value={content.headings.services} maxLength={120} onChange={(value) => edit((c) => ({ ...c, headings: { ...c.headings, services: value } }))} />
          <TextField label={"소개 제목"} value={content.introduction.title} maxLength={240} onChange={(value) => edit((c) => ({ ...c, introduction: { ...c.introduction, title: value } }))} />
          <TextField label={"소개 부제"} value={content.introduction.subtitle} maxLength={500} onChange={(value) => edit((c) => ({ ...c, introduction: { ...c.introduction, subtitle: value } }))} />
          <TextField label={"소개 본문"} value={content.introduction.paragraph} maxLength={6000} onChange={(value) => edit((c) => ({ ...c, introduction: { ...c.introduction, paragraph: value } }))} multiline />
          <div className={styles.sectionHeading}><h3>다음으로 이어지는 링크</h3></div>
          <TextField label={"포트폴리오 링크 문구"} value={content.links.portfolioLabel} maxLength={120} onChange={(value) => edit((c) => ({ ...c, links: { ...c.links, portfolioLabel: value } }))} />
          <TextField label={"문의 링크 문구"} value={content.links.contactLabel} maxLength={120} onChange={(value) => edit((c) => ({ ...c, links: { ...c.links, contactLabel: value } }))} />
          <p className={styles.hint}>링크 주소는 /portfolio와 /contact로 고정됩니다.</p>
        </section>
        <section className={styles.card} aria-label="디자인 철학 편집">
          <div className={styles.sectionHeading}><span>02</span><h2>디자인 철학</h2><span>{content.philosophy.length} / 12</span></div>
          <p className={styles.hint}>내부 ID는 제목을 바꾸거나 순서를 옮겨도 유지됩니다. 항목이 없으면 게시 화면에서 이 섹션을 표시하지 않습니다.</p>
          {content.philosophy.map((item, index) => <article className={styles.row} key={item.id} data-philosophy-id={item.id}>
            <div className={styles.rowHeading}><h3>철학 {index + 1}</h3><MoveControls label={`철학 ${index + 1}`} index={index} length={content.philosophy.length} onMove={(delta) => edit((c) => ({ ...c, philosophy: moved(c.philosophy, index, delta) }))} onDelete={() => remove(`철학 ${index + 1}`, () => edit((c) => ({ ...c, philosophy: c.philosophy.filter((_, i) => i !== index) })))} /></div>
            <TextField label={`철학 ${index + 1} 제목`} value={item.title} maxLength={240} onChange={(value) => edit((c) => ({ ...c, philosophy: c.philosophy.map((p, i) => i === index ? { ...p, title: value } : p) }))} />
            <TextField label={`철학 ${index + 1} 부제`} value={item.subtitle} maxLength={500} onChange={(value) => edit((c) => ({ ...c, philosophy: c.philosophy.map((p, i) => i === index ? { ...p, subtitle: value } : p) }))} />
            <TextField label={`철학 ${index + 1} 본문`} value={item.paragraph} maxLength={6000} onChange={(value) => edit((c) => ({ ...c, philosophy: c.philosophy.map((p, i) => i === index ? { ...p, paragraph: value } : p) }))} multiline />
          </article>)}
          <button type="button" aria-label="철학 추가" disabled={content.philosophy.length >= 12} onClick={addPhilosophy}>＋ 철학 추가</button>
        </section>
        <section className={styles.card} aria-label="회사 연혁 편집">
          <div className={styles.sectionHeading}><span>03</span><h2>회사 연혁</h2><span>{content.history.length} / 100</span></div>
          <p className={styles.hint}>연도는 중복 없는 네 자리 숫자입니다. 입력한 순서대로 표시됩니다. 항목이 없으면 게시 화면에서 이 섹션을 표시하지 않습니다.</p>
          {content.history.map((item, index) => <article className={styles.row} key={index}>
            <div className={styles.rowHeading}><h3>연혁 {index + 1}</h3><MoveControls label={`연혁 ${index + 1}`} index={index} length={content.history.length} onMove={(delta) => edit((c) => ({ ...c, history: moved(c.history, index, delta) }))} onDelete={() => remove(`연혁 ${index + 1}`, () => edit((c) => ({ ...c, history: c.history.filter((_, i) => i !== index) })))} /></div>
            <TextField label={`연혁 ${index + 1} 연도`} value={item.year} maxLength={4} onChange={(value) => edit((c) => ({ ...c, history: c.history.map((h, i) => i === index ? { ...h, year: value } : h) }))} />
            {item.events.map((event, eventIndex) => <div className={styles.event} key={eventIndex}>
              <TextField label={`연혁 ${index + 1} 사건 ${eventIndex + 1}`} value={event} maxLength={1000} onChange={(value) => edit((c) => ({ ...c, history: c.history.map((h, i) => i === index ? { ...h, events: h.events.map((e, n) => n === eventIndex ? value : e) } : h) }))} multiline />
              <MoveControls label={`연혁 ${index + 1} 사건 ${eventIndex + 1}`} index={eventIndex} length={item.events.length} onMove={(delta) => edit((c) => ({ ...c, history: c.history.map((h, i) => i === index ? { ...h, events: moved(h.events, eventIndex, delta) } : h) }))} onDelete={() => remove(`연혁 ${index + 1} 사건 ${eventIndex + 1}`, () => edit((c) => ({ ...c, history: c.history.map((h, i) => i === index ? { ...h, events: h.events.filter((_, n) => n !== eventIndex) } : h) })))} /></div>)}
            {!item.events.length && <p className={styles.hint}>연도마다 사건이 1개 이상 필요합니다. 사건을 추가하거나 연혁 항목을 삭제해 주세요.</p>}
            <button type="button" aria-label={`연혁 ${index + 1} 사건 추가`} disabled={item.events.length >= 30} onClick={() => edit((c) => ({ ...c, history: c.history.map((h, i) => i === index ? { ...h, events: [...h.events, ""] } : h) }))}>＋ 사건 추가 ({item.events.length} / 30)</button>
          </article>)}
          <button type="button" aria-label="연혁 추가" disabled={content.history.length >= 100} onClick={() => edit((c) => ({ ...c, history: [...c.history, { year: "", events: [""] }] }))}>＋ 연혁 추가</button>
        </section>
        <section className={styles.card} aria-label="서비스 편집">
          <div className={styles.sectionHeading}><span>04</span><h2>제공 서비스</h2><span>{content.services.length} / 30</span></div>
          <p className={styles.hint}>서비스 이름은 서로 다르게 입력하세요. 항목이 없으면 게시 화면에서 이 섹션을 표시하지 않습니다.</p>
          {content.services.map((item, index) => <article className={styles.row} key={index}>
            <div className={styles.rowHeading}><h3>서비스 {index + 1}</h3><MoveControls label={`서비스 ${index + 1}`} index={index} length={content.services.length} onMove={(delta) => edit((c) => ({ ...c, services: moved(c.services, index, delta) }))} onDelete={() => remove(`서비스 ${index + 1}`, () => edit((c) => ({ ...c, services: c.services.filter((_, i) => i !== index) })))} /></div>
            <TextField label={`서비스 ${index + 1} 이름`} value={item.name} maxLength={240} onChange={(value) => edit((c) => ({ ...c, services: c.services.map((s, i) => i === index ? { ...s, name: value } : s) }))} />
            <TextField label={`서비스 ${index + 1} 설명`} value={item.description} maxLength={2000} onChange={(value) => edit((c) => ({ ...c, services: c.services.map((s, i) => i === index ? { ...s, description: value } : s) }))} multiline />
          </article>)}
          <button type="button" aria-label="서비스 추가" disabled={content.services.length >= 30} onClick={() => edit((c) => ({ ...c, services: [...c.services, { name: "", description: "" }] }))}>＋ 서비스 추가</button>
        </section>
      </fieldset> : <fieldset className={styles.forms} role="tabpanel" id={`${modeId}-html-panel`} aria-labelledby={`${modeId}-html-tab`} disabled={busy}>
        <section className={styles.card}>
          <div className={styles.sectionHeading}><h2>같은 내용을 HTML로.</h2></div>
          <p className={styles.hint} id={`${modeId}-html-help`}>기존 About의 소개·철학·연혁·서비스·링크 문구를 편집합니다. data-about-* 표시와 섹션·필드 구조는 에디터와 연결되므로 유지해 주세요. 목록 항목은 같은 구조 안에서 추가·삭제·순서 변경할 수 있습니다. 임의의 페이지 HTML, 인라인 서식, 스크립트·이벤트·CSS·이미지·iframe과 링크 주소 변경은 지원하지 않습니다.</p>
          <label className={styles.field}>
            <span>About HTML 소스</span>
            <textarea className={styles.source} aria-label="About HTML 소스" aria-describedby={`${modeId}-html-help`} value={htmlSource} maxLength={MAX_ABOUT_HTML_BYTES} spellCheck={false} autoCapitalize="off" autoCorrect="off" rows={24} onChange={(event) => editSource(event.target.value)} />
          </label>
          <p className={styles.hint}>HTML은 실행하거나 미리보기로 삽입하지 않습니다. 에디터 전환·JSON 내보내기 전에 구조와 내용을 검증합니다. 지원하지 않는 내용은 삭제하지 않고 오류로 안내합니다. 소스는 최대 512KiB, 내보내는 JSON은 최대 64KiB입니다.</p>
        </section>
      </fieldset>}
      <aside className={styles.publish} aria-label="About JSON 게시 안내">
        <span className={styles.eyebrow}>TEXT → JSON → GITHUB</span>
        <h2>완성한 문장을 사이트로.</h2>
        <p>About 전용 파일 <code>about-content.json</code>을 저장소 루트에 교체하고 커밋하세요.</p>
        <p className={validation.error ? styles.error : styles.ready} aria-live="polite">{validation.error || "✓ 내보내기 준비 완료 · 최대 64KiB"}</p>
        <button type="button" className={styles.primary} disabled={busy || !!validation.error} onClick={exportContent}>About JSON 내보내기</button>
        <label className={styles.fileButton}>About JSON 가져오기<input type="file" accept=".json,application/json" aria-label="About JSON 가져오기" disabled={busy} onChange={(event) => void importContent(event)} /></label>
        <button type="button" disabled={busy} onClick={resetPublished}>현재 게시된 내용으로 되돌리기</button>
        <a href={`${REPO}/upload/main`} target="_blank" rel="noopener noreferrer">GitHub 루트에 About JSON 업로드 ↗</a>
        <a href={`${REPO}/actions`} target="_blank" rel="noopener noreferrer">Actions 검증·배포 확인 ↗</a>
        <p className={styles.hint}>다운로드와 가져오기는 게시가 아닙니다. GitHub 쓰기 권한이 필요하며, 실제 배포 결과는 Actions에서 확인하세요.</p>
        <div className={styles.destination}><strong>업로드 위치를 구분하세요</strong><p>About: 루트 / about-content.json<br />목록 설정: 루트 / portfolio-settings.json<br />프로젝트 ZIP: admin-submissions</p></div>
      </aside>
    </div>
  </div>;
}
