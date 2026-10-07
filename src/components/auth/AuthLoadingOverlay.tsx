"use client";

import Image from "next/image";
import { useEffect, useId, useRef, useState } from "react";
import type { AuthLoadingSlide } from "./authLoadingSlides";

function LoadingVisual({ media }: { media?: AuthLoadingSlide["media"] }) {
  const [failed, setFailed] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(true);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(preference.matches);
    update(); preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);
  return <div className="cz-auth-loading-visual">
    <div aria-hidden="true" className="cz-auth-loading-orbit"><span>CZ</span></div>
    {!failed && media?.type === "image" && <Image className="object-cover" src={media.src} alt={media.alt} fill sizes="(max-width: 640px) 85vw, 420px" onError={() => setFailed(true)} />}
    {!failed && media?.type === "video" && !reducedMotion && <video className="absolute inset-0 h-full w-full object-cover" src={media.src} poster={media.poster} autoPlay muted loop playsInline preload="none" aria-hidden="true" onError={() => setFailed(true)} />}
  </div>;
}

export function AuthLoadingOverlay({ slide }: { slide: AuthLoadingSlide }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const dialog = dialogRef.current!;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    dialog.focus();
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);

  return <dialog ref={dialogRef} tabIndex={-1} aria-labelledby={titleId} aria-describedby={descriptionId} aria-modal="true" className="cz-auth-loading-dialog" onCancel={(event) => event.preventDefault()}>
    <div className="cz-auth-loading-card">
      <p className="cz-display text-sm font-bold tracking-[0.2em] text-[var(--cz-aqua)]">CircZles <span className="font-normal tracking-normal text-[var(--cz-text-secondary)]">Player Hub</span></p>
      <LoadingVisual key={`visual-${slide.id}`} media={slide.media} />
      <div key={`copy-${slide.id}`} className="cz-fade-up min-h-28" role="status" aria-live="polite" aria-atomic="true">
        {slide.label && <p className="mb-2 text-xs uppercase tracking-widest text-[var(--cz-aqua)]">{slide.label}</p>}
        <h2 id={titleId} className="cz-display text-2xl font-bold sm:text-3xl">{slide.title}</h2>
        <p id={descriptionId} className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-[var(--cz-text-secondary)]">{slide.description}</p>
      </div>
      <p className="text-xs leading-relaxed text-[var(--cz-text-secondary)]">First visits can take a little longer. Keep this page open.</p>
    </div>
  </dialog>;
}
