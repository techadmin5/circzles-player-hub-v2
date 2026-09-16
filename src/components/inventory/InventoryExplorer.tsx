"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Package, RefreshCw } from "lucide-react";
import type { DataMode } from "@/config/dataMode";
import { LoadingState } from "@/components/ui/kit";
import { inventoryService } from "@/services";
import type { InventoryItem } from "@/types";
import { InventoryLocker } from "./InventoryLocker";

export function InventoryExplorer({ mode }: { mode: DataMode }) {
  const [items, setItems] = useState<InventoryItem[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(false); const [attempt, setAttempt] = useState(0);
  useEffect(() => { const controller = new AbortController(); inventoryService.getInventory(controller.signal).then(setItems).catch((cause: unknown) => { if (!(cause instanceof DOMException && cause.name === "AbortError")) setError(true); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); return () => controller.abort(); }, [attempt]);
  if (loading) return <LoadingState rows={4} />;
  if (error) return <div className="cz-surface grid justify-items-center gap-3 p-6 text-center" role="alert"><AlertCircle size={22} className="text-[var(--cz-danger)]" /><p className="text-sm text-[var(--cz-text-secondary)]">Inventory could not be loaded.</p><button className="cz-btn cz-btn-ghost cz-btn-sm" onClick={() => { setLoading(true); setError(false); setAttempt((value) => value + 1); }}><RefreshCw size={14} />Retry</button></div>;
  if (!items.length) return <div className="cz-surface flex items-center justify-center gap-2 p-8 text-sm text-[var(--cz-text-tertiary)]"><Package size={17} />Your Inventory is empty.</div>;
  return <InventoryLocker items={items} mode={mode} onItemsChange={setItems} />;
}
