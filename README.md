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
## 🔗 접속주소 : https://jidesign-official.github.io/jid/

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
NEXT_PUBLIC_BASE_PATH=/jdesign npm run build
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
NEXT_PUBLIC_BASE_PATH=/jdesign npm run build
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
