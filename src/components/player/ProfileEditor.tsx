"use client";
import { useEffect, useRef, useState } from "react";
import { apiClient } from "@/lib/apiClient";
import { useAuth } from "@/components/auth/AuthProvider";
import type { InventoryResponse } from "@/types";

export function ProfileEditor() {
  const { player } = useAuth();
  const [draft, setDraft] = useState<{ displayName?: string; country?: string; state?: string }>({});
  const [cards, setCards] = useState<InventoryResponse["items"]>([]);
  const [card, setCard] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const intent = useRef<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    apiClient.getInventory(controller.signal).then((inventory) => setCards(inventory.items.filter((item) => item.rewardType === "RENAME_CARD" && item.quantity > 0))).catch(() => undefined);
    return () => controller.abort();
  }, [player?.internalId]);
  if (!player) return null;
  const rename = draft.displayName !== undefined && draft.displayName.trim() !== player.displayName;
  return <section className="cz-surface p-5"><h2 className="cz-display text-base font-bold">Profile Settings</h2><p className="mt-2 text-xs text-[var(--cz-text-tertiary)]">Player ID: {player.publicPlayerId}. Changing your display name uses one owned Rename Card.</p>
    <form className="mt-4 grid gap-3" onSubmit={async (event) => {
      event.preventDefault(); if (busy || !Object.keys(draft).length) return;
      setBusy(true); setMessage(""); intent.current ??= crypto.randomUUID();
      try { await apiClient.updateProfile({ ...draft, ...(rename ? { inventoryItemId: card } : {}) }, intent.current); setDraft({}); intent.current = null; setMessage("Profile saved."); await apiClient.getInventory().then((inventory) => setCards(inventory.items.filter((item) => item.rewardType === "RENAME_CARD" && item.quantity > 0))).catch(() => undefined); }
      catch (cause) { setMessage(cause instanceof Error ? cause.message : "Profile could not be saved."); }
      finally { setBusy(false); }
    }}>
      {(["displayName", "country", "state"] as const).map((field) => <label key={field} className="grid gap-1 text-sm"><span>{field === "displayName" ? "Display Name" : field === "country" ? "Country" : "State"}</span><input className="cz-input" value={draft[field] ?? player[field]} maxLength={field === "displayName" ? 32 : 100} disabled={busy} onChange={(event) => { setDraft((current) => ({ ...current, [field]: event.target.value })); intent.current = null; }} /></label>)}
      {rename && <label className="grid gap-1 text-sm">Rename Card<select className="cz-input" value={card} disabled={busy} onChange={(event) => { setCard(event.target.value); intent.current = null; }}><option value="">Select an owned Rename Card</option>{cards.map((item) => <option key={item.inventoryItemId} value={item.inventoryItemId}>{item.name} ({item.quantity})</option>)}</select></label>}
      <button disabled={busy || (rename && !card)} className="cz-btn cz-btn-primary w-fit" type="submit">{busy ? "Saving…" : "Save Changes"}</button>
      {message && <p role="status" className="text-sm text-[var(--cz-text-secondary)]">{message}</p>}
    </form>
  </section>;
}
