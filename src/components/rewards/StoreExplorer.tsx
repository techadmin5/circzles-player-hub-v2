"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Package, RefreshCw } from "lucide-react";
import { LoadingState } from "@/components/ui/kit";
import type { DataMode } from "@/config/dataMode";
import { storeService } from "@/services";
import type { StoreItem } from "@/types";
import { StoreBoard } from "./store";
import { useGameFeedback } from "@/components/feedback/GameFeedbackProvider";
import { usePlayerUiState } from "@/stores/playerUiState";
import { ApiClientError } from "@/lib/apiClient";

export function StoreExplorer({ mode }: { mode: DataMode }) {
  const [items, setItems] = useState<StoreItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const keys = useRef(new Map<string, string>());
  const { showErrorFeedback } = useGameFeedback();

  useEffect(() => {
    const controller = new AbortController();
    storeService.getItems(controller.signal).then(setItems).catch((cause: unknown) => {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) setError(true);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [attempt]);

  if (loading) return <LoadingState rows={4} />;
  if (error) return <div className="cz-surface grid justify-items-center gap-3 p-6 text-center" role="alert"><AlertCircle size={22} className="text-[var(--cz-danger)]" /><p className="text-sm text-[var(--cz-text-secondary)]">The reward catalog could not be loaded.</p><button type="button" className="cz-btn cz-btn-ghost cz-btn-sm" onClick={() => { setLoading(true); setError(false); setAttempt((value) => value + 1); }}><RefreshCw size={14} />Retry</button></div>;
  if (items.length === 0) return <div className="cz-surface flex items-center justify-center gap-2 p-8 text-sm text-[var(--cz-text-tertiary)]"><Package size={17} />No rewards are available right now.</div>;
  const purchase = async (item: StoreItem) => {
    const key = keys.current.get(item.id) ?? crypto.randomUUID(); keys.current.set(item.id, key);
    try {
      const result = await storeService.purchaseItem(item.id, key);
      keys.current.delete(item.id);
      if ("balanceAfter" in result) { usePlayerUiState.getState().setSynapsePoints(result.balanceAfter); window.setTimeout(() => usePlayerUiState.getState().setBalancePulse(false), 900); }
      setAttempt((value) => value + 1);
      return true;
    } catch (cause) {
      if (cause instanceof ApiClientError && cause.status > 0 && cause.status < 500) keys.current.delete(item.id);
      const message = cause instanceof ApiClientError && cause.code === "INSUFFICIENT_POINTS" ? "Not enough Synapse Points." : cause instanceof ApiClientError && cause.code === "ITEM_ALREADY_OWNED" ? "This reward is already owned." : cause instanceof ApiClientError && cause.code === "PURCHASE_LIMIT_REACHED" ? "Purchase limit reached." : "Purchase could not be completed.";
      showErrorFeedback(message); return false;
    }
  };
  return <StoreBoard items={items} purchaseEnabled onPurchase={mode === "api" ? purchase : undefined} />;
}
