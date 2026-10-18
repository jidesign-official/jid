"use client";
/* Native images deliberately display local Blob URLs without an image proxy. */
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import dynamic from "next/dynamic";
import PortfolioBody from "@/components/portfolio/PortfolioBody";
import UploadManual from "./UploadManual";
import PortfolioManager from "./PortfolioManager";
import AboutEditor from "./AboutEditor";
import type { PortfolioSettings } from "@/lib/portfolioSettings";
import type { AboutContent } from "@/lib/aboutContent";
import { getAssetPath } from "@/lib/basePath";
import type {
  AdminBlock,
  AdminCatalogProject,
  AdminPackage,
  PortfolioContentBlock,
} from "@/lib/admin/types";
import { ADMIN_LIMITS } from "@/lib/admin/types";
import {
  createPackage,
  inspectAsset,
  readPackage,
  validatePackage,
  type PackageData,
} from "@/lib/admin/package";
import {
  deleteDraft,
  listDrafts,
  loadDraft,
  saveDraft,
  type DraftSummary,
} from "@/lib/admin/drafts";
import styles from "./AdminWorkspace.module.css";
import legacyProjects from "../../../public/images/portfolio/portfolio_data.json";

const Model3DViewer = dynamic(
  () => import("@/components/portfolio/Model3DViewer"),
  { ssr: false, loading: () => <p role="status">3D 뷰어 준비 중…</p> },
);
const REPO = "https://github.com/jidesign-official/jid";
const uid = () => crypto.randomUUID().replaceAll("-", "");
const message = (e: unknown) =>
  e instanceof Error ? e.message : "처리하지 못했습니다. 다시 시도해 주세요.";
function initialData(projects: AdminCatalogProject[]): PackageData {
  let next = 46;
  while (
    projects.some((p) => p.id === `jd${String(next).padStart(3, "0")}`) &&
    next < 999
  )
    next++;
  return {
    manifest: {
      schemaVersion: 1,
      project: {
        id: `jd${String(next).padStart(3, "0")}`,
        title: "",
        category: "Product",
        thumbnail: "",
      },
      blocks: [],
      models: [],
      assets: [],
    },
    files: new Map(),
  };
}
function prune(data: PackageData): PackageData {
  const used = new Set([
    data.manifest.project.thumbnail,
    ...data.manifest.models,
  ]);
  data.manifest.blocks.forEach((b) => {
    if (b.type === "images") b.images.forEach((i) => used.add(i.assetId));
  });
  return {
    manifest: {
      ...data.manifest,
      assets: data.manifest.assets.filter((a) => used.has(a.id)),
    },
    files: new Map(Array.from(data.files).filter(([id]) => used.has(id))),
  };
}
function moved<T>(items: T[], index: number, delta: number): T[] {
  const result = [...items];
  const target = index + delta;
  if (target < 0 || target >= items.length) return result;
  [result[index], result[target]] = [result[target], result[index]];
  return result;
}
const tabs = [
  ["editor", "편집기", "01"],
  ["catalog", "프로젝트 목록", "02"],
  ["publish", "게시 안내", "03"],
  ["account", "계정 · 권한", "04"],
  ["about", "About Us 편집", "05"],
] as const;
type Tab = (typeof tabs)[number][0];
type UploadTarget =
  | { kind: "cover" }
  | { kind: "models" }
  | { kind: "block"; blockId: string };

export default function AdminWorkspace({
  projects,
  initialSettings,
  initialAboutContent,
}: {
  projects: AdminCatalogProject[];
  initialSettings: PortfolioSettings;
  initialAboutContent: AboutContent;
}) {
  const [tab, setTab] = useState<Tab>("editor");
  const [catalogDirty, setCatalogDirty] = useState(false);
  const [aboutDirty, setAboutDirty] = useState(false);
  const [data, setData] = useState<PackageData>(() => initialData(projects));
  const [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState(
      "브라우저에서 편집하고 GitHub에서 게시합니다.",
    );
  const [drafts, setDrafts] = useState<DraftSummary[]>([]),
    [draftError, setDraftError] = useState(""),
    [draftLoading, setDraftLoading] = useState(true);
  const [preview, setPreview] = useState(false);
  const [urls, setUrls] = useState<Record<string, string>>(
    () => Object.create(null) as Record<string, string>,
  );
  const urlCache = useRef(new Map<string, { blob: Blob; url: string }>()),
    mounted = useRef(false),
    epoch = useRef(0),
    draftKey = useRef(""),
    dirtyRef = useRef(dirty),
    busyLock = useRef(false);
  useEffect(() => {
    dirtyRef.current = dirty || catalogDirty || aboutDirty;
  }, [dirty, catalogDirty, aboutDirty]);
  const legacyIds = useMemo(() => legacyProjects.map((p) => p.id), []);
  const manifest = data.manifest;
  const filenamePrefix = /^jd\d{3}(?:_[a-z]+)?$/.test(manifest.project.id)
    ? manifest.project.id
    : "jd046";
  const validation = useMemo(() => {
    try {
      validatePackage(manifest, legacyIds);
      return "";
    } catch (e) {
      return message(e);
    }
  }, [manifest, legacyIds]);
  const totalBytes = manifest.assets.reduce((sum, a) => sum + a.bytes, 0);

  useEffect(() => {
    mounted.current = true;
    const cache = urlCache.current;
    listDrafts()
      .then((list) => {
        if (mounted.current) setDrafts(list);
      })
      .catch((e) => {
        if (mounted.current) setDraftError(message(e));
      })
      .finally(() => {
        if (mounted.current) setDraftLoading(false);
      });
    const warn = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    // Invalidate async jobs (not a DOM ref) before revoking all preview resources.
    return () => {
      mounted.current = false;
      // Mutable job counter, not a DOM ref: invalidate its latest value.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      epoch.current++;
      window.removeEventListener("beforeunload", warn);
      for (const entry of cache.values()) URL.revokeObjectURL(entry.url);
      cache.clear();
    };
  }, []);
  useEffect(() => {
    const cache = urlCache.current;
    const next = Object.create(null) as Record<string, string>;
    for (const [id, entry] of cache) {
      if (data.files.get(id) !== entry.blob) {
        URL.revokeObjectURL(entry.url);
        cache.delete(id);
      }
    }
    for (const [id, blob] of data.files) {
      let entry = cache.get(id);
      if (!entry) {
        entry = { blob, url: URL.createObjectURL(blob) };
        cache.set(id, entry);
      }
      next[id] = entry.url;
    }
    // Object URLs are side-effect resources; never allocate them during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrls(next);
  }, [data.files]);
  function edit(updater: (current: PackageData) => PackageData) {
    setData((current) => prune(updater(current)));
    setDirty(true);
    setError("");
  }
  function editManifest(updater: (m: AdminPackage) => AdminPackage) {
    edit((current) => ({ ...current, manifest: updater(current.manifest) }));
  }
  function blockEdit(id: string, update: (b: AdminBlock) => AdminBlock) {
    editManifest((m) => ({
      ...m,
      blocks: m.blocks.map((b) => (b.id === id ? update(b) : b)),
    }));
  }
  async function action(work: () => Promise<void>) {
    if (busyLock.current) return;
    busyLock.current = true;
    const token = ++epoch.current;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      if (mounted.current && epoch.current === token) setError(message(e));
    } finally {
      busyLock.current = false;
      if (mounted.current && epoch.current === token) setBusy(false);
    }
  }
  function active(token: number) {
    return mounted.current && epoch.current === token;
  }
  async function refreshDrafts() {
    const list = await listDrafts();
    if (mounted.current) {
      setDrafts(list);
      setDraftError("");
    }
  }
  function confirmReplace() {
    return (
      !dirty ||
      window.confirm(
        "저장하지 않은 변경 사항이 있습니다. 현재 편집 내용을 바꾸시겠습니까?",
      )
    );
  }
  function upload(event: ChangeEvent<HTMLInputElement>, target: UploadTarget) {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (!files.length) return;
    void action(async () => {
      const token = epoch.current;
      if (
        target.kind === "models" &&
        manifest.models.length + files.length > ADMIN_LIMITS.models
      )
        throw new Error("3D 모델은 최대 4개입니다.");
      const block =
        target.kind === "block"
          ? manifest.blocks.find((b) => b.id === target.blockId)
          : undefined;
      if (
        block?.type === "images" &&
        block.images.length + files.length > ADMIN_LIMITS.imagesPerBlock
      )
        throw new Error("한 블록에는 이미지를 최대 12개 추가할 수 있습니다.");
      const oldCover =
        target.kind === "cover" &&
        manifest.project.thumbnail &&
        !manifest.blocks.some(
          (b) =>
            b.type === "images" &&
            b.images.some((i) => i.assetId === manifest.project.thumbnail),
        )
          ? manifest.assets.find((a) => a.id === manifest.project.thumbnail)
          : undefined;
      if (manifest.assets.length - (oldCover ? 1 : 0) + files.length > 60)
        throw new Error("전체 에셋은 최대 60개입니다.");
      const results: Awaited<ReturnType<typeof inspectAsset>>[] = [];
      let uploadBytes = 0;
      for (const file of files) {
        uploadBytes += file.size;
        if (
          totalBytes - (oldCover?.bytes ?? 0) + uploadBytes >
          ADMIN_LIMITS.uncompressedBytes
        )
          throw new Error("전체 에셋은 50MiB 이하여야 합니다.");
        const result = await inspectAsset(file, `asset-${uid()}`);
        if (!active(token)) return;
        if ((target.kind === "models") !== (result.asset.kind === "model"))
          throw new Error(
            target.kind === "models"
              ? "GLB 모델만 추가해 주세요."
              : "PNG, JPEG, WebP 이미지를 추가해 주세요.",
          );
        results.push(result);
      }
      if (!active(token)) return;
      edit((current) => {
        let next = {
          ...current.manifest,
          assets: [...current.manifest.assets, ...results.map((r) => r.asset)],
        };
        if (target.kind === "cover")
          next = {
            ...next,
            project: { ...next.project, thumbnail: results[0].asset.id },
          };
        else if (target.kind === "models")
          next = {
            ...next,
            models: [...next.models, ...results.map((r) => r.asset.id)],
          };
        else
          next = {
            ...next,
            blocks: next.blocks.map((b) =>
              b.id === target.blockId && b.type === "images"
                ? {
                    ...b,
                    images: [
                      ...b.images,
                      ...results.map((r) => ({
                        assetId: r.asset.id,
                        alt: "",
                        caption: "",
                      })),
                    ],
                  }
                : b,
            ),
          };
        return {
          manifest: next,
          files: new Map([
            ...current.files,
            ...results.map((r) => [r.asset.id, r.blob] as [string, Blob]),
          ]),
        };
      });
      setStatus(
        `${results.length}개 파일을 검증하고 추가했습니다. 원본 바이트를 보존합니다.`,
      );
    });
  }
  function addBlock(type: AdminBlock["type"]) {
    if (manifest.blocks.length >= 100) {
      setError("블록은 최대 100개입니다.");
      return;
    }
    const id = `block-${uid()}`;
    const block: AdminBlock =
      type === "images"
        ? { id, type, columns: 1, images: [] }
        : type === "heading"
          ? { id, type, level: 2, text: "" }
          : type === "paragraph"
            ? { id, type, text: "" }
            : type === "spacer"
              ? { id, type, size: "medium" }
              : { id, type: "divider" };
    editManifest((m) => ({ ...m, blocks: [...m.blocks, block] }));
    setStatus("블록을 추가했습니다. 아래에서 내용을 입력해 주세요.");
  }
  function importZip(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || !confirmReplace()) return;
    void action(async () => {
      const token = epoch.current;
      const restored = await readPackage(file);
      if (!active(token)) return;
      setData(restored);
      draftKey.current = "";
      setDirty(true);
      setTab("editor");
      setStatus(
        "ZIP을 가져왔습니다. 같은 이름으로 내보내고 GitHub에서 교체하면 업데이트됩니다.",
      );
    });
  }
  function exportZip() {
    void action(async () => {
      const token = epoch.current;
      const blob = await createPackage(manifest, data.files, legacyIds);
      if (!active(token)) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${manifest.project.id}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus(
        `${manifest.project.id}.zip 내보내기 완료. 다음은 GitHub 업로드입니다. 게시 안내를 확인해 주세요.`,
      );
    });
  }
  const resolved: PortfolioContentBlock[] = manifest.blocks.map((b) =>
    b.type === "images"
      ? {
          ...b,
          images: b.images.flatMap((i) => {
            const a = manifest.assets.find((a) => a.id === i.assetId);
            return a && urls[i.assetId]
              ? [
                  {
                    src: urls[i.assetId],
                    width: a.width!,
                    height: a.height!,
                    alt: i.alt,
                    caption: i.caption,
                  },
                ]
              : [];
          }),
        }
      : b,
  );
  const blockNames = {
    images: "이미지",
    heading: "제목",
    paragraph: "본문",
    spacer: "여백",
    divider: "구분선",
  };
  function moveControls(
    index: number,
    length: number,
    kind: string,
    move: (delta: number) => void,
    remove: () => void,
  ) {
    return (
      <div className={styles.moveControls}>
        <button
          type="button"
          aria-label={`${kind} 위로`}
          disabled={index === 0}
          onClick={() => move(-1)}
        >
          ↑
        </button>
        <button
          type="button"
          aria-label={`${kind} 아래로`}
          disabled={index === length - 1}
          onClick={() => move(1)}
        >
          ↓
        </button>
        <button
          type="button"
          className={styles.deleteButton}
          aria-label={`${kind} 삭제`}
          onClick={remove}
        >
          삭제
        </button>
      </div>
    );
  }
  return (
    <div className={styles.shell} data-admin-shell>
      <aside className={styles.sidebar}>
        <a
          href={getAssetPath("/")}
          className={styles.brand}
          aria-label="JiD 홈페이지"
        >
          <img
            src={getAssetPath("/logo.png")}
            alt="JiD"
            width={100}
            height={51}
          />
          <span>WORKSPACE</span>
        </a>
        <div className={styles.publicBadge}>
          <i />
          공개 편집기
        </div>
        <nav aria-label="관리 도구 메뉴">
          {tabs.map(([key, label, num]) => (
            <button
              type="button"
              key={key}
              aria-current={tab === key ? "page" : undefined}
              onClick={() => setTab(key)}
            >
              <span aria-hidden="true">{num}</span>
              {label}
              <b aria-hidden="true">↗</b>
            </button>
          ))}
        </nav>
        <div className={styles.sidebarBottom}>
          <p>DESIGN, THEN PUBLISH.</p>
          <span>
            초안은 이 브라우저에만 저장됩니다.
            <br />
            게시 권한은 GitHub에서 확인합니다.
          </span>
          <a href={getAssetPath("/portfolio/")}>사이트 보기 ↗</a>
        </div>
      </aside>
      <div className={styles.main}>
        <header className={styles.topbar}>
          <span>JiD / {tabs.find((t) => t[0] === tab)?.[1]}</span>
          <div className={styles.topbarActions}>
            <UploadManual projectId={manifest.project.id} />
            <span className={styles.localState}>
              {busy
                ? "● 처리 중…"
                : dirty || catalogDirty || aboutDirty
                  ? "● 저장하지 않은 변경"
                  : "○ 로컬 작업 공간"}
            </span>
          </div>
        </header>
        <div className={styles.content}>
          <div className={styles.notice}>
            <span aria-hidden="true">↗</span>
            <p>
              누구나 열 수 있는 <strong>공개 편집 도구</strong>입니다. 이 화면은
              로그인이나 게시 권한을 부여하지 않습니다. 실제 게시는 GitHub
              로그인과 저장소 쓰기 권한이 필요합니다.
            </p>
          </div>
          {error && (
            <div role="alert" className={styles.error}>
              {error}
              <button
                type="button"
                onClick={() => setError("")}
                aria-label="오류 닫기"
              >
                ×
              </button>
            </div>
          )}
          <p className={styles.status} role="status" aria-live="polite">
            {status}
          </p>
          {tab === "editor" && (
            <>
              <section className={styles.pageHeading}>
                <div>
                  <span className={styles.eyebrow}>PORTFOLIO EDITOR</span>
                  <h1>
                    새로운 이야기를
                    <br />
                    디자인하세요<span>.</span>
                  </h1>
                  <p>이미지, 문장, 그리고 3D. 블록을 쌓아 완성하는 프로젝트.</p>
                </div>
                <div className={styles.headingActions}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (confirmReplace()) {
                        setData(initialData(projects));
                        setDirty(false);
                        draftKey.current = "";
                        setStatus("새 프로젝트를 시작합니다.");
                      }
                    }}
                  >
                    새 프로젝트
                  </button>
                  <label className={styles.fileButton}>
                    ZIP 가져오기
                    <input
                      type="file"
                      accept=".zip"
                      aria-label="프로젝트 ZIP 가져오기"
                      disabled={busy}
                      onChange={importZip}
                    />
                  </label>
                </div>
              </section>
              <div className={styles.editorGrid}>
                <div className={styles.editorColumn}>
                  <fieldset disabled={busy} className={styles.editFieldset}>
                    <section className={styles.card}>
                      <div className={styles.sectionTitle}>
                        <span>01</span>
                        <h2>프로젝트 기본 정보</h2>
                      </div>
                      <div className={styles.formGrid}>
                        <label>
                          프로젝트 ID
                          <input
                            aria-label="프로젝트 ID"
                            value={manifest.project.id}
                            maxLength={16}
                            onChange={(e) =>
                              editManifest((m) => ({
                                ...m,
                                project: { ...m.project, id: e.target.value },
                              }))
                            }
                            placeholder="jd046"
                            spellCheck={false}
                          />
                          <small>영문 소문자 · 예: jd046, jd046_a</small>
                        </label>
                        <label>
                          카테고리
                          <select
                            value={manifest.project.category}
                            onChange={(e) =>
                              editManifest((m) => ({
                                ...m,
                                project: {
                                  ...m.project,
                                  category: e.target.value as
                                    | "Product"
                                    | "UX/UI",
                                },
                              }))
                            }
                          >
                            <option>Product</option>
                            <option>UX/UI</option>
                          </select>
                        </label>
                      </div>
                      <label>
                        프로젝트 제목
                        <input
                          aria-label="프로젝트 제목"
                          value={manifest.project.title}
                          maxLength={200}
                          onChange={(e) =>
                            editManifest((m) => ({
                              ...m,
                              project: { ...m.project, title: e.target.value },
                            }))
                          }
                          placeholder="프로젝트 이름을 입력하세요"
                        />
                      </label>
                    </section>
                    <section className={styles.card}>
                      <div className={styles.sectionTitle}>
                        <span>02</span>
                        <h2>
                          대표 이미지 <em>필수</em>
                        </h2>
                      </div>
                      <p className={styles.hint}>
                        목록과 상세 페이지가 함께 사용하는 대표 이미지입니다.
                        실제 게시 화면은 1024 × 1024 정사각형 안에 원본 비율을
                        유지합니다.
                      </p>
                      <div className={styles.coverUpload}>
                        {urls[manifest.project.thumbnail] ? (
                          <div className={styles.cover}>
                            <img
                              src={urls[manifest.project.thumbnail]}
                              alt="프로젝트 대표 이미지 미리보기"
                            />
                          </div>
                        ) : (
                          <div className={styles.coverEmpty}>
                            <span>＋</span>
                            <strong>프로젝트의 첫인상</strong>
                            <small>PNG · JPEG · WebP</small>
                          </div>
                        )}
                        <div>
                          <label className={styles.fileButton}>
                            {manifest.project.thumbnail
                              ? "대표 이미지 교체"
                              : "대표 이미지 선택"}
                            <input
                              type="file"
                              accept="image/png,image/jpeg,image/webp"
                              aria-label="대표 이미지 업로드"
                              onChange={(e) => upload(e, { kind: "cover" })}
                            />
                          </label>
                          <p className={styles.hint}>
                            ZIP 파일명: {filenamePrefix}_thumbs.ext
                            <br />
                            원본 파일 유지 · 최대 8192px / 40MP
                            <br />
                            ZIP 전체 25MiB 이내
                          </p>
                          {manifest.project.thumbnail && (
                            <button
                              type="button"
                              onClick={() =>
                                editManifest((m) => ({
                                  ...m,
                                  project: { ...m.project, thumbnail: "" },
                                }))
                              }
                            >
                              대표 이미지 삭제
                            </button>
                          )}
                        </div>
                      </div>
                    </section>
                    <section className={styles.blockSection}>
                      <div className={styles.sectionTitle}>
                        <span>03</span>
                        <h2>콘텐츠 블록</h2>
                        <small>{manifest.blocks.length} / 100</small>
                      </div>
                      <p className={styles.hint}>
                        순서 버튼으로 블록과 이미지의 흐름을 바꿀 수 있습니다.
                        모바일에서는 이미지가 한 열로 이어집니다.
                      </p>
                      {!manifest.blocks.length && (
                        <div className={styles.empty}>
                          <span>▤</span>
                          <h3>빈 캔버스에서 시작하세요</h3>
                          <p>아래에서 첫 블록을 추가해 보세요.</p>
                        </div>
                      )}
                      {manifest.blocks.map((block, index) => (
                        <article
                          key={block.id}
                          className={styles.block}
                          aria-label={`블록 ${index + 1} ${blockNames[block.type]}`}
                        >
                          <div className={styles.blockHeader}>
                            <h3>
                              <span>{String(index + 1).padStart(2, "0")}</span>
                              {blockNames[block.type]}
                            </h3>
                            {moveControls(
                              index,
                              manifest.blocks.length,
                              `블록 ${index + 1}`,
                              (delta) =>
                                editManifest((m) => ({
                                  ...m,
                                  blocks: moved(m.blocks, index, delta),
                                })),
                              () =>
                                editManifest((m) => ({
                                  ...m,
                                  blocks: m.blocks.filter(
                                    (b) => b.id !== block.id,
                                  ),
                                })),
                            )}
                          </div>
                          {block.type === "images" && (
                            <>
                              <div className={styles.imageTools}>
                                <label>
                                  데스크톱 열 수
                                  <select
                                    aria-label={`블록 ${index + 1} 열 수`}
                                    value={block.columns}
                                    onChange={(e) =>
                                      blockEdit(block.id, (b) =>
                                        b.type === "images"
                                          ? {
                                              ...b,
                                              columns: Number(
                                                e.target.value,
                                              ) as 1 | 2 | 3 | 4,
                                            }
                                          : b,
                                      )
                                    }
                                  >
                                    {[1, 2, 3, 4].map((n) => (
                                      <option key={n} value={n}>
                                        {n}열
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <label className={styles.fileButton}>
                                  ＋ 이미지 추가
                                  <input
                                    type="file"
                                    multiple
                                    accept="image/png,image/jpeg,image/webp"
                                    aria-label="블록 이미지 업로드"
                                    onChange={(e) =>
                                      upload(e, {
                                        kind: "block",
                                        blockId: block.id,
                                      })
                                    }
                                  />
                                </label>
                              </div>
                              <p className={styles.hint}>
                                ZIP 파일명: {filenamePrefix}_body_01.ext부터
                                본문 표시 순서로 자동 정리됩니다.
                              </p>
                              {!block.images.length && (
                                <p className={styles.hint}>
                                  이미지를 1~12개 선택해 주세요. 여러 파일을 한
                                  번에 추가할 수 있습니다.
                                </p>
                              )}
                              {block.images.map((image, i) => (
                                <div
                                  className={styles.imageRow}
                                  key={`${image.assetId}-${i}`}
                                >
                                  <div className={styles.imageThumb}>
                                    {urls[image.assetId] && (
                                      <img
                                        src={urls[image.assetId]}
                                        alt={
                                          image.alt || `업로드 이미지 ${i + 1}`
                                        }
                                      />
                                    )}
                                  </div>
                                  <div className={styles.imageFields}>
                                    <div className={styles.imageRowHeading}>
                                      <span>이미지 {i + 1}</span>
                                      {moveControls(
                                        i,
                                        block.images.length,
                                        `이미지 ${i + 1}`,
                                        (delta) =>
                                          blockEdit(block.id, (b) =>
                                            b.type === "images"
                                              ? {
                                                  ...b,
                                                  images: moved(
                                                    b.images,
                                                    i,
                                                    delta,
                                                  ),
                                                }
                                              : b,
                                          ),
                                        () =>
                                          blockEdit(block.id, (b) =>
                                            b.type === "images"
                                              ? {
                                                  ...b,
                                                  images: b.images.filter(
                                                    (_, n) => n !== i,
                                                  ),
                                                }
                                              : b,
                                          ),
                                      )}
                                    </div>
                                    <label>
                                      대체 텍스트
                                      <input
                                        aria-label={`이미지 ${i + 1} 대체 텍스트`}
                                        maxLength={300}
                                        value={image.alt}
                                        placeholder="이미지의 내용을 설명해 주세요"
                                        onChange={(e) =>
                                          blockEdit(block.id, (b) =>
                                            b.type === "images"
                                              ? {
                                                  ...b,
                                                  images: b.images.map(
                                                    (item, n) =>
                                                      n === i
                                                        ? {
                                                            ...item,
                                                            alt: e.target.value,
                                                          }
                                                        : item,
                                                  ),
                                                }
                                              : b,
                                          )
                                        }
                                      />
                                    </label>
                                    <label>
                                      캡션
                                      <input
                                        aria-label={`이미지 ${i + 1} 캡션`}
                                        maxLength={500}
                                        value={image.caption}
                                        placeholder="이미지 아래에 표시할 설명 (선택)"
                                        onChange={(e) =>
                                          blockEdit(block.id, (b) =>
                                            b.type === "images"
                                              ? {
                                                  ...b,
                                                  images: b.images.map(
                                                    (item, n) =>
                                                      n === i
                                                        ? {
                                                            ...item,
                                                            caption:
                                                              e.target.value,
                                                          }
                                                        : item,
                                                  ),
                                                }
                                              : b,
                                          )
                                        }
                                      />
                                    </label>
                                  </div>
                                </div>
                              ))}
                            </>
                          )}
                          {block.type === "heading" && (
                            <>
                              <label>
                                제목 단계
                                <select
                                  value={block.level}
                                  onChange={(e) =>
                                    blockEdit(block.id, (b) =>
                                      b.type === "heading"
                                        ? {
                                            ...b,
                                            level: Number(e.target.value) as
                                              | 2
                                              | 3,
                                          }
                                        : b,
                                    )
                                  }
                                >
                                  <option value={2}>H2 · 큰 제목</option>
                                  <option value={3}>H3 · 작은 제목</option>
                                </select>
                              </label>
                              <label>
                                제목 내용
                                <input
                                  value={block.text}
                                  maxLength={200}
                                  onChange={(e) =>
                                    blockEdit(block.id, (b) =>
                                      b.type === "heading"
                                        ? { ...b, text: e.target.value }
                                        : b,
                                    )
                                  }
                                  placeholder="이야기의 다음 장"
                                />
                              </label>
                            </>
                          )}
                          {block.type === "paragraph" && (
                            <label>
                              본문 내용
                              <textarea
                                value={block.text}
                                maxLength={10000}
                                rows={5}
                                onChange={(e) =>
                                  blockEdit(block.id, (b) =>
                                    b.type === "paragraph"
                                      ? { ...b, text: e.target.value }
                                      : b,
                                  )
                                }
                                placeholder="프로젝트의 배경과 디자인 의도를 적어 주세요."
                              />
                              <small>
                                일반 텍스트만 사용합니다. HTML은 실행되지
                                않습니다.
                              </small>
                            </label>
                          )}
                          {block.type === "spacer" && (
                            <label>
                              여백 크기
                              <select
                                value={block.size}
                                onChange={(e) =>
                                  blockEdit(block.id, (b) =>
                                    b.type === "spacer"
                                      ? {
                                          ...b,
                                          size: e.target.value as
                                            | "small"
                                            | "medium"
                                            | "large",
                                        }
                                      : b,
                                  )
                                }
                              >
                                <option value="small">작게</option>
                                <option value="medium">보통</option>
                                <option value="large">크게</option>
                              </select>
                            </label>
                          )}
                          {block.type === "divider" && (
                            <div className={styles.dividerPreview}>
                              <hr />
                              <small>콘텐츠 사이의 가는 구분선</small>
                            </div>
                          )}
                        </article>
                      ))}
                      <div className={styles.addBlocks}>
                        {(
                          [
                            "images",
                            "heading",
                            "paragraph",
                            "spacer",
                            "divider",
                          ] as const
                        ).map((type) => (
                          <button
                            key={type}
                            type="button"
                            aria-label={`${blockNames[type]} 블록 추가`}
                            onClick={() => addBlock(type)}
                          >
                            ＋ {blockNames[type]}
                          </button>
                        ))}
                      </div>
                    </section>
                    <section className={styles.card}>
                      <div className={styles.sectionTitle}>
                        <span>04</span>
                        <h2>
                          3D 모델 <em>선택</em>
                        </h2>
                        <small>{manifest.models.length} / 4</small>
                      </div>
                      <p className={styles.hint}>
                        ZIP 파일명: {filenamePrefix}_model_01.glb부터 표시
                        순서로 자동 정리됩니다.
                        <br />
                        GLB 2.0 · 최대 4개 · 표시 순서대로 게시됩니다. 외부 파일
                        참조, Draco / Meshopt / BasisU 압축과 GPU 인스턴싱
                        확장은 지원하지 않습니다. 새 업로드는 기본
                        삼각형(TRIANGLES)의 애니메이션 없는 정적 제품 모델만
                        지원합니다. GLB 하나당 메시·노드·장면의 반복 참조를
                        합산한 처리량은 64MiB 이하여야 하며 파일 크기와 별도로
                        검사합니다. 공유 이미지라도 샘플러 설정별 텍스처
                        처리량을 따로 합산합니다. 부가정보(메타데이터)의 복제
                        작업량도 별도의 64MiB 한도로 제한합니다. 바이너리 영역과
                        이미지 원본 복사량도 합산해 GLB당 별도로 64MiB 이하로
                        제한합니다. 처리량 수치는 실제 GPU 메모리 상한이
                        아닙니다. 키프레임 애니메이션·스켈레톤 변형·모프 타깃은
                        제외해 주세요. 뷰어의 회전·확대 기능과 기존 프로젝트는
                        유지됩니다.
                      </p>
                      {manifest.models.map((id, index) => (
                        <div key={id} className={styles.modelRow}>
                          <span>◇</span>
                          <div>
                            <strong>
                              {manifest.assets.find((a) => a.id === id)?.name}
                            </strong>
                            <small>
                              {(
                                (manifest.assets.find((a) => a.id === id)
                                  ?.bytes ?? 0) /
                                1024 /
                                1024
                              ).toFixed(2)}{" "}
                              MiB
                            </small>
                          </div>
                          {moveControls(
                            index,
                            manifest.models.length,
                            `모델 ${index + 1}`,
                            (delta) =>
                              editManifest((m) => ({
                                ...m,
                                models: moved(m.models, index, delta),
                              })),
                            () =>
                              editManifest((m) => ({
                                ...m,
                                models: m.models.filter((a) => a !== id),
                              })),
                          )}
                        </div>
                      ))}
                      <label className={styles.fileButton}>
                        ＋ GLB 모델 선택
                        <input
                          type="file"
                          multiple
                          accept=".glb"
                          aria-label="3D 모델 업로드"
                          onChange={(e) => upload(e, { kind: "models" })}
                        />
                      </label>
                    </section>
                  </fieldset>
                </div>
                <aside className={styles.rightColumn}>
                  <section className={styles.publishCard}>
                    <span className={styles.eyebrow}>READY TO SHARE</span>
                    <h2>완성의 다음 단계</h2>
                    <p>
                      ZIP을 내려받고 GitHub에 업로드하면 검증 후 사이트에
                      반영됩니다.
                    </p>
                    <dl>
                      <div>
                        <dt>콘텐츠 블록</dt>
                        <dd>{manifest.blocks.length}</dd>
                      </div>
                      <div>
                        <dt>원본 에셋</dt>
                        <dd>
                          {manifest.assets.length}개 /{" "}
                          {(totalBytes / 1024 / 1024).toFixed(1)} MiB
                        </dd>
                      </div>
                    </dl>
                    <div className={styles.validation}>
                      {busy
                        ? "파일을 읽고 검증하고 있습니다…"
                        : validation || "✓ 내보내기 준비 완료"}
                    </div>
                    <button
                      type="button"
                      className={styles.primary}
                      disabled={busy || !!validation}
                      onClick={exportZip}
                    >
                      ZIP 내보내기 <span aria-hidden="true">↓</span>
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void action(async () => {
                          const token = epoch.current;
                          const key = draftKey.current || `draft-${uid()}`;
                          await saveDraft(key, data);
                          if (!active(token)) return;
                          draftKey.current = key;
                          setDirty(false);
                          setStatus(
                            "초안을 이 브라우저에 저장했습니다. 아직 게시되지 않았습니다.",
                          );
                          await refreshDrafts();
                        })
                      }
                    >
                      초안 저장
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreview(!preview)}
                      aria-expanded={preview}
                    >
                      {preview ? "미리보기 닫기" : "전체 미리보기"} ↗
                    </button>
                    <small>
                      저장은 게시가 아닙니다.
                      <br />
                      개인정보·비밀 파일을 올리지 마세요.
                    </small>
                  </section>
                  <section className={styles.draftCard}>
                    <div className={styles.sectionTitle}>
                      <h2>내 브라우저 초안</h2>
                      <button
                        type="button"
                        disabled={busy}
                        aria-label="초안 목록 새로고침"
                        onClick={() => void action(refreshDrafts)}
                      >
                        ↻
                      </button>
                    </div>
                    {draftLoading ? (
                      <p>초안 목록을 불러오는 중…</p>
                    ) : draftError ? (
                      <p className={styles.errorText}>{draftError}</p>
                    ) : !drafts.length ? (
                      <p>
                        저장된 초안이 없습니다.
                        <br />
                        저장하면 이곳에서 이어갈 수 있어요.
                      </p>
                    ) : (
                      drafts.map((draft) => (
                        <div className={styles.draftRow} key={draft.id}>
                          <strong>{draft.title}</strong>
                          <small>
                            {draft.projectId} ·{" "}
                            {new Date(draft.updatedAt).toLocaleDateString(
                              "ko-KR",
                            )}
                          </small>
                          <div>
                            <button
                              type="button"
                              disabled={busy}
                              aria-label={`초안 불러오기 ${draft.title}`}
                              onClick={() => {
                                if (!confirmReplace()) return;
                                void action(async () => {
                                  const token = epoch.current;
                                  const restored = await loadDraft(draft.id);
                                  if (!active(token)) return;
                                  setData(restored);
                                  draftKey.current = draft.id;
                                  setDirty(false);
                                  setStatus("저장된 초안을 불러왔습니다.");
                                });
                              }}
                            >
                              불러오기
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              aria-label={`초안 삭제 ${draft.title}`}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    "이 브라우저에서 초안을 삭제하시겠습니까? GitHub의 게시물은 삭제되지 않습니다.",
                                  )
                                )
                                  void action(async () => {
                                    await deleteDraft(draft.id);
                                    if (!mounted.current) return;
                                    if (draftKey.current === draft.id) {
                                      draftKey.current = "";
                                      setDirty(true);
                                    }
                                    await refreshDrafts();
                                    setStatus("저장된 초안을 삭제했습니다.");
                                  });
                              }}
                            >
                              삭제
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                    <small>
                      이 기기·브라우저에만 보관됩니다. 사이트 데이터 삭제 시
                      사라지므로 ZIP을 별도로 백업하세요.
                    </small>
                  </section>
                </aside>
              </div>
              {preview && (
                <section
                  className={styles.preview}
                  aria-label="프로젝트 미리보기"
                >
                  <div className={styles.previewHeader}>
                    <div>
                      <span className={styles.eyebrow}>LIVE PREVIEW</span>
                      <h2>독자가 만날 화면</h2>
                    </div>
                    <button type="button" onClick={() => setPreview(false)}>
                      미리보기 닫기
                    </button>
                  </div>
                  <h1>{manifest.project.title || "프로젝트 제목"}</h1>
                  <p>{manifest.project.category}</p>
                  {urls[manifest.project.thumbnail] && (
                    <div className={styles.previewCover}>
                      <img
                        src={urls[manifest.project.thumbnail]}
                        alt={manifest.project.title || "대표 이미지"}
                      />
                    </div>
                  )}
                  <PortfolioBody
                    blocks={resolved}
                    projectTitle={manifest.project.title}
                  />
                  {manifest.models.map(
                    (id, index) =>
                      urls[id] && (
                        <div key={urls[id]} className={styles.modelPreview}>
                          <Model3DViewer
                            modelUrl={urls[id]}
                            projectTitle={
                              manifest.models.length > 1
                                ? `${manifest.project.title} — 모델 ${index + 1}`
                                : manifest.project.title
                            }
                          />
                        </div>
                      ),
                  )}
                </section>
              )}
            </>
          )}
          <div hidden={tab !== "catalog"}>
            <PortfolioManager
              projects={projects}
              initialSettings={initialSettings}
              onDirtyChange={setCatalogDirty}
            />
          </div>
          <div hidden={tab !== "about"}>
            <AboutEditor
              initialContent={initialAboutContent}
              onDirtyChange={setAboutDirty}
            />
          </div>
          {tab === "publish" && (
            <>
              <section className={styles.pageHeading}>
                <div>
                  <span className={styles.eyebrow}>GITHUB-ONLY PUBLISHING</span>
                  <h1>
                    세 단계로,
                    <br />
                    사이트에 연결<span>.</span>
                  </h1>
                  <p>별도 서버나 외부 CMS 없이 저장소에서 관리합니다.</p>
                </div>
              </section>
              <div className={styles.steps}>
                <article>
                  <span>01 / EXPORT</span>
                  <h2>프로젝트 ZIP 내보내기</h2>
                  <p>
                    필수 대표 이미지와 내용을 완성하고{" "}
                    <strong>{manifest.project.id}.zip</strong>을 내려받으세요.
                    PNG · JPEG · WebP, GLB 원본 바이트가 함께 보존됩니다.
                  </p>
                  <button type="button" onClick={() => setTab("editor")}>
                    편집기로 돌아가기 ↗
                  </button>
                </article>
                <article>
                  <span>02 / UPLOAD</span>
                  <h2>GitHub에서 업로드</h2>
                  <p>
                    GitHub에 로그인한 뒤 <code>main / admin-submissions</code>에
                    ZIP을 업로드하고 변경을 커밋하세요. 저장소 쓰기 권한이
                    있어야 게시할 수 있습니다.
                  </p>
                  <a
                    className={styles.primary}
                    href={`${REPO}/upload/main/admin-submissions`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    GitHub에 ZIP 업로드 ↗
                  </a>
                </article>
                <article>
                  <span>03 / CHECK</span>
                  <h2>Actions 검증과 배포 확인</h2>
                  <p>
                    GitHub Actions에서 패키지 검증과 Pages 배포 상태를
                    확인하세요. 실패하면 현재 사이트는 유지됩니다. 이 편집기는
                    배포 완료를 자동 확인하거나 보장하지 않습니다.
                  </p>
                  <a
                    href={`${REPO}/actions`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Actions 상태 확인 ↗
                  </a>
                </article>
              </div>
              <div className={styles.infoCard}>
                <h2>수정과 삭제도 GitHub에서</h2>
                <p>
                  같은 ID의 ZIP을 교체하면 CMS 프로젝트가 업데이트됩니다. ZIP을
                  저장소에서 삭제하고 배포하면 해당 CMS 프로젝트가 제거됩니다.
                  관리 설정에서 해당 ID를 참조한다면 그 참조도 함께 정리해야 합니다.
                  일반적인 노출 중단은 프로젝트 목록의 게시 제외/복원을 사용하세요.
                  기존 레거시 프로젝트 ID는 사용할 수 없습니다. ZIP은 25MiB,
                  압축 해제 50MiB, 에셋 60개, 블록 100개 이내여야 합니다.
                </p>
              </div>
            </>
          )}
          {tab === "account" && (
            <>
              <section className={styles.pageHeading}>
                <div>
                  <span className={styles.eyebrow}>
                    ACCESS & RESPONSIBILITY
                  </span>
                  <h1>
                    권한은 GitHub에서<span>.</span>
                  </h1>
                  <p>
                    이 사이트에는 별도 관리자 계정이나 로그인 세션이 없습니다.
                  </p>
                </div>
              </section>
              <div className={styles.accountGrid}>
                <article className={styles.card}>
                  <span className={styles.eyebrow}>EVERYONE</span>
                  <h2>편집은 공개, 게시는 권한 확인</h2>
                  <p>
                    누구나 이 도구로 로컬 초안을 만들 수 있습니다. 이 화면을
                    열거나 초안을 저장하는 것은 인증이 아닙니다. GitHub 로그인
                    상태를 이 도구가 확인하지 않습니다.
                  </p>
                  <a
                    href={`https://github.com/login?return_to=${encodeURIComponent("/jidesign-official/jid")}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    GitHub 로그인 ↗
                  </a>
                </article>
                <article className={styles.card}>
                  <span className={styles.eyebrow}>REPOSITORY OWNER</span>
                  <h2>협업자 초대와 접근 관리</h2>
                  <p>
                    개인 계정 소유 저장소입니다. 소유자가 GitHub의 Collaborators
                    설정에서 초대를 보내고 접근을 관리합니다. 초대받은 사람은
                    GitHub에서 수락해야 합니다.
                  </p>
                  <a
                    href={`${REPO}/settings/access`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    GitHub 협업자 설정 ↗
                  </a>
                </article>
                <article className={styles.card}>
                  <span className={styles.eyebrow}>WRITE COLLABORATOR</span>
                  <h2>초대 수락 후 업로드</h2>
                  <p>
                    쓰기 권한을 가진 협업자는 GitHub 웹 업로드로 ZIP을 게시할 수
                    있습니다. 협업자 설정에 접근할 수 없다면 저장소 소유자에게
                    요청하세요. 이 편집기에는 독립적인 역할·권한 설정이
                    없습니다.
                  </p>
                  <a
                    href="https://github.com/notifications"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    GitHub 초대 알림 확인 ↗
                  </a>
                </article>
              </div>
              <div className={styles.permissionWarning}>
                <h2>저장소 전체 쓰기 권한에 주의하세요</h2>
                <p>
                  저장소 작성자는 콘텐츠뿐 아니라 소스 코드와 워크플로도 바꿀 수
                  있습니다. 콘텐츠 전용 권한으로 제한되지 않습니다. 신뢰하는
                  사람만 초대하고, 비밀번호·PAT·비밀 키를 이 편집기나 공개
                  저장소에 입력하지 마세요.
                </p>
              </div>
            </>
          )}
        </div>
        <div className={styles.workspaceFoot}>
          <span>JiD STUDIO — PUBLIC WORKSPACE</span>
          <span>LOCAL DRAFTS / GITHUB PUBLISHING</span>
        </div>
      </div>
    </div>
  );
}
