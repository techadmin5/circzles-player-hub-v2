"use client";

import { useEffect, type ReactNode } from "react";
import { playSound } from "@/hooks/useSound";
import type { SoundEvent } from "@/config/sounds";

const semanticSounds: Record<string, SoundEvent> = { button: "button", navigation: "navigation", tab: "tab", "modal-open": "modalOpen", "modal-close": "modalClose" };

export function InteractionSoundProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const route = (event: MouseEvent) => {
      if (!event.isTrusted || event.defaultPrevented || event.button !== 0) return;
      const control = (event.target as Element | null)?.closest<HTMLElement>("button, a, [role='button'], [role='tab']");
      if (!control || control.matches(":disabled, [aria-disabled='true']")) return;
      const semantic = control.dataset.sound;
      if (semantic === "silent" || semantic === "manual") return;
      const linkUrl = control instanceof HTMLAnchorElement ? new URL(control.href, location.href) : undefined;
      if (linkUrl?.origin === location.origin && linkUrl.pathname === location.pathname && linkUrl.search === location.search) return;
      const closesDialog = /^close\b/i.test(control.getAttribute("aria-label") ?? "");
      const sound = semantic
        ? semanticSounds[semantic]
        : closesDialog
          ? "modalClose"
        : control.getAttribute("role") === "tab"
          ? "tab"
          : control instanceof HTMLButtonElement
            ? "button"
            : linkUrl?.origin === location.origin
              ? "navigation"
              : undefined;
      if (sound) playSound(sound);
    };
    document.addEventListener("click", route, true);
    return () => document.removeEventListener("click", route, true);
  }, []);
  return children;
}
