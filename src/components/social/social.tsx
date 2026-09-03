"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Check, MessageCircle, UserMinus, UserPlus, X } from "lucide-react";
import type { FriendRequest, Notification, Player } from "@/types";
import { AvatarFrame, RankChip } from "@/components/player/AvatarFrame";
import { Chip } from "@/components/ui/kit";
import { friendService, notificationService } from "@/services";
import { playSound } from "@/hooks/useSound";
import { relativeDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export function FriendCard({ player, since }: { player: Player; since?: string }) {
  const online = Number(player.publicPlayerId.charCodeAt(3)) % 2 === 0;
  void since;
  return (
    <div className="cz-surface flex items-center gap-3 p-4" data-testid={`friend-${player.publicPlayerId}`}>
      <AvatarFrame avatar={player.avatar} displayName={player.displayName} frame={player.equippedFrame} size={56} placement={null} />
      <div className="min-w-0 flex-1">
        <Link href={`/profile/${player.publicPlayerId}`} className="cz-display block truncate text-sm font-bold hover:text-[var(--cz-aqua)]">{player.displayName}</Link>
        <p className="truncate text-xs text-[var(--cz-text-tertiary)]">{player.publicPlayerId}</p>
        <div className="mt-1.5 flex items-center gap-2">
          <RankChip rank={player.rank} level={player.progressionLevel} />
          <span className={cn("inline-flex items-center gap-1 text-[0.62rem]", online ? "text-[var(--cz-emerald)]" : "text-[var(--cz-text-tertiary)]")}>
            <span className={cn("h-1.5 w-1.5 rounded-full", online ? "bg-[var(--cz-emerald)]" : "bg-[var(--cz-text-tertiary)]")} />{online ? "Online" : "Offline"}
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <button className="cz-btn cz-btn-ghost cz-btn-sm" onClick={() => playSound("button")} aria-label="Message"><MessageCircle size={14} /></button>
      </div>
    </div>
  );
}

export function SearchResultCard({ player }: { player: Player }) {
  const [sent, setSent] = useState(false);
  async function add() {
    playSound("friendRequest");
    await friendService.sendRequest(player.publicPlayerId);
    setSent(true);
    playSound("success");
  }
  return (
    <div className="cz-surface flex items-center gap-3 p-4" data-testid={`search-${player.publicPlayerId}`}>
      <AvatarFrame avatar={player.avatar} displayName={player.displayName} frame={player.equippedFrame} size={52} placement={null} />
      <div className="min-w-0 flex-1">
        <p className="cz-display truncate text-sm font-bold">{player.displayName}</p>
        <p className="truncate text-xs text-[var(--cz-text-tertiary)]">{player.publicPlayerId}</p>
      </div>
      <button className={cn("cz-btn cz-btn-sm", sent ? "cz-btn-ghost" : "cz-btn-primary")} onClick={add} disabled={sent} data-testid={`add-${player.publicPlayerId}`}>
        {sent ? <><Check size={14} />Sent</> : <><UserPlus size={14} />Add</>}
      </button>
    </div>
  );
}

export function RequestCard({ request }: { request: FriendRequest }) {
  const [resolved, setResolved] = useState<null | "accepted" | "declined">(null);
  const p = request.player;
  return (
    <motion.div layout className="cz-surface flex items-center gap-3 p-4" data-testid={`request-${request.id}`}>
      <AvatarFrame avatar={p.avatar} displayName={p.displayName} frame={p.equippedFrame} size={52} placement={null} />
      <div className="min-w-0 flex-1">
        <p className="cz-display truncate text-sm font-bold">{p.displayName}</p>
        <p className="truncate text-xs text-[var(--cz-text-tertiary)]">{p.publicPlayerId} · {request.direction === "INCOMING" ? "Wants to connect" : "Request sent"}</p>
      </div>
      {resolved
        ? <Chip tone={resolved === "accepted" ? "emerald" : "default"}>{resolved}</Chip>
        : request.direction === "INCOMING"
          ? <div className="flex gap-1.5">
              <button className="cz-btn cz-btn-primary cz-btn-sm" onClick={() => { playSound("success"); setResolved("accepted"); }} data-testid={`accept-${request.id}`}><Check size={14} />Accept</button>
              <button className="cz-btn cz-btn-ghost cz-btn-sm" onClick={() => { playSound("button"); setResolved("declined"); }} aria-label="Decline"><X size={14} /></button>
            </div>
          : <button className="cz-btn cz-btn-ghost cz-btn-sm" onClick={() => { playSound("button"); setResolved("declined"); }}><UserMinus size={14} />Cancel</button>}
    </motion.div>
  );
}

export function NotificationList({ items }: { items: Notification[] }) {
  const [list, setList] = useState(items);
  function markAll() {
    playSound("button");
    notificationService.markAllRead();
    setList((prev) => prev.map((n) => ({ ...n, read: true })));
  }
  const unread = list.filter((n) => !n.read).length;
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--cz-text-secondary)]">{unread > 0 ? `${unread} unread` : "All caught up"}</p>
        <button className="cz-btn cz-btn-ghost cz-btn-sm" onClick={markAll} data-testid="mark-all-read">Mark all read</button>
      </div>
      <div className="grid gap-2">
        {list.map((n) => (
          <div key={n.id} data-testid={`notification-${n.id}`} className={cn("cz-surface flex items-start gap-3 p-4", !n.read && "cz-ring-aqua")}>
            <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.read ? "bg-[var(--cz-text-tertiary)]" : "bg-[var(--cz-aqua)]")} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="cz-display text-sm font-semibold">{n.title}</p>
                <span className="shrink-0 text-xs text-[var(--cz-text-tertiary)]">{relativeDate(n.createdAt)}</span>
              </div>
              <p className="text-xs text-[var(--cz-text-secondary)]">{n.body}</p>
              <p className="mt-1 text-[0.62rem] uppercase tracking-wide text-[var(--cz-text-tertiary)]">{n.type}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
