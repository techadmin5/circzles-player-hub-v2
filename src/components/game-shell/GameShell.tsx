"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, ChevronRight, Gem, LayoutGrid, Menu, Shield, X } from "lucide-react";
import type { ReactNode } from "react";
import type { PlayerProfile } from "@/types";
import { MOBILE_PRIMARY, MORE_NAV, PRIMARY_NAV, SETTINGS_ITEM, type NavItem } from "./navConfig";
import { playSound } from "@/hooks/useSound";
import { DEFAULT_AVATAR } from "@/config/assets";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

function isActive(pathname: string, href: string) {
  return pathname === href || (href !== "/hub" && pathname.startsWith(`${href}/`));
}

function NavLink({ item, pathname, onClick }: { item: NavItem; pathname: string; onClick?: () => void }) {
  const active = isActive(pathname, item.href);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      onClick={() => { playSound("navigation"); onClick?.(); }}
      data-testid={`nav-${item.href.replace(/\//g, "") || "root"}`}
      className={cn(
        "relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors duration-150",
        active ? "bg-[var(--cz-aqua-dim)] text-[var(--cz-text-primary)]" : "text-[var(--cz-text-secondary)] hover:bg-white/[0.03] hover:text-[var(--cz-text-primary)]",
      )}
    >
      {active && <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-[var(--cz-aqua)]" />}
      <Icon size={18} className={active ? "text-[var(--cz-aqua)]" : ""} />
      <span>{item.label}</span>
    </Link>
  );
}

function Sidebar({ pathname }: { pathname: string }) {
  return (
    <aside className="sticky top-0 hidden h-dvh w-[236px] shrink-0 flex-col border-r border-[var(--cz-hairline)] bg-[var(--cz-surface)] px-3 py-5 lg:flex">
      <Link href="/hub" onClick={() => playSound("navigation")} className="mb-6 flex items-center gap-2.5 px-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-[var(--cz-aqua)] to-[#1a8a7c] text-[var(--cz-void)]"><LayoutGrid size={17} /></span>
        <span className="cz-display text-[1.05rem] font-bold tracking-tight">CircZles</span>
      </Link>
      <nav className="cz-scroll flex flex-1 flex-col gap-0.5 overflow-y-auto pr-1">
        {PRIMARY_NAV.map((item) => <NavLink key={item.href} item={item} pathname={pathname} />)}
      </nav>
      <div className="mt-2 grid gap-0.5 border-t border-[var(--cz-hairline)] pt-2">
        <NavLink item={SETTINGS_ITEM} pathname={pathname} />
        <Link href="/admin" onClick={() => playSound("navigation")} data-testid="nav-admin" className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-[var(--cz-text-tertiary)] transition-colors hover:bg-[var(--cz-gold-dim)] hover:text-[var(--cz-gold)]">
          <Shield size={18} />Admin Area
        </Link>
      </div>
    </aside>
  );
}

function TopBar({ player, onOpenMenu }: { player?: PlayerProfile; onOpenMenu: () => void }) {
  return (
    <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-[var(--cz-hairline)] bg-[rgba(9,13,23,0.82)] px-4 py-3 backdrop-blur-xl lg:px-8">
      <Link href="/hub" className="flex items-center gap-2 lg:hidden">
        <span className="grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-[var(--cz-aqua)] to-[#1a8a7c] text-[var(--cz-void)]"><LayoutGrid size={15} /></span>
        <span className="cz-display text-sm font-bold">CircZles</span>
      </Link>
      <div className="ml-auto flex items-center gap-2">
        {player && (
          <Link href="/rewards" onClick={() => playSound("navigation")} data-testid="topbar-synapse" className="flex items-center gap-1.5 rounded-full border border-[rgba(232,180,80,0.3)] bg-[var(--cz-gold-dim)] px-3 py-1.5 text-sm font-semibold text-[var(--cz-gold)]">
            <Gem size={15} /><span className="cz-num">{formatNumber(player.synapsePoints)}</span>
          </Link>
        )}
        <Link href="/notifications" onClick={() => playSound("navigation")} data-testid="topbar-notifications" aria-label="Notifications" className="grid h-9 w-9 place-items-center rounded-full border border-[var(--cz-hairline)] bg-white/[0.03] text-[var(--cz-text-secondary)] transition-colors hover:text-[var(--cz-text-primary)]">
          <Bell size={17} />
        </Link>
        <Link href="/profile" onClick={() => playSound("navigation")} data-testid="topbar-profile" aria-label="Profile" className="relative h-9 w-9 overflow-hidden rounded-full border border-[var(--cz-hairline-strong)] bg-[var(--cz-surface-raised)]">
          <Image src={player?.avatar || DEFAULT_AVATAR} alt="" fill sizes="36px" className="object-cover" />
        </Link>
        <button onClick={() => { playSound("button"); onOpenMenu(); }} data-testid="topbar-menu" aria-label="Open menu" className="grid h-9 w-9 place-items-center rounded-full border border-[var(--cz-hairline)] bg-white/[0.03] text-[var(--cz-text-secondary)] lg:hidden">
          <Menu size={18} />
        </button>
      </div>
    </header>
  );
}

function MoreSheet({ open, onClose, pathname }: { open: boolean; onClose: () => void; pathname: string }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[70] flex items-end bg-black/70 backdrop-blur-sm lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => { playSound("modalClose"); onClose(); }}>
          <motion.div
            className="cz-surface max-h-[82vh] w-full overflow-y-auto rounded-b-none p-4"
            initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ type: "spring", damping: 30, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            data-testid="more-sheet"
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="cz-display text-base font-bold">All Features</h2>
              <button onClick={() => { playSound("modalClose"); onClose(); }} aria-label="Close menu" className="grid h-9 w-9 place-items-center rounded-full border border-[var(--cz-hairline)] text-[var(--cz-text-tertiary)]"><X size={18} /></button>
            </div>
            <div className="grid grid-cols-2 gap-2 pb-[env(safe-area-inset-bottom)]">
              {MORE_NAV.map((item) => {
                const active = isActive(pathname, item.href);
                const Icon = item.icon;
                return (
                  <Link key={item.href} href={item.href} onClick={() => { playSound("navigation"); onClose(); }} data-testid={`more-${item.href.replace(/\//g, "")}`}
                    className={cn("flex items-center justify-between gap-2 rounded-xl border px-3 py-3 text-sm font-medium", active ? "border-[rgba(61,234,212,0.4)] bg-[var(--cz-aqua-dim)] text-[var(--cz-text-primary)]" : "border-[var(--cz-hairline)] bg-white/[0.02] text-[var(--cz-text-secondary)]")}>
                    <span className="flex items-center gap-2.5"><Icon size={17} className={active ? "text-[var(--cz-aqua)]" : ""} />{item.label}</span>
                    <ChevronRight size={15} className="text-[var(--cz-text-tertiary)]" />
                  </Link>
                );
              })}
              <Link href="/admin" onClick={() => { playSound("navigation"); onClose(); }} data-testid="more-admin" className="col-span-2 flex items-center justify-between gap-2 rounded-xl border border-[rgba(232,180,80,0.3)] bg-[var(--cz-gold-dim)] px-3 py-3 text-sm font-medium text-[var(--cz-gold)]">
                <span className="flex items-center gap-2.5"><Shield size={17} />Admin Area</span>
                <ChevronRight size={15} />
              </Link>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function MobileNav({ pathname, onOpenMore }: { pathname: string; onOpenMore: () => void }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 grid grid-cols-6 border-t border-[var(--cz-hairline)] bg-[rgba(14,20,32,0.96)] px-1.5 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl lg:hidden">
      {MOBILE_PRIMARY.map((item) => {
        const active = isActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link key={item.href} href={item.href} onClick={() => playSound("navigation")} data-testid={`mobilenav-${item.href.replace(/\//g, "")}`}
            className={cn("grid min-w-0 justify-items-center gap-1 rounded-lg px-0.5 py-1.5 text-[10px] font-semibold", active ? "text-[var(--cz-aqua)]" : "text-[var(--cz-text-tertiary)]")}>
            <Icon size={20} /><span className="w-full truncate text-center leading-none">{item.label.replace("Player ", "").replace("My ", "")}</span>
          </Link>
        );
      })}
      <button onClick={() => { playSound("button"); onOpenMore(); }} data-testid="mobilenav-more" className="grid min-w-0 justify-items-center gap-1 rounded-lg px-0.5 py-1.5 text-[10px] font-semibold text-[var(--cz-text-tertiary)]">
        <Menu size={20} /><span className="w-full truncate text-center leading-none">More</span>
      </button>
    </nav>
  );
}

export function GameShell({ player, children }: { player?: PlayerProfile; children: ReactNode }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <div className="min-h-dvh lg:flex">
      <Sidebar pathname={pathname} />
      <div className="flex min-h-dvh w-full min-w-0 flex-col">
        <TopBar player={player} onOpenMenu={() => setMoreOpen(true)} />
        <main className="mx-auto w-full max-w-[1240px] flex-1 px-4 pb-28 pt-6 lg:px-8 lg:pb-12">{children}</main>
      </div>
      <MobileNav pathname={pathname} onOpenMore={() => setMoreOpen(true)} />
      <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} pathname={pathname} />
    </div>
  );
}
