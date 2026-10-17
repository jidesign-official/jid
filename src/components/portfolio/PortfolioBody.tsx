"use client";

import React, { useEffect, useRef, useState } from "react";
import { getAssetPath } from "@/lib/basePath";
import type { PortfolioContentBlock } from "@/lib/admin/types";
import styles from "./PortfolioBody.module.css";

export default function PortfolioBody({
  blocks,
  projectTitle,
}: {
  blocks: PortfolioContentBlock[];
  projectTitle: string;
}) {
  const images = blocks.flatMap((block) =>
    block.type === "images" ? block.images : [],
  );
  const [selected, setSelected] = useState<number | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const currentImage = selected === null ? undefined : images[selected];
  const isOpen = Boolean(currentImage);

  useEffect(() => {
    if (!isOpen) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener = openerRef.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Native modal supplies an inert background and top-layer stacking.
    dialog.showModal();
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      if (opener?.isConnected) opener.focus();
    };
  }, [isOpen]);

  const move = (delta: number) =>
    setSelected((index) =>
      index === null ? null : (index + delta + images.length) % images.length,
    );

  return (
    <section
      className={styles.body}
      aria-label={`${projectTitle} 프로젝트 내용`}
    >
      {blocks.map((block) => {
        switch (block.type) {
          case "heading": {
            const Heading = block.level === 3 ? "h3" : "h2";
            return (
              <Heading key={block.id} className={styles.heading}>
                {block.text}
              </Heading>
            );
          }
          case "paragraph":
            return (
              <p key={block.id} className={styles.paragraph}>
                {block.text}
              </p>
            );
          case "divider":
            return <hr key={block.id} className={styles.divider} />;
          case "spacer":
            return (
              <div
                key={block.id}
                aria-hidden="true"
                className={styles[block.size]}
              />
            );
          case "images":
            return (
              <div
                key={block.id}
                className={styles.images}
                data-columns={block.columns}
              >
                {block.images.map((image, index) => (
                  <figure
                    key={`${block.id}-${index}`}
                    className={styles.figure}
                  >
                    <button
                      type="button"
                      className={styles.enlarge}
                      aria-label={`${image.alt || projectTitle} 이미지 확대`}
                      aria-haspopup="dialog"
                      onClick={(event) => {
                        openerRef.current = event.currentTarget;
                        setSelected(images.indexOf(image));
                      }}
                    >
                      <img
                        src={getAssetPath(image.src)}
                        width={image.width}
                        height={image.height}
                        alt={image.alt}
                        loading="lazy"
                        decoding="async"
                        className={styles.image}
                      />
                    </button>
                    {image.caption && (
                      <figcaption className={styles.caption}>
                        {image.caption}
                      </figcaption>
                    )}
                  </figure>
                ))}
              </div>
            );
        }
      })}
      <dialog
        ref={dialogRef}
        className={styles.dialog}
        aria-label={`${projectTitle} 이미지 확대`}
        onCancel={(event) => {
          event.preventDefault();
          setSelected(null);
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) setSelected(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Tab") {
            const buttons =
              event.currentTarget.querySelectorAll<HTMLButtonElement>("button");
            const first = buttons[0];
            const last = buttons[buttons.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
          if (event.key === "ArrowRight") {
            event.preventDefault();
            move(1);
          }
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            move(-1);
          }
        }}
      >
        {currentImage && (
          <div className={styles.lightbox}>
            <button
              type="button"
              autoFocus
              className={styles.close}
              aria-label="닫기"
              onClick={() => setSelected(null)}
            >
              ✕
            </button>
            <figure className={styles.expandedFigure}>
              <img
                src={getAssetPath(currentImage.src)}
                alt={currentImage.alt}
                width={currentImage.width}
                height={currentImage.height}
                decoding="async"
                className={styles.expandedImage}
              />
              {currentImage.caption && (
                <figcaption className={styles.caption}>
                  {currentImage.caption}
                </figcaption>
              )}
            </figure>
            {images.length > 1 && (
              <div className={styles.controls}>
                <button
                  type="button"
                  aria-label="이전 이미지"
                  onClick={() => move(-1)}
                >
                  ←
                </button>
                <span aria-live="polite">
                  {(selected ?? 0) + 1} / {images.length}
                </span>
                <button
                  type="button"
                  aria-label="다음 이미지"
                  onClick={() => move(1)}
                >
                  →
                </button>
              </div>
            )}
          </div>
        )}
      </dialog>
    </section>
  );
}
