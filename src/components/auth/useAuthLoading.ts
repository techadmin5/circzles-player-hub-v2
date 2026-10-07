"use client";

import { useEffect, useRef, useState } from "react";
import { AUTH_LOADING_DELAY_MS, AUTH_LOADING_ROTATION_MS } from "./authLoadingSlides";

export function useAuthLoading(slideCount: number) {
  const [visible, setVisible] = useState(false);
  const [slideIndex, setSlideIndex] = useState(0);
  const active = useRef(false);
  const delay = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const rotation = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  function clearTimers() {
    clearTimeout(delay.current);
    clearInterval(rotation.current);
    delay.current = undefined;
    rotation.current = undefined;
  }

  useEffect(() => () => { clearTimers(); active.current = false; }, []);

  function start() {
    // Synchronous guard also protects against two submits before React re-renders.
    if (active.current) return false;
    active.current = true;
    setSlideIndex(0);
    delay.current = setTimeout(() => {
      setVisible(true);
      rotation.current = setInterval(() => setSlideIndex((index) => (index + 1) % Math.max(1, slideCount)), AUTH_LOADING_ROTATION_MS);
    }, AUTH_LOADING_DELAY_MS);
    return true;
  }

  function finish() {
    clearTimers();
    active.current = false;
    setVisible(false);
  }

  return { visible, slideIndex, start, finish };
}
