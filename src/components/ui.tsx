import Image from "next/image";
import Link from "next/link";
import type { ActivityEvent, Coupon, InventoryItem, LeaderboardEntry, Mission, PlayerProfile, PlayerPuzzle, StoreItem, Submission } from "@/types";
import { cn } from "@/lib/utils";
import { PlayerNav } from "./Interactive";

export function EmptyState({ title, body }: { title: string; body: string }) {
  return <div className="game-card p-6 text-center"><h3 className="font-display text-2xl font-bold">{title}</h3><p className="mt-2 text-sm text-[var(--text-secondary)]">{body}</p></div>;
}

export function LoadingSkeleton() { return <div className="game-card h-28 animate-pulse bg-white/5" />; }
export function ErrorState({ message }: { message: string }) { return <div className="game-card border-red-400/40 p-5 text-red-200">{message}</div>; }

export function PublicHeader() {
  return <header className="sticky top-0 z-30 border-b border-white/10 bg-[#05070d]/90 backdrop-blur">
    <nav className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
      <Link href="/" className="font-display text-2xl font-bold text-[var(--cyan)]">CircZles</Link>
      <div className="hidden gap-5 text-sm text-[var(--text-secondary)] md:flex"><Link href="/how-it-works">How It Works</Link><Link href="/leaderboard">Leaderboard</Link><Link href="/rewards">Rewards</Link></div>
      <Link className="btn btn-primary" href="/hub">Enter Hub</Link>
    </nav>
  </header>;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh md:flex">
    <aside className="fixed left-0 top-0 z-40 hidden h-dvh w-64 border-r border-white/10 bg-[#070b13] p-4 md:block">
      <Link href="/hub" className="font-display text-3xl font-bold text-[var(--cyan)]">CircZles Hub</Link>
      <nav className="mt-8 grid gap-1"><PlayerNav /></nav>
      <Link href="/admin" className="mt-8 block rounded-md border border-amber-300/30 px-3 py-2 text-sm text-amber-100">Admin Area</Link>
    </aside>
    <main className="w-full pb-24 md:ml-64 md:pb-0">{children}</main>
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-50 grid grid-cols-6 border-t border-white/10 bg-[#070b13]/95 px-2 pt-2 md:hidden"><PlayerNav mobile /></nav>
  </div>;
}

export function PageFrame({ title, eyebrow, children, action }: { title: string; eyebrow?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return <section className="mx-auto max-w-7xl px-4 py-6 md:px-8"><div className="mb-6 flex flex-wrap items-end justify-between gap-4">{<div>{eyebrow && <p className="text-sm font-semibold text-[var(--cyan)]">{eyebrow}</p>}<h1 className="font-display text-4xl font-bold md:text-6xl">{title}</h1></div>}{action}</div>{children}</section>;
}

export function PlayerSummary({ player }: { player: PlayerProfile }) {
  const pct = Math.min(100, Math.round((player.xp / player.xpNeeded) * 100));
  return <div className="game-card glow-border grid gap-5 p-5 md:grid-cols-[auto_1fr_auto]">
    <Image src={player.avatar} alt="" width={84} height={84} className="rounded-lg" />
    <div><h2 className="font-display text-4xl font-bold">{player.displayName}</h2><p className="text-sm text-[var(--text-secondary)]">{player.publicPlayerId} · {player.rank} · Progression Level {player.progressionLevel}</p><div className="mt-3 h-3 rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-r from-[var(--cyan)] to-[var(--gold)]" style={{ width: `${pct}%` }} /></div></div>
    <div className="grid grid-cols-2 gap-3 text-right"><StatCard label="Synapse Points" value={player.synapsePoints.toLocaleString()} /><StatCard label="Streak" value={`${player.streak}d`} /></div>
  </div>;
}

export function StatCard({ label, value }: { label: string; value: string }) { return <div className="game-card p-4"><p className="text-xs text-[var(--text-muted)]">{label}</p><p className="stat-number text-3xl text-white">{value}</p></div>; }
export function PuzzleStatusBadge({ status }: { status: string }) { return <span className="rounded border border-cyan-300/30 px-2 py-1 text-xs font-bold text-cyan-100">{status.replaceAll("_", " ")}</span>; }
export function PuzzleCard({ puzzle }: { puzzle: PlayerPuzzle }) { return <Link href={`/puzzles/${puzzle.id}`} className="game-card block overflow-hidden transition-transform duration-150 hover:-translate-y-0.5 active:scale-[.99]"><Image src={puzzle.image} alt="" width={640} height={420} className="aspect-[16/10] w-full object-cover"/><div className="p-4"><div className="flex items-center justify-between gap-2"><h3 className="font-display text-2xl font-bold">{puzzle.name}</h3><PuzzleStatusBadge status={puzzle.status}/></div><p className="mt-1 text-sm text-[var(--text-secondary)]">levelId {puzzle.levelId} · Best {puzzle.personalBest ?? "Unsolved"} · Rank {puzzle.leaderboardRank ?? "NA"}</p></div></Link>; }
export function SubmissionCard({ submission }: { submission: Submission }) { return <Link href={`/submissions/${submission.id}`} className="game-card block p-4"><div className="flex justify-between gap-3"><h3 className="font-display text-2xl font-bold">{submission.puzzleName}</h3><PuzzleStatusBadge status={submission.status}/></div><p className="text-sm text-[var(--text-secondary)]">levelId {submission.levelId} · {submission.completionTime} · {submission.createdAt}</p></Link>; }
export function MissionCard({ mission }: { mission: Mission }) { const pct = Math.round((mission.progress.current / mission.progress.target) * 100); return <div className="game-card p-4"><div className="flex justify-between gap-3"><h3 className="font-display text-2xl font-bold">{mission.title}</h3><PuzzleStatusBadge status={mission.status}/></div><p className="mt-1 text-sm text-[var(--text-secondary)]">{mission.description}</p><div className="mt-4 h-2 rounded-full bg-white/10" aria-label={`${mission.progress.current} of ${mission.progress.target}`}><div className="h-full rounded-full bg-[var(--cyan)]" style={{width:`${pct}%`}}/></div><p className="mt-3 text-sm text-[var(--gold)]">{mission.rewards.map(r=>r.label).join(" + ")} · {mission.timeRemaining}</p><p className="mt-1 text-xs text-[var(--text-muted)]">{mission.category} · {mission.startAt} to {mission.endAt}</p></div>; }
export function StoreItemCard({ item }: { item: StoreItem }) { return <div className="game-card p-4"><h3 className="font-display text-2xl font-bold">{item.name}</h3><p className="text-sm text-[var(--text-secondary)]">{item.description}</p><div className="mt-4 flex items-center justify-between"><span className="stat-number text-2xl text-[var(--gold)]">{item.cost.toLocaleString()} SP</span><button className="btn btn-primary">{item.state.replaceAll("_"," ")}</button></div></div>; }
export function InventoryCard({ item }: { item: InventoryItem }) { return <div className="game-card p-4"><h3 className="font-display text-2xl font-bold">{item.name}</h3><p className="text-sm text-[var(--text-secondary)]">{item.category} · {item.rarity}</p><button className="btn btn-ghost mt-4 w-full">{item.state}</button></div>; }
export function CouponCard({ coupon }: { coupon: Coupon }) { return <div className="game-card p-4"><p className="stat-number text-3xl text-[var(--gold)]">{coupon.discount}</p><h3 className="font-display text-2xl font-bold">{coupon.code}</h3><p className="text-sm text-[var(--text-secondary)]">{coupon.source} · Expires {coupon.expiry}</p><button className="btn btn-ghost mt-4 w-full">Copy</button></div>; }
export function ActivityItem({ event }: { event: ActivityEvent }) { return <div className="game-card p-4"><p className="text-xs text-[var(--cyan)]">{event.type}</p><h3 className="font-display text-2xl font-bold">{event.title}</h3><p className="text-sm text-[var(--text-secondary)]">{event.detail} · {event.createdAt}</p></div>; }

export function LeaderboardTable({ entries }: { entries: LeaderboardEntry[] }) {
  return <div className="grid gap-3">{entries.slice(0,3).length > 0 && <div className="grid gap-3 md:grid-cols-3">{entries.slice(0,3).map(e=><div key={e.rank} className="game-card glow-border p-5 text-center"><p className="stat-number text-5xl text-[var(--gold)]">#{e.rank}</p><h3 className="font-display text-2xl font-bold">{e.player.displayName}</h3><p className="text-sm text-[var(--text-secondary)]">{e.time} · {e.puzzle}</p></div>)}</div>}<div className="game-card overflow-hidden">{entries.map(e=><Link href={`/profile/${e.player.publicPlayerId}`} key={`${e.rank}-${e.player.publicPlayerId}`} className={cn("grid gap-2 border-t border-white/10 p-4 md:grid-cols-[80px_1fr_120px_1fr_1fr]", e.isCurrentPlayer && "bg-cyan-300/8")}><strong className="stat-number text-2xl">#{e.rank}</strong><span>{e.player.displayName}</span><span>{e.time}</span><span>{e.puzzle} · levelId {e.levelId}</span><span className="text-[var(--text-secondary)]">{e.region}</span></Link>)}</div></div>;
}
