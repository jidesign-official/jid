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
