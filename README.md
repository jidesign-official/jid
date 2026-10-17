# JiD - Portfolio Web Application

Apple 감성의 미니멀하고 직관적인 인터랙션을 제공하는 **JiD** 포트폴리오 웹사이트입니다.

---

## 🛠️ 기술 스택 (Tech Stack)

- **Framework**: Next.js 16 (App Router, Turbopack)
- **Library**: React 19, TypeScript
- **Styling**: Tailwind CSS v4
- **Typography**: Pretendard Light (300) & SF Pro
- **Animation**: GSAP 3, `@gsap/react`, ScrollTrigger
- **3D Graphics**: Three.js
- **Server / Hosting**: Github
- **Form Service**: FormSubmit
---
## 🔗 접속주소 : https://jid.kr/

GitHub Pages의 커스텀 도메인은 `jid.kr`이며 사이트는 `/jid` 없이 루트(`/`)에 배포합니다. GitHub Actions는 `actions/configure-pages`의 `base_path` 출력을 읽어 빌드하며, 현재 도메인에서는 빈 경로가 적용됩니다. 로컬 배포용 빌드는 `NEXT_PUBLIC_BASE_PATH="" npm run build`를 사용하세요. 별도의 프로젝트 사이트를 검사할 때만 `/jid` 같은 명시적 경로를 지정하세요.

문의 전송 후 안내 주소는 `https://jid.kr/contact/thanks/`입니다. DNS와 HTTPS 설정은 GitHub Pages에서 관리하며, 메일용 MX/TXT 레코드는 사이트 배포 과정에서 변경하지 않습니다.

## 포트폴리오 관리자 편집기

- 접속: **https://jid.kr/admin/** — 공개된 정적 편집 도구입니다. 자체 로그인이나 비밀번호 저장 기능은 없습니다. 실제 게시/초대 권한은 GitHub에서 검사합니다.
- 대표 이미지, 제목/분류, 이미지·텍스트·제목·여백·구분선 블록을 작성합니다. 한 이미지 블록에 여러 장을 넣고 1–4열 배치 및 이미지/블록 순서를 바꿀 수 있습니다. 모바일은 한 열로 표시합니다.
- 대표 이미지는 목록과 상세 상단에 공통 사용하고, GLB가 없으면 하단 3D 영역 전체를 숨깁니다. GLB는 최대 4개까지 순서대로 추가할 수 있습니다. PNG/JPEG/WebP 및 외부 리소스가 없는 GLB2를 지원합니다.
- **업로드 매뉴얼** 버튼의 팝업에서 파일 역할과 작성·게시 순서를 확인합니다. ZIP 내 파일명은 `<코드>_thumbs.ext` / `<코드>_body_01.ext` / `<코드>_model_01.glb`로 역할·표시 순서에 맞춰 자동 정리합니다. 업로드 전 이름은 자유이며 원본 파일명·바이트는 변경하지 않습니다.
- 초안은 해당 브라우저의 IndexedDB에 저장합니다. GitHub/다른 컴퓨터와 자동 동기화하지 않으므로 ZIP으로 백업하세요. 공개 컴퓨터에서는 초안을 삭제하세요.
- **작성 → ZIP 내보내기 → GitHub의 `admin-submissions/` 폴더에 업로드/main 커밋 → Actions 검증·배포** 순서입니다. ZIP 한 개는 25MiB 이하여야 하며 전체 정적 사이트 용량도 빌드 시 검사합니다.
- 기존 69개 항목/원본은 보존합니다. 이 버전은 신규 항목부터 적용합니다. 새 형식 항목의 수정은 원래 ZIP을 편집기로 불러와 같은 파일명으로 교체합니다.
- 계정 초대/권한 회수는 [GitHub 협업자 설정](https://github.com/jidesign-official/jid/settings/access)에서 저장소 소유자가 처리합니다. 협업자 쓰기 권한은 콘텐츠 전용이 아니라 **저장소 전체 쓰기 권한**입니다.
- 상세한 업로드/실패 복구 안내: [admin-submissions/README.md](admin-submissions/README.md). 기술 형식과 보안 경계: [docs/admin-package-format.md](docs/admin-package-format.md).

`npm run dev`/`npm run build`는 ZIP 검증기를 먼저 실행합니다. 원본 메타데이터를 수정하지 않고 무시된 `.generated/admin-projects.json` 및 `public/_admin_media/`를 생성하여 빌드합니다. 배포 워크플로는 `contents: read`를 유지하고 업로드 커밋 자체를 배포하므로 봇의 후속 커밋이나 별도 쓰기 토큰이 필요 없습니다. 잘못된 패키지는 배포 전에 실패하며 기존 정상 사이트를 유지합니다. 검사만 실행하려면 `npm run test:admin-importer` / `npm run test:admin-pipeline`를 사용하세요.

### 대용량 원본 영상 보관

`public/images/home/intro_all.mp4`는 GitHub 일반 파일의 100MiB 제한을 초과하여 Git 이력 대신 [원본 자산 Release](https://github.com/jidesign-official/jid/releases/tag/source-assets-20261014)에 원본 그대로 보관합니다. 실제 사이트의 히어로 영상은 저장소에 포함된 `public/images/home/intro.webm`을 사용합니다.

```bash
gh release download source-assets-20261014 --repo jidesign-official/jid \
  --pattern intro_all.mp4 --dir public/images/home
```

원본 `intro_all.mp4`의 SHA-256: `f81c879125628bc378eadeedb26add5b4daa4e1e1b291160581a2bba447ed705`.

## 버전 보존 및 롤백

영상 히어로와 웹용 GLB 전환 직전의 배포 버전은 아래 태그로 보존되어 있습니다.

- **태그:** `snapshot/pre-video-hero-20261003`
- **커밋:** `a6b8d518b134dffce5d91d81a89647420e4212f8`
- **내용:** 필로포스 이미지 히어로, 모바일 위·아래 간격 조정, 기존 7개 모델 연결
- 태그는 GitHub 원격에도 저장되어 있습니다. 이 태그를 이동하거나 삭제하지 마세요.

### 이전 버전만 확인하기

현재 작업 폴더를 바꾸지 않고 별도 폴더에서 확인합니다.

```bash
git fetch origin --tags
git worktree add ../jdesign-pre-video snapshot/pre-video-hero-20261003
cd ../jdesign-pre-video
npm ci
NEXT_PUBLIC_BASE_PATH="" npm run build
```

### 사이트 전체를 이전 버전으로 되돌리기

**새 복제본에서 실행**하세요. 기존 작업 폴더의 미커밋 파일이나 업로드한 자산을 덮어쓰지 않고, 과거 이력을 삭제하지 않는 새 롤백 커밋을 만듭니다.

```bash
git clone https://github.com/jidesign-official/jid.git jdesign-rollback
cd jdesign-rollback
git fetch origin --tags
git switch -c rollback/pre-video origin/main
# 소스·자산·테스트를 보존된 버전으로 복원
git restore --source=snapshot/pre-video-hero-20261003 --staged --worktree -- .
# 이 롤백 안내는 현재 README에서 유지
git restore --source=HEAD --staged --worktree -- README.md
git diff --cached --stat
npm ci
NEXT_PUBLIC_BASE_PATH="" npm run build
git commit -m "revert: restore pre-video snapshot"
git push origin HEAD:main
```

`main`에 일반 push하면 GitHub Actions가 GitHub Pages에 재배포합니다. Actions에서 배포 성공을 확인하고 실제 사이트를 확인하세요. 작업 중 원격 `main`이 변경되어 push가 거절되면 **강제 push하지 말고**, 새 복제본에서 최신 `origin/main`을 기준으로 위 절차를 다시 수행하세요. `reset --hard`와 `push --force`는 필요하지 않습니다.

전체 롤백은 영상뿐 아니라 GLB 경로도 태그 당시의 버전으로 돌아갑니다. **히어로만** 되돌리고 새 모델 연결은 유지하려면 새 복제본에서 아래 파일들만 복원한 후, 테스트와 빌드를 확인하고 별도의 커밋으로 배포하세요.

```bash
git restore --source=snapshot/pre-video-hero-20261003 --staged --worktree -- \
  src/components/home/Hero.tsx src/components/home/Hero.module.css \
  tests/e2e/home-hero.spec.ts tests/e2e/home-scroll.spec.ts \
  tests/e2e/home-mobile-spacing.spec.ts
```

히어로만 롤백할 때 사용하지 않게 된 영상/훅 파일은 남아 있어도 화면에는 연결되지 않습니다. 모델 경로와 모델 테스트 파일은 복원하지 마세요. 로컬 보조 백업은 `/mnt/hermes/backups/jdesign-pre-video-20261003/`에 있습니다 (`repository.bundle`, 사용자 미커밋 파일 아카이브 및 해시 목록). 이 경로는 작업 컴퓨터에만 존재하며, 일반적인 롤백에는 GitHub의 태그를 사용하면 됩니다.
