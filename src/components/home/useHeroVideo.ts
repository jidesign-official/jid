"use client";

import { useEffect, useRef, useState } from "react";

export function useHeroVideo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wantedRef = useRef(false);
  const endedRef = useRef(false);
  const syncRef = useRef<(() => void) | null>(null);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let disposed = false;
    let inView = true;
    let hasError = false;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    endedRef.current = false;
    wantedRef.current = !motion.matches;
    video.muted = true;

    const sync = () => {
      if (disposed) return;
      if (wantedRef.current && !endedRef.current && inView && !document.hidden && !hasError) {
        // Autoplay can be rejected by power-saving/browser policy. Keep the
        // explicit play button usable instead of rejecting an unhandled promise.
        void video.play().catch(() => {
          if (!disposed) setPlaying(!video.paused);
        });
      } else {
        video.pause();
      }
    };
    const playbackChanged = () => { if (!disposed) setPlaying(!video.paused); };
    const ended = () => {
      if (disposed) return;
      // Keep the final frame visible and prevent visibility changes from
      // restarting a non-looping hero video after it has finished.
      endedRef.current = true;
      wantedRef.current = false;
      setPlaying(false);
    };
    const error = () => {
      hasError = true;
      video.pause();
      if (!disposed) { setFailed(true); setPlaying(false); }
    };
    const motionChanged = () => {
      if (!endedRef.current) wantedRef.current = !motion.matches;
      sync();
    };
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      sync();
    });
    observer.observe(video);
    video.addEventListener("play", playbackChanged);
    video.addEventListener("pause", playbackChanged);
    video.addEventListener("ended", ended);
    video.addEventListener("error", error);
    motion.addEventListener("change", motionChanged);
    document.addEventListener("visibilitychange", sync);
    syncRef.current = sync;
    if (video.error) error();
    sync();

    return () => {
      disposed = true;
      syncRef.current = null;
      observer.disconnect();
      video.removeEventListener("play", playbackChanged);
      video.removeEventListener("pause", playbackChanged);
      video.removeEventListener("ended", ended);
      video.removeEventListener("error", error);
      motion.removeEventListener("change", motionChanged);
      document.removeEventListener("visibilitychange", sync);
      video.pause();
    };
  }, []);

  function togglePlayback() {
    const video = videoRef.current;
    if (failed || !video) return;
    if (video.ended) {
      endedRef.current = false;
      video.currentTime = 0;
    }
    wantedRef.current = video.paused;
    syncRef.current?.();
  }

  return { videoRef, playing, failed, togglePlayback };
}
