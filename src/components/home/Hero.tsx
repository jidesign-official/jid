"use client";

import Image from "next/image";
import { getAssetPath } from "@/lib/basePath";
import { useHeroVideo } from "./useHeroVideo";
import styles from "./Hero.module.css";

export default function Hero() {
  const { videoRef, playing, failed, togglePlayback } = useHeroVideo();

  return (
    <section aria-label="JiD 소개 영상" className={styles.hero}>
      <video
        ref={videoRef}
        className={styles.video}
        hidden={failed}
        src={getAssetPath("/images/home/jiD.mp4")}
        poster={getAssetPath("/images/home/jiD-fallback.png")}
        muted
        playsInline
        preload="metadata"
        aria-hidden="true"
        tabIndex={-1}
      >
        브라우저가 소개 영상 재생을 지원하지 않습니다.
      </video>
      {failed && (
        <Image
          src={getAssetPath("/images/home/jiD-fallback.png")}
          alt=""
          aria-hidden="true"
          fill
          sizes="100vw"
          className={styles.video}
          loading="eager"
        />
      )}
      <div className={styles.shade} aria-hidden="true" />
      <div className={styles.overlay}>
        <div className={styles.content}>
          {failed && <p role="status" className={styles.fallback}>영상을 재생할 수 없어 미리보기 이미지를 표시합니다.</p>}
        </div>
        <button
          type="button"
          className={styles.control}
          onClick={togglePlayback}
          disabled={failed}
          aria-label={playing ? "영상 일시 정지" : "영상 재생"}
          title={playing ? "영상 일시 정지" : "영상 재생"}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
            {playing ? (
              <path d="M7 5h3v14H7zM14 5h3v14h-3z" />
            ) : (
              <path d="M8 5v14l11-7z" />
            )}
          </svg>
        </button>
      </div>
    </section>
  );
}
