import Link from "next/link";
import type { ReactNode } from "react";
import { LayoutGrid } from "lucide-react";

export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-[var(--cz-hairline)] bg-[rgba(9,13,23,0.82)] backdrop-blur-xl">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-[var(--cz-aqua)] to-[#1a8a7c] text-[var(--cz-void)]"><LayoutGrid size={17} /></span>
            <span className="cz-display text-lg font-bold">CircZles</span>
          </Link>
          <div className="hidden items-center gap-6 text-sm text-[var(--cz-text-secondary)] sm:flex">
            <Link href="/how-it-works" className="hover:text-[var(--cz-text-primary)]">How It Works</Link>
            <Link href="/leaderboard" className="hover:text-[var(--cz-text-primary)]">Leaderboard</Link>
            <Link href="/rewards" className="hover:text-[var(--cz-text-primary)]">Rewards</Link>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/login" className="cz-btn cz-btn-ghost cz-btn-sm">Log In</Link>
            <Link href="/hub" className="cz-btn cz-btn-primary cz-btn-sm">Enter Hub</Link>
          </div>
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}
