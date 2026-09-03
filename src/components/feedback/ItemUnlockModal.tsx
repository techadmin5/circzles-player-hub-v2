"use client";

import { GameToast } from "./GameToast";

export function ItemUnlockModal({ label, open }: { label: string; open: boolean }) {
  return <GameToast message={`Unlocked ${label}`} open={open} />;
}
