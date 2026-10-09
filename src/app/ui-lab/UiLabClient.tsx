"use client";

import Image from "next/image";
import type { ReactNode } from "react";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Award, Camera, ChevronRight, Crown, Flame, Gem, Home, Lock, Medal, Package, Puzzle, Settings, Shield, Sparkles, Target, Trophy, Upload, User, Volume2, X } from "lucide-react";
import type { LeaderboardEntry, PlayerProfile, PlayerPuzzle, RankName } from "@/types";
import { progressionRanks } from "@/config/progression";
import { cn } from "@/lib/utils";
import styles from "./ui-lab.module.css";

type ViewKey = "hub" | "profile" | "leaderboard";
type RankState = "completed" | "current" | "locked";
type Placement = 1 | 2 | 3 | null;

interface UiLabClientProps {
  player: PlayerProfile;
  puzzles: PlayerPuzzle[];
  leaderboard: LeaderboardEntry[];
}

const UI_LAB_ONLY_PROFILE_PLACEMENT: Placement = 2;

const UI_LAB_ONLY_AVATARS = [
  { id: "aqua-circuit", label: "Aqua Circuit", src: "/ui-lab/avatars/aqua-circuit.svg", group: "CircZles Avatars" },
  { id: "solar-solver", label: "Solar Solver", src: "/ui-lab/avatars/solar-solver.svg", group: "CircZles Avatars" },
  { id: "violet-node", label: "Violet Node", src: "/ui-lab/avatars/violet-node.svg", group: "CircZles Avatars" },
  { id: "silver-focus", label: "Silver Focus", src: "/ui-lab/avatars/silver-focus.svg", group: "Unlocked" },
  { id: "champion-mark", label: "Champion Mark", src: "/ui-lab/avatars/champion-mark.svg", group: "Unlocked" },
] as const;

const UI_LAB_ONLY_BADGES = [
  { id: "first-solve", name: "First Solve", rarity: "common", icon: "/ui-lab/claude/badges/first-solve.svg" },
  { id: "top-10", name: "Top 10", rarity: "rare", icon: "/ui-lab/claude/badges/top-10.svg" },
  { id: "streak-keeper", name: "Streak Keeper", rarity: "epic", icon: "/ui-lab/claude/badges/streak-keeper.svg" },
  { id: "hidden-gem", name: "Hidden Gem", rarity: "legendary", icon: "/ui-lab/claude/badges/hidden-gem.svg" },
] as const;

const frameAssets = {
  none: undefined,
  "Neon Circuit": "/ui-lab/claude/frames/circuit-cyan.svg",
  "Competitor Silver": "/ui-lab/claude/frames/competitor-silver.svg",
  "Champion Gold": "/ui-lab/claude/frames/champion-gold.svg",
} as const;

const navItems = [
  { key: "hub", label: "Hub", icon: Home },
  { key: "profile", label: "Profile", icon: User },
  { key: "leaderboard", label: "Leaderboard", icon: Trophy },
] as const;

export function UiLabClient({ player, puzzles, leaderboard }: UiLabClientProps) {
  const [view, setView] = useState<ViewKey>("hub");
  const [progressionOpen, setProgressionOpen] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [previewAvatar, setPreviewAvatar] = useState(player.avatar);

  const previewPlayer = { ...player, avatar: previewAvatar };

  return <div className={styles.lab}>
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className="mb-6 flex items-center gap-2 px-2">
          <div className="h-7 w-7 rounded-full bg-gradient-to-br from-[var(--cz-aqua)] to-[#1a8a7c]" />
          <span className={cn(styles.display, "text-sm font-bold")}>CircZles UI Lab</span>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {navItems.map((item) => <LabNavButton key={item.key} label={item.label} active={view === item.key} icon={<item.icon size={18} />} onClick={() => setView(item.key)} />)}
        </nav>
        <div className="flex items-center justify-around border-t border-[var(--cz-hairline)] px-1 pt-3 text-[var(--cz-text-tertiary)]">
          <button aria-label="Visual sound control only" className="rounded-md p-2 hover:bg-white/[0.03] hover:text-[var(--cz-text-primary)]"><Volume2 size={16} /></button>
          <button aria-label="Lab settings placeholder" className="rounded-md p-2 hover:bg-white/[0.03] hover:text-[var(--cz-text-primary)]"><Settings size={16} /></button>
        </div>
      </aside>
      <main className={styles.main}>
        <div className={cn(styles.labControls, "mb-5 flex flex-wrap items-center justify-between gap-3")}>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.18em] text-[var(--cz-aqua)]">Controlled comparison route</p>
            <h1 className={cn(styles.display, "text-3xl font-bold sm:text-4xl")}>Approved Visual Direction Refinement</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            {navItems.map((item) => <button key={item.key} onClick={() => setView(item.key)} className={cn("rounded-lg border px-3 py-2 text-sm transition-colors", view === item.key ? "border-[var(--cz-aqua)] bg-[var(--cz-aqua-dim)] text-[var(--cz-text-primary)]" : "border-[var(--cz-hairline)] bg-white/[0.03] text-[var(--cz-text-secondary)]")}>{item.label}</button>)}
            <button onClick={() => setProgressionOpen(true)} className="rounded-lg border border-[var(--cz-gold)]/50 bg-[var(--cz-gold-dim)] px-3 py-2 text-sm text-[var(--cz-text-primary)]">Open Progression</button>
          </div>
        </div>
        {view === "hub" && <HubPreview player={previewPlayer} puzzles={puzzles} onOpenProgression={() => setProgressionOpen(true)} onEditAvatar={() => setAvatarOpen(true)} />}
        {view === "profile" && <ProfilePreview player={previewPlayer} puzzles={puzzles} onOpenProgression={() => setProgressionOpen(true)} onEditAvatar={() => setAvatarOpen(true)} />}
        {view === "leaderboard" && <LeaderboardPreview entries={leaderboard} highlightPlayerId={player.publicPlayerId} />}
      </main>
    </div>
    <nav className={styles.mobileNav}>
      {navItems.map((item) => <button key={item.key} onClick={() => setView(item.key)} className={cn("grid place-items-center gap-1 rounded-lg px-2 py-2 text-xs", view === item.key ? "bg-[var(--cz-aqua-dim)] text-[var(--cz-aqua)]" : "text-[var(--cz-text-tertiary)]")}><item.icon size={18} />{item.label}</button>)}
      <button onClick={() => setProgressionOpen(true)} className="grid place-items-center gap-1 rounded-lg px-2 py-2 text-xs text-[var(--cz-gold)]"><Award size={18} />Ranks</button>
    </nav>
    <ProgressionCodex open={progressionOpen} onClose={() => setProgressionOpen(false)} player={previewPlayer} />
    <AvatarPicker open={avatarOpen} currentAvatar={previewAvatar} onPreview={setPreviewAvatar} onClose={() => setAvatarOpen(false)} />
  </div>;
}

function HubPreview({ player, puzzles, onOpenProgression, onEditAvatar }: { player: PlayerProfile; puzzles: PlayerPuzzle[]; onOpenProgression: () => void; onEditAvatar: () => void }) {
  const activeMission = { title: "Verified speed solve", body: "Submit one approved attempt before the daily window closes.", reward: "700 SP", progress: 38 };
  const latest = puzzles[1] ?? puzzles[0];
  return <div className="grid gap-6">
    <PlayerLobby player={player} onOpenProgression={onOpenProgression} onEditAvatar={onEditAvatar} />
    <section className="grid gap-4 lg:grid-cols-[1.1fr_.9fr]">
      <div className={cn(styles.surface, styles.grain, "grid gap-5 p-5")}>
        <div className="flex flex-wrap gap-3">
          <ActionButton icon={<Puzzle size={17} />} label="Add CircZles" />
          <ActionButton icon={<Camera size={17} />} label="Submit Attempt" />
          <ActionButton icon={<Trophy size={17} />} label="View Leaderboard" />
        </div>
        <div className="grid gap-4 md:grid-cols-[1fr_220px]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.16em] text-[var(--cz-aqua)]">Active challenge</p>
            <h2 className={cn(styles.display, "mt-1 text-3xl font-bold")}>{activeMission.title}</h2>
            <p className="mt-2 text-sm text-[var(--cz-text-secondary)]">{activeMission.body}</p>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-[var(--cz-inset)]"><div className="h-full rounded-full bg-gradient-to-r from-[var(--cz-aqua)] to-[var(--cz-gold)]" style={{ width: `${activeMission.progress}%` }} /></div>
          </div>
          <div className={cn(styles.raised, "grid place-items-center p-4 text-center")}>
            <Gem className="h-8 w-8 text-[var(--cz-gold)]" />
            <p className={cn(styles.display, "mt-2 text-2xl font-bold")}>{activeMission.reward}</p>
            <p className="text-xs text-[var(--cz-text-tertiary)]">Claim after verified completion</p>
          </div>
        </div>
      </div>
      <div className="grid gap-4">
        <StatusPanel icon={<Target size={18} />} label="Submission status" title={latest?.name ?? "Metamorphosis"} body="Pending Review" />
        <StatusPanel icon={<Sparkles size={18} />} label="Competitive result" title="New Personal Best" body="Moved to placement #3 on a recent board" />
        <StatusPanel icon={<Package size={18} />} label="Reward teaser" title="Next rank reward" body="UI_LAB_ONLY preview, not business logic" />
      </div>
    </section>
    <section>
      <SectionTitle title="CircZles Journey" />
      <div className="mt-3 grid gap-3 md:grid-cols-3">{puzzles.slice(0, 3).map((puzzle) => <PuzzleJourneyCard key={puzzle.id} puzzle={puzzle} />)}</div>
    </section>
  </div>;
}

function ProfilePreview({ player, puzzles, onOpenProgression, onEditAvatar }: { player: PlayerProfile; puzzles: PlayerPuzzle[]; onOpenProgression: () => void; onEditAvatar: () => void }) {
  return <div className="grid gap-6">
    <PlayerLobby player={player} onOpenProgression={onOpenProgression} onEditAvatar={onEditAvatar} profileMode />
    <SectionTitle title="Competitive Performance" />
    <div className={cn(styles.raised, "flex flex-wrap gap-x-8 gap-y-3 px-5 py-4")}>
      <MiniStat label="Best placement" value="#3" />
      <MiniStat label="Season placement" value={`#${player.stats.seasonRank}`} />
      <MiniStat label="Podium finishes" value={String(player.stats.podiums)} />
      <MiniStat label="Approved attempts" value={String(player.stats.approvedAttempts)} />
    </div>
    <SectionTitle title="Achievements" />
    <BadgeShowcase />
    <SectionTitle title="CircZles History" />
    <ul className={cn(styles.surface, "divide-y divide-[var(--cz-hairline)]")}>
      {puzzles.slice(0, 6).map((puzzle) => <li key={puzzle.id} className="flex items-center justify-between gap-4 px-5 py-3">
        <div>
          <p className={cn(styles.display, "text-sm font-semibold")}>{puzzle.name}</p>
          <p className="text-xs text-[var(--cz-text-tertiary)]">puzzleId {puzzle.id} | difficulty levelId {puzzle.levelId}</p>
        </div>
        <span className="text-sm text-[var(--cz-text-secondary)]">{puzzle.personalBest ?? "Unsolved"}</span>
      </li>)}
    </ul>
  </div>;
}

function LeaderboardPreview({ entries, highlightPlayerId }: { entries: LeaderboardEntry[]; highlightPlayerId: string }) {
  return <div className="grid gap-6">
    <LeaderboardPodium entries={entries} />
    <ul className={cn(styles.surface, "divide-y divide-[var(--cz-hairline)] p-2")}>
      {entries.filter((entry) => entry.rank > 3).map((entry) => <li key={`${entry.rank}-${entry.player.publicPlayerId}`} className={cn("flex items-center gap-4 rounded-lg px-3 py-3 transition-colors", entry.player.publicPlayerId === highlightPlayerId ? "bg-[var(--cz-aqua-dim)]" : "hover:bg-white/[0.02]")}>
        <PlacementMedal placement={entry.rank} size="sm" />
        <PlayerAvatarFrame player={entry.player} size={40} placement={null} />
        <div className="min-w-0 flex-1">
          <p className={cn(styles.display, "truncate text-sm font-semibold")}>{entry.player.displayName}</p>
          <p className="truncate text-xs text-[var(--cz-text-tertiary)]">{entry.puzzle} | difficulty levelId {entry.levelId}</p>
        </div>
        <span className="text-sm text-[var(--cz-text-secondary)]">{entry.time}</span>
      </li>)}
    </ul>
  </div>;
}

function PlayerLobby({ player, onOpenProgression, onEditAvatar, profileMode = false }: { player: PlayerProfile; onOpenProgression: () => void; onEditAvatar: () => void; profileMode?: boolean }) {
  const rank = rankFor(player.progressionLevel);
  const nextRank = progressionRanks.find((item) => item.order === rank.order + 1);
  const pct = Math.min(100, Math.round((player.xp / Math.max(1, player.xpNeeded)) * 100));
  return <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className={cn(styles.surface, styles.grain, "p-5 sm:p-7")}>
    <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full blur-3xl" style={{ background: "radial-gradient(circle, rgba(61,234,212,0.14) 0%, transparent 70%)" }} />
    <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-7">
      <div className="shrink-0">
        <PlayerAvatarFrame player={player} size={profileMode ? 150 : 132} placement={UI_LAB_ONLY_PROFILE_PLACEMENT} />
        <button onClick={onEditAvatar} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-[var(--cz-hairline)] bg-white/[0.03] px-3 py-2 text-xs text-[var(--cz-text-secondary)] hover:text-[var(--cz-text-primary)]"><Camera size={14} />Change Avatar</button>
      </div>
      <div className="min-w-0 flex-1">
        <h2 className={cn(styles.display, "truncate text-3xl font-bold")}>{player.displayName}</h2>
        <p className="text-sm text-[var(--cz-text-tertiary)]">{player.publicPlayerId}</p>
        <button onClick={onOpenProgression} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-[var(--cz-hairline)] bg-white/[0.03] px-3 py-2 text-left hover:border-[var(--cz-aqua)]">
          <RankEmblem rank={rank.rank} state="current" size={34} />
          <span><span className={cn(styles.display, "block text-sm font-semibold text-[var(--cz-aqua)]")}>{rank.rank}</span><span className="block text-xs text-[var(--cz-text-tertiary)]">Progression Level {player.progressionLevel}</span></span>
        </button>
        <div className="mt-4 max-w-md">
          <div className="h-2 overflow-hidden rounded-full bg-[var(--cz-inset)]"><motion.div className="h-full rounded-full bg-gradient-to-r from-[var(--cz-aqua)] to-[#7ef7e6]" initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.7 }} /></div>
          <div className="mt-1.5 flex items-center justify-between text-xs text-[var(--cz-text-tertiary)]">
            <span>{player.xp.toLocaleString()} / {player.xpNeeded.toLocaleString()} XP</span>
            {nextRank && <span>Next: {nextRank.rank}</span>}
          </div>
        </div>
      </div>
    </div>
    <div className="relative mt-6 flex flex-wrap gap-x-8 gap-y-3 border-t border-[var(--cz-hairline)] pt-4">
      <MiniStat icon={<Gem size={15} />} label="Synapse Points" value={player.synapsePoints.toLocaleString()} />
      <MiniStat icon={<Flame size={15} />} label="Streak" value={`${player.streak} days`} />
      <MiniStat icon={<Trophy size={15} />} label="Best placement" value="#3" />
    </div>
  </motion.section>;
}

function PlayerAvatar({ src, displayName, size }: { src: string; displayName: string; size: number }) {
  return <div className="absolute inset-[10%] flex items-center justify-center overflow-hidden rounded-full border border-[var(--cz-hairline-strong)] bg-[var(--cz-surface-raised)]">
    <Image src={src} alt={displayName} fill className="object-cover" sizes={`${size}px`} />
  </div>;
}

function PlayerAvatarFrame({ player, size, placement }: { player: Pick<PlayerProfile, "avatar" | "displayName"> & Partial<Pick<PlayerProfile, "equippedFrame">>; size: number; placement: Placement }) {
  const frame = frameAssets[player.equippedFrame as keyof typeof frameAssets] ?? frameAssets["Neon Circuit"];
  return <div className="relative shrink-0" style={{ width: size, height: size }}>
    <PlayerAvatar src={player.avatar} displayName={player.displayName} size={size} />
    {frame && <Image src={frame} alt="" fill sizes={`${size}px`} className="pointer-events-none select-none" />}
    <ProfilePlacementBadge placement={placement} />
  </div>;
}

function ProfilePlacementBadge({ placement }: { placement: Placement }) {
  if (!placement) return null;
  const tone = placement === 1 ? "var(--cz-gold)" : placement === 2 ? "var(--cz-silver)" : "var(--cz-bronze)";
  const Icon = placement === 1 ? Crown : placement === 2 ? Medal : Shield;
  return <div className="absolute -bottom-1 -right-1 grid h-11 w-11 place-items-center rounded-full border-2 bg-[#070a12] shadow-xl" style={{ borderColor: tone, color: tone }} title="UI_LAB_ONLY profile placement badge">
    <Icon size={18} />
    <span className={cn(styles.display, "text-[10px] font-bold leading-none")}>#{placement}</span>
  </div>;
}

function AvatarPicker({ open, currentAvatar, onPreview, onClose }: { open: boolean; currentAvatar: string; onPreview: (src: string) => void; onClose: () => void }) {
  return <AnimatePresence>
    {open && <motion.div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.section className={cn(styles.surface, "max-h-[88vh] w-full max-w-2xl overflow-auto rounded-b-none p-5 sm:rounded-b-2xl")} initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 24, opacity: 0 }} onClick={(event) => event.stopPropagation()}>
        <div className="mb-5 flex items-center justify-between">
          <div><p className="text-xs font-semibold uppercase tracking-[.16em] text-[var(--cz-aqua)]">UI Lab only</p><h2 className={cn(styles.display, "text-2xl font-bold")}>Change Avatar</h2></div>
          <button onClick={onClose} aria-label="Close avatar picker" className="rounded-full p-2 text-[var(--cz-text-tertiary)] hover:bg-white/5 hover:text-[var(--cz-text-primary)]"><X size={18} /></button>
        </div>
        {["CircZles Avatars", "Unlocked"].map((group) => <div key={group} className="mb-5">
          <SectionTitle title={group} />
          <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-5">
            {UI_LAB_ONLY_AVATARS.filter((avatar) => avatar.group === group).map((avatar) => <button key={avatar.id} onClick={() => onPreview(avatar.src)} className={cn(styles.raised, "grid gap-2 p-2 text-center text-xs", currentAvatar === avatar.src && "border-[var(--cz-aqua)]")}>
              <span className="relative mx-auto block h-16 w-16 overflow-hidden rounded-full"><Image src={avatar.src} alt={avatar.label} fill sizes="64px" /></span>{avatar.label}
            </button>)}
          </div>
        </div>)}
        <div className={cn(styles.raised, "grid gap-3 p-4")}>
          <SectionTitle title="My Photo" />
          <button className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--cz-hairline-strong)] bg-black/20 px-4 text-sm text-[var(--cz-text-secondary)]"><Upload size={16} />Upload Photo</button>
          <p className="text-xs text-[var(--cz-text-tertiary)]">Non-persistent preview placeholder. Real uploads will use backend/media storage later.</p>
        </div>
      </motion.section>
    </motion.div>}
  </AnimatePresence>;
}

function ProgressionCodex({ open, onClose, player }: { open: boolean; onClose: () => void; player: PlayerProfile }) {
  const currentRank = rankFor(player.progressionLevel);
  const [selected, setSelected] = useState(currentRank.key);
  const selectedRank = progressionRanks.find((rank) => rank.key === selected) ?? currentRank;
  const state = rankState(selectedRank.order, currentRank.order);
  const pct = state === "current" ? Math.min(100, Math.round((player.xp / Math.max(1, player.xpNeeded)) * 100)) : state === "completed" ? 100 : 0;
  return <AnimatePresence>
    {open && <motion.div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div role="dialog" aria-modal="true" aria-label="Progression preview" className={cn(styles.surface, styles.grain, "max-h-[85vh] w-full max-w-3xl overflow-hidden")} initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: 0.98 }} transition={{ duration: 0.2 }} onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--cz-hairline)] px-6 py-4">
          <h2 className={cn(styles.display, "text-sm font-semibold tracking-wide text-[var(--cz-text-secondary)]")}>Progression Codex</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-1.5 text-[var(--cz-text-tertiary)] hover:bg-white/5 hover:text-[var(--cz-text-primary)]"><X size={18} /></button>
        </div>
        <div className="grid max-h-[calc(85vh-57px)] grid-cols-1 md:grid-cols-[1fr_1.1fr]">
          <div className="flex flex-col items-center justify-center gap-4 border-b border-[var(--cz-hairline)] px-8 py-10 md:border-b-0 md:border-r">
            <RankEmblem rank={selectedRank.rank} state={state} size={168} />
            <div className="text-center">
              <p className={cn(styles.display, "text-2xl font-bold")}>{selectedRank.rank}</p>
              <p className={cn("mt-1 text-xs font-semibold tracking-wide", state === "completed" && "text-[var(--cz-emerald)]", state === "current" && "text-[var(--cz-aqua)]", state === "locked" && "text-[var(--cz-text-tertiary)]")}>{state.toUpperCase()}</p>
            </div>
            <div className="w-full max-w-[220px]">
              <div className="h-1.5 overflow-hidden rounded-full bg-[var(--cz-inset)]"><div className="h-full rounded-full bg-[var(--cz-aqua)]" style={{ width: `${pct}%` }} /></div>
              <p className="mt-1.5 text-center text-xs text-[var(--cz-text-tertiary)]">{state === "current" ? `${player.xp.toLocaleString()} / ${player.xpNeeded.toLocaleString()} XP` : "Visual placeholder reward tier"}</p>
            </div>
            <div className={cn(styles.raised, "w-full max-w-[220px] px-4 py-3")}>
              <p className="mb-1 text-[10px] uppercase tracking-wider text-[var(--cz-text-tertiary)]">Reward preview</p>
              <p className="text-sm text-[var(--cz-text-secondary)]">UI_LAB_ONLY placeholder, not approved business logic</p>
            </div>
          </div>
          <div className="overflow-y-auto px-4 py-4">
            {progressionRanks.map((rank) => <button key={rank.key} onClick={() => setSelected(rank.key)} className={cn("mb-2 grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 rounded-lg border px-3 py-2.5 text-left", selected === rank.key ? "border-[var(--cz-aqua)] bg-[var(--cz-aqua-dim)]" : "border-[var(--cz-hairline)] bg-white/[0.02]")}>
              <RankEmblem rank={rank.rank} state={rankState(rank.order, currentRank.order)} size={44} />
              <div><p className={cn(styles.display, "text-sm font-semibold")}>{rank.rank}</p><p className="text-xs text-[var(--cz-text-tertiary)]">Progression Level {rank.progressionLevel}</p></div>
              <span className="text-xs text-[var(--cz-text-tertiary)]">{rankState(rank.order, currentRank.order)}</span>
            </button>)}
          </div>
        </div>
      </motion.div>
    </motion.div>}
  </AnimatePresence>;
}

function LeaderboardPodium({ entries }: { entries: LeaderboardEntry[] }) {
  const byRank = (placement: number) => entries.find((entry) => entry.rank === placement);
  return <div className="grid gap-4 md:grid-cols-[1fr_1.15fr_1fr] md:items-end">
    <PodiumColumn entry={byRank(2)} height={86} delay={0.08} tone="silver" />
    <PodiumColumn entry={byRank(1)} height={132} delay={0} tone="gold" champion />
    <PodiumColumn entry={byRank(3)} height={70} delay={0.14} tone="bronze" />
  </div>;
}

function PodiumColumn({ entry, height, delay, champion = false, tone }: { entry?: LeaderboardEntry; height: number; delay: number; champion?: boolean; tone: "gold" | "silver" | "bronze" }) {
  if (!entry) return <div />;
  const color = tone === "gold" ? "var(--cz-gold)" : tone === "silver" ? "var(--cz-silver)" : "var(--cz-bronze)";
  return <motion.div className="flex flex-col items-center gap-3" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay }}>
    <PlacementMedal placement={entry.rank} size={champion ? "lg" : "md"} />
    <PlayerAvatarFrame player={entry.player} size={champion ? 132 : 88} placement={entry.rank <= 3 ? entry.rank as 1 | 2 | 3 : null} />
    <div className="text-center"><p className={cn(styles.display, "max-w-[150px] truncate text-base font-semibold")}>{entry.player.displayName}</p><p className="text-xs text-[var(--cz-text-tertiary)]">{entry.time} | {entry.puzzle}</p></div>
    <div className={cn(styles.podiumBase, styles.raised, "grid w-full place-items-center rounded-b-none border-b-0 px-4 text-center")} style={{ minHeight: height, borderColor: color }}>
      <p className={cn(styles.display, "text-2xl font-bold")} style={{ color }}>#{entry.rank}</p>
      <p className="text-xs text-[var(--cz-text-tertiary)]">Leaderboard placement</p>
    </div>
  </motion.div>;
}

function RankEmblem({ rank, state, size }: { rank: RankName; state: RankState; size: number }) {
  const key = rank.toLowerCase();
  const hasAura = state === "current" && ["apprentice", "nobleman", "master", "hero", "conqueror"].includes(key);
  return <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
    {hasAura && <div className="absolute inset-[-18%] animate-pulse rounded-full blur-xl" style={{ background: "radial-gradient(circle, rgba(61,234,212,0.35) 0%, rgba(232,180,80,0.18) 55%, transparent 75%)" }} />}
    <div className={cn("relative overflow-hidden rounded-[22%]", state === "locked" && "opacity-40 grayscale saturate-0", state === "current" && "ring-1 ring-[var(--cz-aqua)]/50")} style={{ width: size, height: size }}>
      <Image src={`/ui-lab/claude/ranks/${key}.svg`} alt={`${rank} progression emblem`} fill sizes={`${size}px`} />
    </div>
  </div>;
}

function BadgeShowcase() {
  return <div className={cn(styles.surface, "grid gap-4 p-5")}>
    <div className="flex items-end justify-between"><h3 className={cn(styles.display, "text-sm font-semibold")}>Badge Showcase</h3><span className="text-xs text-[var(--cz-text-tertiary)]">UI_LAB_ONLY assets</span></div>
    <div className="flex flex-wrap gap-4">{UI_LAB_ONLY_BADGES.map((badge) => <AchievementBadge key={badge.id} badge={badge} />)}<AchievementBadge badge={UI_LAB_ONLY_BADGES[0]} locked /></div>
  </div>;
}

function AchievementBadge({ badge, locked = false }: { badge: (typeof UI_LAB_ONLY_BADGES)[number]; locked?: boolean }) {
  const glow = badge.rarity === "legendary" && !locked;
  return <div className="group relative inline-flex w-[96px] flex-col items-center gap-1.5">
    <div className="relative h-[72px] w-[72px]">
      {glow && <motion.div className="absolute inset-[-25%] rounded-full bg-[var(--cz-gold-dim)] blur-md" animate={{ opacity: [0.5, 1, 0.5] }} transition={{ duration: 2.4, repeat: Infinity }} />}
      <div className={cn("relative h-full w-full overflow-hidden rounded-full bg-[var(--cz-surface-raised)]", locked && "opacity-35 grayscale")} style={{ boxShadow: `0 0 0 2px ${badge.rarity === "legendary" ? "var(--cz-gold)" : "var(--cz-hairline-strong)"}` }}>
        {locked ? <div className="grid h-full place-items-center"><Lock size={22} /></div> : <Image src={badge.icon} alt={badge.name} fill className="object-contain p-2" sizes="72px" />}
      </div>
    </div>
    <p className="max-w-[92px] truncate text-center text-[11px] leading-tight text-[var(--cz-text-secondary)]">{locked ? "Locked Badge" : badge.name}</p>
  </div>;
}

function PuzzleJourneyCard({ puzzle }: { puzzle: PlayerPuzzle }) {
  return <article className={cn(styles.raised, "overflow-hidden")}>
    <div className="relative aspect-[16/9] bg-black/30"><Image src={puzzle.image} alt="" fill className="object-cover opacity-80" sizes="(min-width: 768px) 33vw, 100vw" /></div>
    <div className="p-4">
      <p className={cn(styles.display, "text-lg font-bold")}>{puzzle.name}</p>
      <p className="mt-1 text-xs text-[var(--cz-text-tertiary)]">puzzleId {puzzle.id} | levelId {puzzle.levelId}</p>
      <div className="mt-3 flex items-center justify-between gap-3"><span className="text-sm text-[var(--cz-text-secondary)]">{puzzle.status.replaceAll("_", " ")}</span><span className="text-sm text-[var(--cz-aqua)]">{puzzle.personalBest ?? "Start"}</span></div>
    </div>
  </article>;
}

function StatusPanel({ icon, label, title, body }: { icon: ReactNode; label: string; title: string; body: string }) {
  return <article className={cn(styles.raised, "p-4")}>
    <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.14em] text-[var(--cz-text-tertiary)]">{icon}{label}</p>
    <h3 className={cn(styles.display, "mt-2 text-xl font-bold")}>{title}</h3>
    <p className="mt-1 text-sm text-[var(--cz-text-secondary)]">{body}</p>
  </article>;
}

function ActionButton({ icon, label }: { icon: ReactNode; label: string }) {
  return <button className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-[var(--cz-hairline-strong)] bg-white/[0.04] px-4 text-sm font-semibold text-[var(--cz-text-primary)] hover:border-[var(--cz-aqua)]">{icon}{label}<ChevronRight size={15} /></button>;
}

function PlacementMedal({ placement, size = "md" }: { placement: number; size?: "sm" | "md" | "lg" }) {
  const px = size === "lg" ? 54 : size === "sm" ? 30 : 42;
  const tone = placement === 1 ? "var(--cz-gold)" : placement === 2 ? "var(--cz-silver)" : placement === 3 ? "var(--cz-bronze)" : "var(--cz-text-tertiary)";
  const Icon = placement === 1 ? Crown : placement === 2 ? Medal : placement === 3 ? Shield : undefined;
  return <span className="inline-grid place-items-center rounded-full border bg-black/20" style={{ width: px, height: px, borderColor: tone, color: tone }}>
    {Icon ? <Icon size={px * 0.48} /> : <span className={cn(styles.display, "text-xs font-bold")}>#{placement}</span>}
  </span>;
}

function MiniStat({ icon, label, value }: { icon?: ReactNode; label: string; value: string }) {
  return <div className="flex items-center gap-2">
    {icon && <span className="text-[var(--cz-text-tertiary)]">{icon}</span>}
    <div><p className="text-[10px] uppercase tracking-wider text-[var(--cz-text-tertiary)]">{label}</p><p className={cn(styles.display, "text-lg font-bold")}>{value}</p></div>
  </div>;
}

function SectionTitle({ title }: { title: string }) {
  return <h2 className={cn(styles.display, "text-sm font-semibold")}>{title}</h2>;
}

function LabNavButton({ label, active, icon, onClick }: { label: string; active: boolean; icon: ReactNode; onClick: () => void }) {
  return <button onClick={onClick} className={cn("relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors", active ? "bg-[var(--cz-aqua-dim)] text-[var(--cz-text-primary)]" : "text-[var(--cz-text-secondary)] hover:bg-white/[0.03] hover:text-[var(--cz-text-primary)]")}>
    {active && <span className="absolute left-0 top-1/2 h-4 w-[2.5px] -translate-y-1/2 rounded-full bg-[var(--cz-aqua)]" />}
    {icon}<span className={cn(styles.display, "font-medium")}>{label}</span>
  </button>;
}

function rankFor(progressionLevel: number) {
  return progressionRanks.reduce((current, rank) => (rank.progressionLevel <= progressionLevel ? rank : current), progressionRanks[0]);
}

function rankState(order: number, currentOrder: number): RankState {
  if (order < currentOrder) return "completed";
  if (order === currentOrder) return "current";
  return "locked";
}
