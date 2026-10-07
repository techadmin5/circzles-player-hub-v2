"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { hubMedia, type HubMediaConfig } from "@/config/hubMedia";

export function HubAtmosphere({ media = hubMedia }: { media?: HubMediaConfig }) {
  const [reducedMotion, setReducedMotion] = useState(true);
  const [videoFailed, setVideoFailed] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(preference.matches);
    update(); preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);

  return <div className="cz-hub-atmosphere" aria-hidden="true" data-testid="hub-atmosphere">
    {media.posterSrc && !posterFailed && <Image src={media.posterSrc} alt="" fill sizes="100vw" className="object-cover" onError={() => setPosterFailed(true)} />}
    {media.videoSrc && !reducedMotion && !videoFailed && <video
      className="absolute inset-0 h-full w-full object-cover" src={media.videoSrc} poster={media.posterSrc ?? undefined}
      autoPlay muted loop playsInline preload="none" aria-hidden="true" tabIndex={-1}
      onError={() => setVideoFailed(true)}
      onLoadedData={(event) => { void event.currentTarget.play().catch(() => setVideoFailed(true)); }}
    />}
    <div className="cz-hub-readability" />
    <div className="cz-hub-ambient" />
  </div>;
}
