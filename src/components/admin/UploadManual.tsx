"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import styles from "./UploadManual.module.css";

const REPOSITORY = "https://github.com/jidesign-official/jid";

export default function UploadManual({ projectId }: { projectId: string }) {
  const id = useId();
  const dialogId = `upload-manual-${id}`;
  const headingId = `${dialogId}-heading`;
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // Match the package ID convention without coercion or unsafe filename truncation.
  // The longest example, _model_01.glb, must also fit the 80-character basename.
  const exampleId =
    typeof projectId === "string" &&
    /^jd[0-9]{3}(?:_[a-z]+)?$/.exec(projectId)?.[0] === projectId &&
    `${projectId}_model_01.glb`.length <= 80
      ? projectId
      : "jd046";

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const trigger = triggerRef.current;
    const bodyOverflow = document.body.style.overflow;
    const rootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    if (!dialog.open) dialog.showModal();
    closeRef.current?.focus();
    return () => {
      if (dialog.open) dialog.close();
      document.body.style.overflow = bodyOverflow;
      document.documentElement.style.overflow = rootOverflow;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [open]);

  const close = () => setOpen(false);
  const trapFocus = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== "Tab") return;
    const targets = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      ),
    );
    const first = targets[0],
      last = targets.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={dialogId}
        onClick={() => setOpen(true)}
      >
        업로드 매뉴얼
      </button>
      <dialog
        ref={dialogRef}
        id={dialogId}
        className={styles.dialog}
        aria-labelledby={headingId}
        aria-modal="true"
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        onClose={() => setOpen(false)}
        onKeyDown={trapFocus}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          const rect = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            close();
        }}
      >
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>준비부터 게시 확인까지</p>
            <h2 id={headingId}>업로드 매뉴얼</h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            className={styles.close}
            aria-label="업로드 매뉴얼 닫기"
            onClick={close}
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <div className={styles.content} data-upload-manual-content>
          <p className={styles.notice}>
            여기는 누구나 열 수 있는 공개 편집기입니다. 편집·초안 저장만으로
            사이트에 게시되지 않습니다. 실제 게시 권한과 로그인은 GitHub에서
            확인합니다.
          </p>
          <ol className={styles.steps}>
            <li>
              <h3>이미지를 먼저 준비하세요</h3>
              <p>
                자르기와 비율 조정은 편집기 밖에서 먼저 끝내 주세요. 편집기는
                업로드한 이미지의 비율을 유지하며, 자르기 도구는 제공하지
                않습니다.
              </p>
              <p>
                이미지는 PNG, JPG/JPEG, WebP를 지원합니다. 프로젝트 ID와
                제목·분류를 입력한 뒤 파일을 올려 주세요.
              </p>
            </li>
            <li>
              <h3>대표·본문·3D 파일을 구분하세요</h3>
              <ul>
                <li>
                  <strong>대표 이미지:</strong> 목록과 프로젝트 첫 화면에 쓰는
                  썸네일입니다. 반드시 한 장을 지정해 주세요.
                </li>
                <li>
                  <strong>본문 이미지:</strong> 상세 페이지를 설명하는
                  사진입니다. 이미지 블록에 원하는 순서로 넣어 주세요.
                </li>
                <li>
                  <strong>GLB:</strong> 선택 사항인 3D 모델입니다. 모델 업로드
                  영역에 넣고 표시 순서를 확인해 주세요.
                </li>
              </ul>
            </li>
            <li>
              <h3>ZIP 안의 파일명은 자동으로 정리됩니다</h3>
              <p>
                지금 프로젝트 ID 기준 예시입니다. 직접 파일 이름을 바꿀 필요가
                없습니다. 아래 이름은 내보내는 ZIP 내부의 <code>assets/</code>{" "}
                폴더에만 적용됩니다.
              </p>
              <dl className={styles.examples}>
                <div>
                  <dt>대표 이미지</dt>
                  <dd>
                    <code>{exampleId}_thumbs.webp</code>
                  </dd>
                </div>
                <div>
                  <dt>첫 본문 이미지</dt>
                  <dd>
                    <code>{exampleId}_body_01.jpg</code>
                  </dd>
                </div>
                <div>
                  <dt>다음 본문 이미지</dt>
                  <dd>
                    <code>{exampleId}_body_02.png</code>
                  </dd>
                </div>
                <div>
                  <dt>첫·다음 3D 모델</dt>
                  <dd>
                    <code>{exampleId}_model_01.glb</code>
                    <br />
                    <code>{exampleId}_model_02.glb</code>
                  </dd>
                </div>
              </dl>
              <p>
                이미지 확장자는 실제 업로드 파일의 png, jpg, jpeg, webp 중
                하나로 유지됩니다. 위 예시는 파일 형식을 바꾸라는 뜻이 아닙니다.
              </p>
              <p>
                <strong>컴퓨터에 있는 원본 파일 이름은 바뀌지 않습니다.</strong>{" "}
                원본 이름도 편집 데이터에 보관합니다. 이미지와 GLB를
                재인코딩하거나 바이너리 내용을 바꾸지 않습니다.
              </p>
              <p>
                본문 번호는 블록 순서 → 블록 안의 이미지 표시 순서로 정해집니다.
                순서를 바꾸면 다음 ZIP 내보내기 때 번호도 바뀝니다. 모바일에서는
                같은 순서로 1열 표시됩니다.
              </p>
              <p className={styles.footnote}>
                같은 파일을 여러 위치에서 재사용하면 첫 번째 파일명을 함께 쓰고
                ZIP에 중복 저장하지 않습니다. 대표 이미지를 본문에서도 쓰면
                thumbs 이름을 그대로 재사용하며, 본문 번호를 따로 차지하지
                않습니다.
              </p>
            </li>
            <li>
              <h3>블록으로 본문을 구성하세요</h3>
              <p>
                제목·문단·이미지·여백·구분선 블록을 추가할 수 있습니다. 이미지
                블록은 1~4열, 블록당 최대 12장입니다. 좁은 모바일 화면에서는
                1열로 쌓입니다.
              </p>
              <p>
                블록과 이미지의 위로·아래로 버튼으로 순서를 조정하세요. 각
                이미지의 대체 텍스트에는 사진 내용을, 캡션에는 화면에 보일
                설명을 적고 미리보기로 확인해 주세요.
              </p>
            </li>
            <li>
              <h3>초안을 저장하고 ZIP을 내보내세요</h3>
              <p>
                브라우저의 초안 저장은 이 기기·브라우저에만 남는 로컬 저장이며
                게시가 아닙니다. 브라우저 데이터 삭제나 다른 기기로 이동하기
                전에 ZIP을 따로 보관해 주세요.
              </p>
              <p>
                미리보기를 확인한 다음 ZIP 내보내기를 누르세요. 완성된 ZIP은 25
                MiB 이하여야 하며, 압축을 풀었을 때의 전체 용량도 별도로
                검사합니다. 원본 바이트를 그대로 담으므로 용량 초과 시 편집기
                밖에서 파일을 줄여 다시 올려 주세요.
              </p>
              <p>
                오류가 있으면 내보내기가 막힙니다. GLB는 외부 텍스처·리소스를
                참조하지 않는 자체 포함 파일이어야 합니다. 외부 리소스나
                지원하지 않는 Draco·Meshopt·BasisU 디코더 또는 GPU 인스턴싱
                확장이 필요한 모델은 원본 제작 도구에서 호환되는 GLB로 다시
                준비해 주세요. 새 업로드는 기본 삼각형(TRIANGLES)의 애니메이션
                없는 정적 제품 모델만 지원합니다. Strip/Fan·선·점 배치 방식은
                지원하지 않으며 자동 변환하지 않습니다. GLB 하나당
                메시·노드·장면의 반복 참조를 합산한 처리량은 64MiB 이하여야
                합니다. 파일 크기와 다른 보수적인 검증 기준이며 실제 GPU 메모리
                용량을 뜻하지 않습니다. 복잡하거나 반복이 많은 모델은 제작
                도구에서 단순화해 다시 준비해 주세요. 키프레임
                애니메이션·스켈레톤 변형·모프 타깃은 제외해 주세요. 뷰어의
                회전·확대 기능은 그대로 사용할 수 있습니다. 기존 프로젝트의 원본
                GLB와 동작은 변경하지 않습니다.
              </p>
              <p>
                파일 내부 바이너리 영역 선언과 각 이미지 항목의 인코딩된 원본
                복사량도 합산해 GLB당 별도의 64MiB 한도로 제한합니다. 서로
                겹치는 영역이나 같은 이미지를 반복 선언한 경우도 각각
                계산합니다. 이 한도 역시 실제 메모리 상한이 아닌 보수적인 복사
                작업량 기준이며, 원본 파일을 잘라내거나 변환하지 않습니다. 제작
                도구의 부가정보(메타데이터)도 모델·텍스처를 복제할 때 함께 커질
                수 있어 복제 작업량을 별도로 64MiB로 제한합니다. 정보를 지우거나
                파일을 자동 변환하는 대신, 한도를 넘으면 복잡한 부가정보나 반복
                참조를 줄여 다시 준비해 주세요. 같은 이미지와 샘플러를 쓰는
                텍스처 정의도 반복되면 각각 계산합니다. 같은 이미지를 공유해도
                샘플러 설정에 따라 별도 텍스처가 만들어질 수 있어 텍스처 참조
                처리량도 따로 제한합니다. 한도를 넘으면 텍스처 크기나 반복
                설정을 줄여 다시 준비해 주세요. 초안 불러오기도 현재 GLB 검증
                규칙을 적용합니다. 지원하지 않는 모델이 있으면 복원하지 않지만,
                저장된 초안 기록과 원본 데이터는 자동 삭제하거나 변환하지
                않습니다.
              </p>
            </li>
            <li>
              <h3>GitHub에서 업로드하고 결과를 확인하세요</h3>
              <p>
                GitHub에 로그인한 다음 아래 업로드 링크에서 저장소의{" "}
                <code>main</code> 브랜치, <code>admin-submissions</code> 폴더에
                내려받은 <code>{exampleId}.zip</code> 파일을 올리세요. ZIP을
                풀거나 내부 파일을 편집할 필요는 없습니다. GitHub에서 변경
                사항을 커밋해야 게시 작업이 시작됩니다.
              </p>
              <p>
                권한이 없다면 저장소 소유자에게 GitHub 초대를 요청하고 초대를
                수락하세요. 쓰기 권한은 콘텐츠만이 아니라 소스 코드를 포함한
                저장소 전체에 적용됩니다. 이 편집기에서 GitHub 비밀번호나 토큰을
                입력하지 마세요.
              </p>
              <p>
                Actions에서 검증·빌드·배포 결과를 확인한 뒤 실제 사이트를
                확인하세요. 검증이 실패하면 오류를 수정해 ZIP을 다시
                업로드하세요. 실패한 ZIP은 새 게시로 반영되지 않습니다.
              </p>
              <p>
                기존 69개 프로젝트의 이미지·본문 원본은 이 편집기에서 읽기 전용입니다. 이 CMS로
                만든 프로젝트는 보관한 같은 ZIP을 가져와 수정하고, 같은 프로젝트
                ID·ZIP 이름으로 다시 내보내 업로드하면 업데이트됩니다. 같은 ZIP
                파일을 교체하는 방식입니다.
              </p>
              <p>
                전체 순서·게시 제외/복원·메인 대표 4개 선택은 프로젝트 목록에서
                관리합니다. 설정 JSON 내보내기의 <code>portfolio-settings.json</code>은
                프로젝트 ZIP과 다른 파일입니다. <strong>admin-submissions 폴더가
                아니라 저장소 루트에 업로드하고 커밋</strong>하세요. 현재 메인 4개는
                처음부터 선택되어 있으며, 메인에 고른 작품을 게시 제외하면 다른
                작품으로 교체해야 합니다. 게시 제외는 원본 파일을 삭제하거나
                직접 파일 주소까지 비공개로 만드는 기능이 아닙니다.
              </p>
              <div className={styles.links}>
                <a
                  href={`${REPOSITORY}/upload/main/admin-submissions`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  GitHub에서 ZIP 업로드
                  <span className={styles.linkHint}> · 새 탭</span>
                </a>
                <a
                  href={`${REPOSITORY}/actions`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Actions 게시 결과 확인
                  <span className={styles.linkHint}> · 새 탭</span>
                </a>
              </div>
            </li>
          </ol>
        </div>
      </dialog>
    </>
  );
}
