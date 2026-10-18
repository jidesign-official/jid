"use client";
/* Thumbnails intentionally use the existing catalog's original static paths. */
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { getAssetPath } from "@/lib/basePath";
import type { PortfolioCatalogProject } from "@/lib/portfolioCatalog";
import {
  MAX_PORTFOLIO_SETTINGS_BYTES,
  PORTFOLIO_SETTINGS_FILENAME,
  normalizePortfolioSettings,
  parsePortfolioSettings,
  serializePortfolioSettings,
  type PortfolioSettings,
} from "@/lib/portfolioSettings";
import styles from "./PortfolioManager.module.css";

const REPOSITORY = "https://github.com/jidesign-official/jid";
const DRAG_TYPE = "application/x-jid-portfolio-id";
type Props = {
  projects: PortfolioCatalogProject[];
  initialSettings: PortfolioSettings;
  onDirtyChange: (dirty: boolean) => void;
};
function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "설정을 처리하지 못했습니다. JSON 파일을 확인하고 다시 시도해 주세요.";
}
function move(items: string[], id: string, delta: number) {
  const index = items.indexOf(id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** Local settings editor only. Publication and authentication remain on GitHub. */
export default function PortfolioManager({ projects, initialSettings, onDirtyChange }: Props) {
  const baselineIds = useMemo(() => projects.map((project) => project.id), [projects]);
  const published = useMemo(() => normalizePortfolioSettings(initialSettings, baselineIds), [initialSettings, baselineIds]);
  const byId = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const [draft, setDraft] = useState<PortfolioSettings>(() => normalizePortfolioSettings(initialSettings, baselineIds));
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("현재 게시된 설정을 불러왔습니다. 변경은 이 화면의 초안에만 적용됩니다.");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  const mounted = useRef(false);
  const busyLock = useRef(false);
  const epoch = useRef(0);
  const dragged = useRef<string | null>(null);
  const downloads = useRef(new Map<string, number>());
  const dirty = JSON.stringify(draft) !== JSON.stringify(published);
  const filtered = query.length > 0 || filter !== "all";
  const hidden = new Set(draft.hidden);
  const featured = new Set(draft.featured);
  const visibleRows = draft.order.filter((id) => {
    const project = byId.get(id)!;
    return `${project.title} ${id}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()) &&
      (filter === "all" || (filter === "hidden" ? hidden.has(id) : !hidden.has(id)));
  });
  const validation = useMemo(() => {
    try {
      serializePortfolioSettings(draft, baselineIds);
      return "";
    } catch (cause) {
      return errorMessage(cause);
    }
  }, [draft, baselineIds]);

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    mounted.current = true;
    const resources = downloads.current;
    return () => {
      mounted.current = false;
      // Async-job generation, not a DOM ref: invalidate the latest generation.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      epoch.current++;
      for (const [url, timer] of resources) {
        window.clearTimeout(timer);
        URL.revokeObjectURL(url);
      }
      resources.clear();
    };
  }, []);

  function edit(update: (current: PortfolioSettings) => PortfolioSettings, announcement: string) {
    if (busyLock.current) return;
    setDraft(update);
    setError("");
    setStatus(announcement);
  }
  function moveCatalog(id: string, delta: number) {
    if (filtered) return;
    edit((current) => ({ ...current, order: move(current.order, id, delta) }), `${id}의 전체 목록 순서를 ${delta < 0 ? "위로" : "아래로"} 옮겼습니다. 메인 대표 순서는 유지됩니다.`);
  }
  function moveFeatured(id: string, delta: number) {
    edit((current) => ({ ...current, featured: move(current.featured, id, delta) }), `${id}의 메인 대표 순서를 ${delta < 0 ? "위로" : "아래로"} 옮겼습니다. 전체 목록 순서는 유지됩니다.`);
  }
  function toggleFeatured(id: string) {
    if (hidden.has(id) || (!featured.has(id) && draft.featured.length >= 4)) return;
    edit((current) => {
      if (current.hidden.includes(id)) return current;
      const selected = current.featured.includes(id);
      if (!selected && current.featured.length >= 4) return current;
      return { ...current, featured: selected ? current.featured.filter((item) => item !== id) : [...current.featured, id] };
    }, `${id}의 메인 대표 선택을 변경했습니다. 내보내려면 정확히 4개를 선택해 주세요.`);
  }
  function toggleHidden(id: string) {
    if (busyLock.current) return;
    if (hidden.has(id)) {
      edit((current) => ({ ...current, hidden: current.hidden.filter((item) => item !== id) }), `${id}을 기존 목록 위치로 복원했습니다. 메인 대표에는 자동 추가하지 않습니다.`);
      return;
    }
    const warning = featured.has(id) ? "\n메인 대표 선택도 해제됩니다. 내보내려면 다른 프로젝트를 선택해 대표 항목을 정확히 4개로 채워 주세요." : "";
    if (!window.confirm(`${byId.get(id)!.title} (${id})을 게시에서 제외하시겠습니까?\n배포 후 공개 목록과 상세 경로에서 빠집니다. 원본 파일은 삭제되거나 비공개로 바뀌지 않으며 언제든 복원할 수 있습니다.${warning}`)) return;
    edit((current) => ({ ...current, hidden: [...current.hidden, id], featured: current.featured.filter((item) => item !== id) }), `${id}을 초안에서 게시 제외했습니다. 원본과 목록 위치는 유지됩니다.`);
  }
  function resetPublished() {
    if (busyLock.current || !window.confirm("현재 목록 초안을 버리고 이 화면을 열 때의 게시된 설정으로 되돌리시겠습니까? GitHub와 실제 사이트는 변경하지 않습니다.")) return;
    setDraft(normalizePortfolioSettings(initialSettings, baselineIds));
    setError("");
    setStatus("게시된 설정으로 목록 초안을 되돌렸습니다. 실제 사이트는 변경하지 않았습니다.");
  }
  async function importSettings(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    // Reset immediately so the same filename can be selected after any failure/cancel.
    event.currentTarget.value = "";
    if (!file || busyLock.current) return;
    busyLock.current = true;
    const token = ++epoch.current;
    setBusy(true);
    setError("");
    try {
      if (file.size > MAX_PORTFOLIO_SETTINGS_BYTES) throw new Error("설정 JSON은 UTF-8 기준 64KiB 이하여야 합니다. 파일 크기를 줄여 다시 가져와 주세요.");
      const source = await file.text();
      if (!mounted.current || token !== epoch.current) return;
      if (new TextEncoder().encode(source).byteLength > MAX_PORTFOLIO_SETTINGS_BYTES) throw new Error("설정 JSON은 UTF-8 기준 64KiB 이하여야 합니다.");
      const next = normalizePortfolioSettings(parsePortfolioSettings(source, baselineIds), baselineIds);
      if (dirty && !window.confirm("게시되지 않은 목록 변경이 있습니다. 현재 초안을 가져온 JSON 설정으로 바꾸시겠습니까?")) return;
      if (!mounted.current || token !== epoch.current) return;
      setDraft(next);
      setStatus("설정 JSON을 검증하고 초안으로 가져왔습니다. 아직 게시되지 않았습니다.");
    } catch (cause) {
      if (mounted.current && token === epoch.current) setError(errorMessage(cause));
    } finally {
      busyLock.current = false;
      if (mounted.current && token === epoch.current) setBusy(false);
    }
  }
  function exportSettings() {
    if (busyLock.current) return;
    try {
      const source = serializePortfolioSettings(draft, baselineIds);
      const blob = new Blob([source], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = PORTFOLIO_SETTINGS_FILENAME;
      document.body.appendChild(link);
      link.click();
      link.remove();
      const timer = window.setTimeout(() => {
        URL.revokeObjectURL(url);
        downloads.current.delete(url);
      }, 30_000);
      downloads.current.set(url, timer);
      setStatus("portfolio-settings.json을 내보냈습니다. 다운로드는 게시가 아닙니다. GitHub 저장소 루트 업로드와 Actions 배포를 확인해 주세요.");
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }
  function endDrag() {
    dragged.current = null;
    setDraggedId(null);
    setDropId(null);
  }
  function drop(event: DragEvent<HTMLElement>, target: string) {
    event.preventDefault();
    const source = dragged.current;
    if (!busyLock.current && !filtered && source && source !== target && event.dataTransfer.getData(DRAG_TYPE) === source) {
      edit((current) => {
        const order = [...current.order];
        const from = order.indexOf(source);
        const to = order.indexOf(target);
        if (from < 0 || to < 0) return current;
        order.splice(from, 1);
        order.splice(to, 0, source);
        return { ...current, order };
      }, `${source}의 전체 목록 순서를 ${target} 위치로 옮겼습니다. 메인 대표 순서는 유지됩니다.`);
    }
    endDrag();
  }

  return (
    <div className={styles.manager} data-portfolio-manager aria-busy={busy}>
      <header className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>CURATE YOUR PORTFOLIO</span>
          <h1>프로젝트 목록<span>.</span></h1>
          <p>작품의 흐름을 정하고, 첫 장면을 고르세요.</p>
        </div>
        <div className={styles.draftState}>
          <span className={styles.stateDot} aria-hidden="true" />
          <span>{dirty ? "게시되지 않은 목록 변경" : "게시된 설정과 동일"}</span>
          <small>이 화면의 목록 초안 · 자동 저장되지 않음</small>
        </div>
      </header>
      <p className={styles.status} role="status" aria-live="polite">{busy ? "설정 JSON을 읽고 검증하는 중…" : status}</p>
      {error && <div className={styles.error} role="alert"><strong>가져오기·내보내기 확인</strong><p>{error}</p><p>현재 목록 초안은 유지됩니다. 올바른 파일을 다시 선택해 주세요.</p></div>}
      <fieldset className={styles.controls} disabled={busy}>
        <legend className={styles.srOnly}>포트폴리오 목록 설정</legend>
        <section className={styles.featuredSection} aria-labelledby="portfolio-featured-heading">
          <div className={styles.sectionHeading}>
            <div><span className={styles.eyebrow}>01 / THE FIRST IMPRESSION</span><h2 id="portfolio-featured-heading">메인 대표 항목</h2></div>
            <span className={styles.count}>{draft.featured.length} / 4 선택</span>
          </div>
          <p className={styles.hint}>홈페이지에 표시할 프로젝트를 정확히 4개 선택하세요. 이 순서는 전체 목록 순서와 별개입니다. 이미지 전용 작품도 선택할 수 있습니다.</p>
          <ol className={styles.featuredGrid} aria-label="메인 대표 표시 순서">
            {draft.featured.map((id, index) => {
              const project = byId.get(id)!;
              return <li key={id} className={styles.featuredCard} data-featured-project-id={id}>
                <div className={styles.featuredImage}><span className={styles.slot}>{String(index + 1).padStart(2, "0")}</span><img src={getAssetPath(project.image)} alt="" loading="lazy" draggable={false} /></div>
                <div className={styles.featuredBody}><small>{id}</small><h3>{project.title}</h3><div className={styles.featuredFooter}><span>메인 {index + 1}번</span><div className={styles.moves}><button type="button" aria-label={`${id} 메인 위로`} disabled={index === 0} onClick={() => moveFeatured(id, -1)}>↑</button><button type="button" aria-label={`${id} 메인 아래로`} disabled={index === draft.featured.length - 1} onClick={() => moveFeatured(id, 1)}>↓</button></div></div></div>
              </li>;
            })}
            {Array.from({ length: Math.max(0, 4 - draft.featured.length) }, (_, index) => <li className={styles.emptySlot} key={`empty-${index}`}><span aria-hidden="true">＋</span><strong>다음 첫 장면</strong><p>아래 목록에서 메인 대표를 선택하세요.</p></li>)}
          </ol>
        </section>
        <div className={styles.workbench}>
          <section className={styles.catalogSection} aria-labelledby="portfolio-catalog-heading">
            <div className={styles.sectionHeading}><div><span className={styles.eyebrow}>02 / THE COMPLETE COLLECTION</span><h2 id="portfolio-catalog-heading">전체 포트폴리오</h2></div><span className={styles.count}>{projects.length}개</span></div>
            <p className={styles.hint}>게시 {projects.length - draft.hidden.length}개 · 게시 제외 {draft.hidden.length}개. 화살표 또는 데스크톱 드래그로 순서를 바꿀 수 있습니다.</p>
            <div className={styles.filters}>
              <label className={styles.search}>프로젝트 검색<input type="search" value={query} placeholder="이름 또는 ID로 검색" onChange={(event) => { setQuery(event.target.value); endDrag(); }} /></label>
              <label>게시 상태 필터<select aria-label="게시 상태 필터" value={filter} onChange={(event) => { setFilter(event.target.value); endDrag(); }}><option value="all">전체 상태</option><option value="visible">게시 항목</option><option value="hidden">게시 제외</option></select></label>
            </div>
            {filtered && <div className={styles.filterNotice}><p id="portfolio-reorder-reason">검색·필터 중에는 전체 순서를 바꿀 수 없습니다. 전체 목록으로 돌아오면 이동할 수 있습니다. 게시 제외·복원과 메인 대표 선택은 가능합니다.</p><button type="button" onClick={() => { setQuery(""); setFilter("all"); }}>검색·필터 초기화</button></div>}
            <p className={styles.catalogHelp}>메인 대표는 체크박스로 선택합니다. 4개가 선택되면 하나를 해제한 뒤 다른 작품을 선택하세요.</p>
            <ol className={styles.catalogList} aria-label="전체 프로젝트 표시 순서">
              {visibleRows.map((id) => {
                const project = byId.get(id)!;
                const index = draft.order.indexOf(id);
                const excluded = hidden.has(id);
                const selected = featured.has(id);
                return <li key={id} className={`${styles.projectRow} ${excluded ? styles.excluded : ""} ${draggedId === id ? styles.dragging : ""} ${dropId === id ? styles.dropTarget : ""}`} data-project-id={id} onDragOver={(event) => { if (!filtered && !busyLock.current && dragged.current) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropId(id); } }} onDrop={(event) => drop(event, id)}>
                  <div className={styles.projectIdentity}><span className={styles.position}>{String(index + 1).padStart(2, "0")}</span><div className={styles.thumbnail}><img src={getAssetPath(project.image)} alt="" loading="lazy" draggable={false} /></div><div className={styles.projectText}><small>{id} · {project.category}</small><h3>{excluded ? project.title : <a href={getAssetPath(`/portfolio/${id}/`)} target="_blank" rel="noopener noreferrer">{project.title}<span className={styles.srOnly}> 상세 보기 (새 탭)</span></a>}</h3><div className={styles.badges}><span className={excluded ? styles.hiddenBadge : styles.visibleBadge}>{excluded ? "게시 제외" : "게시 항목"}</span>{selected && <span className={styles.featuredBadge}>메인 {draft.featured.indexOf(id) + 1}</span>}<span>{project.image.includes("/_admin_media/") ? "CMS · 원본 ZIP으로 수정" : "레거시 · 원본 유지"}</span></div></div></div>
                  <div className={styles.rowControls}>
                    <label className={styles.featureChoice}><input type="checkbox" aria-label={`${id} 메인 대표 선택`} checked={selected} disabled={excluded || (!selected && draft.featured.length >= 4)} onChange={() => toggleFeatured(id)} /><span>메인 대표</span></label>
                    <div className={styles.moves} aria-label={`${id} 목록 순서`}>
                      <button type="button" aria-label={`${id} 목록 위로`} aria-describedby={filtered ? "portfolio-reorder-reason" : undefined} disabled={filtered || index === 0} onClick={() => moveCatalog(id, -1)}>↑</button>
                      <button type="button" aria-label={`${id} 목록 아래로`} aria-describedby={filtered ? "portfolio-reorder-reason" : undefined} disabled={filtered || index === draft.order.length - 1} onClick={() => moveCatalog(id, 1)}>↓</button>
                      <button type="button" className={styles.dragHandle} aria-label={`${id} 드래그로 목록 이동`} title="드래그 또는 위·아래 화살표 키로 이동" aria-describedby={filtered ? "portfolio-reorder-reason" : undefined} disabled={filtered} draggable={!filtered && !busy} onDragStart={(event) => { if (filtered || busyLock.current) { event.preventDefault(); return; } dragged.current = id; setDraggedId(id); event.dataTransfer.setData(DRAG_TYPE, id); event.dataTransfer.effectAllowed = "move"; }} onDragEnd={endDrag} onKeyDown={(event) => { if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); moveCatalog(id, event.key === "ArrowUp" ? -1 : 1); } }}><span aria-hidden="true">⠿</span></button>
                    </div>
                    <button type="button" className={excluded ? styles.restoreButton : styles.excludeButton} onClick={() => toggleHidden(id)}>{excluded ? "복원" : "게시 제외"}</button>
                  </div>
                </li>;
              })}
            </ol>
            {!visibleRows.length && <p className={styles.emptyResults}>검색 결과가 없습니다.</p>}
          </section>
          <aside className={styles.publishSection} aria-labelledby="portfolio-publish-heading">
            <section className={styles.publishCard}><span className={styles.eyebrow}>03 / READY TO PUBLISH</span><h2 id="portfolio-publish-heading">변경을 파일로,<br />게시는 GitHub에서.</h2><p>목록 설정만 내려받습니다. 제목·이미지·GLB·ZIP 원본은 수정하지 않습니다.</p>
              <div className={styles.validation} id="portfolio-export-validation">{validation ? <><strong>내보내기 전 확인</strong><p>{validation}</p></> : <><strong>✓ 내보내기 준비 완료</strong><p>메인 대표 4개 · 전체 목록 순서 검증됨</p></>}</div>
              <button type="button" className={styles.primary} disabled={!!validation} aria-describedby="portfolio-export-validation" onClick={exportSettings}>설정 JSON 내보내기 <span aria-hidden="true">↓</span></button>
              <label className={styles.fileButton}>설정 JSON 가져오기<input type="file" accept=".json,application/json" aria-label="설정 JSON 가져오기" onChange={(event) => void importSettings(event)} /></label>
              <small className={styles.fileHint}>portfolio-settings.json · UTF-8 · 최대 64KiB</small>
              <button type="button" className={styles.resetButton} disabled={!dirty} onClick={resetPublished}>게시된 설정으로 되돌리기</button>
              <p className={styles.offlineNotice}>다운로드·가져오기는 게시가 아닙니다. 목록 초안은 이 화면에만 남으며 새로고침하면 사라집니다. 내보내도 아직 게시되지 않은 변경으로 표시됩니다.</p>
            </section>
            <section className={styles.instructions} aria-label="목록 설정 게시 안내"><h3>한 파일로 전달하는 순서</h3><ol><li><strong>설정 JSON 내보내기</strong><p>검증된 파일을 기기에 보관하세요.</p></li><li><strong>저장소 루트에 업로드·교체</strong><p><code>main / portfolio-settings.json</code>을 커밋하세요. ZIP용 <code>admin-submissions</code> 폴더가 아닙니다.</p><a href={`${REPOSITORY}/upload/main`} target="_blank" rel="noopener noreferrer">GitHub 루트에 설정 업로드 ↗</a></li><li><strong>Actions 검증·배포 확인</strong><p>동일 커밋의 검증과 Pages 배포가 끝나야 반영됩니다. 이 화면은 실제 배포 상태를 확인하지 않습니다.</p><a href={`${REPOSITORY}/actions`} target="_blank" rel="noopener noreferrer">Actions 검증·배포 확인 ↗</a></li></ol></section>
          </aside>
        </div>
      </fieldset>
      <section className={styles.disclaimer} aria-labelledby="portfolio-preservation-heading"><h2 id="portfolio-preservation-heading">작품은 보존하고, 공개 흐름만 바꿉니다.</h2><p>게시 제외는 삭제나 개인정보 보호 기능이 아닙니다. 원본 파일·이미지·모델은 그대로 남고 직접 URL로 접근할 수 있어 비공개가 보장되지 않습니다. 공개 목록과 상세 경로의 제외는 다음 정상 배포 후 적용됩니다.</p><p>누구나 열 수 있는 공개 편집 도구이며 로그인이나 게시 권한을 부여하지 않습니다. 실제 게시는 GitHub 로그인과 저장소 쓰기 권한이 필요합니다. 저장소 쓰기 권한은 콘텐츠뿐 아니라 소스 코드·워크플로 전체에도 적용됩니다. 비밀번호·토큰·비밀 파일을 입력하거나 업로드하지 마세요.</p></section>
    </div>
  );
}
