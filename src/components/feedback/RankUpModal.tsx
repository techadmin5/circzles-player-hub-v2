"use client";

import { ProgressionModal } from "@/components/progression/ProgressionModal";

export function RankUpModal({ open, onClose, progressionLevel }: { open: boolean; onClose: () => void; progressionLevel: number }) {
  return <ProgressionModal open={open} onClose={onClose} progressionLevel={progressionLevel} />;
}
