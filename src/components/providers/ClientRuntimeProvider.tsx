"use client";

import { useEffect, type ReactNode } from "react";
import { armBackgroundMusic, hydrateAudioPreferences } from "@/hooks/useSound";

export function ClientRuntimeProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    hydrateAudioPreferences();
    return armBackgroundMusic();
  }, []);
  return children;
}
