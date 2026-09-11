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
      if (semantic === "navigation" && control instanceof HTMLAnchorElement && new URL(control.href, location.href).pathname === location.pathname) return;
      const sound = semantic ? semanticSounds[semantic] : control.getAttribute("role") === "tab" ? "tab" : control instanceof HTMLButtonElement ? "button" : undefined;
      if (sound) playSound(sound);
    };
    document.addEventListener("click", route, true);
    return () => document.removeEventListener("click", route, true);
  }, []);
  return children;
}
