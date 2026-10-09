"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Bell, Gift, Home, Medal, Puzzle, ScrollText, ShoppingBag, Swords, User, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { missionService, puzzleService, rewardService, storeService } from "@/services";
import { cn } from "@/lib/utils";

export function InstantTabs({ tabs }: { tabs: string[] }) {
  const [active, setActive] = useState(tabs[0]);
  return <div className="flex flex-wrap gap-2">{tabs.map((tab) => <button key={tab} onClick={() => setActive(tab)} className={`btn ${active === tab ? "btn-primary" : "btn-ghost"}`}>{tab}</button>)}</div>;
}

const playerNav = [
  ["/hub", Home, "Home"], ["/puzzles", Puzzle, "CircZles"], ["/leaderboard", Medal, "Leaderboard"], ["/missions", Swords, "Missions"], ["/rewards", ShoppingBag, "Rewards"],
  ["/inventory", ScrollText, "Inventory"], ["/activity", Bell, "Activity"], ["/friends", Users, "Friends"], ["/notifications", Bell, "Notifications"], ["/profile", User, "Profile"],
] as const;

function ActiveNavLink({ href, label, icon: Icon, mobile = false }: { href: string; label: string; icon: React.ComponentType<{ size?: number }>; mobile?: boolean }) {
  const pathname = usePathname();
  const active = pathname === href || (href !== "/hub" && pathname.startsWith(`${href}/`));
  return <Link aria-current={active ? "page" : undefined} href={href} className={cn(mobile ? "grid justify-items-center gap-1 rounded-md py-2 text-[11px] font-semibold active:scale-95" : "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-semibold transition-colors duration-150", active ? "bg-cyan-300/12 text-white" : "text-[var(--text-secondary)] hover:bg-white/6 hover:text-white")}><Icon size={mobile ? 19 : 18}/>{label}</Link>;
}

export function PlayerNav({ mobile = false }: { mobile?: boolean }) {
  const items = mobile ? [...playerNav.slice(0, 5), ["/friends", Users, "More"] as const] : playerNav;
  return <>{items.map(([href, Icon, label]) => <ActiveNavLink key={`${href}-${label}`} href={href} icon={Icon} label={label} mobile={mobile} />)}</>;
}

export function AddPuzzleForm() {
  const [message, setMessage] = useState("");
  return <form className="game-card flex flex-col gap-3 p-4 sm:flex-row" onSubmit={async (e) => { e.preventDefault(); const form = new FormData(e.currentTarget); const result = await puzzleService.claimByCode(String(form.get("code") ?? "")); setMessage(result.success ? `Added ${result.puzzle.name}` : "Enter a valid CircZles SKU."); }}>
    <input aria-label="CircZles SKU" name="code" placeholder="CC-29-R2-01-0001" className="min-h-11 flex-1 rounded-md border border-white/15 bg-black/25 px-3" />
    <button className="btn btn-primary">Add CircZles</button>
    {message && <p className="text-sm text-[var(--cyan)]">{message}</p>}
  </form>;
}

export function ClaimMissionButton({ missionId }: { missionId: string }) {
  const [label, setLabel] = useState("Claim");
  return <button className="btn btn-primary" onClick={async () => { setLabel("Claiming"); await missionService.claimMission(missionId, crypto.randomUUID()); setLabel("Claimed"); }}>{label}</button>;
}

export function PurchaseButton({ itemId }: { itemId: string }) {
  const [label, setLabel] = useState("Buy");
  return <button className="btn btn-primary" onClick={async () => { setLabel("Buying"); await storeService.purchaseItem(itemId); setLabel("Owned"); }}>{label}</button>;
}

export function RewardWheel() {
  const [result, setResult] = useState<string | null>(null);
  const [rotation, setRotation] = useState(0);
  const reduced = useReducedMotion();
  return <div className="game-card grid place-items-center gap-5 p-6">
    <motion.div animate={{ rotate: rotation }} transition={{ duration: reduced ? 0 : 2.4, ease: "easeOut" }} className="grid aspect-square w-64 place-items-center rounded-full border-[14px] border-cyan-300 bg-[conic-gradient(from_0deg,#26d9ff,#377dff,#f8c84e,#55f2d8,#26d9ff)] text-center">
      <Gift size={56} className="text-[#05070d]" />
    </motion.div>
    <button className="btn btn-primary" onClick={async () => { const spin = await rewardService.spinWheel(); setRotation(1440 + spin.wheelSegmentIndex * 45); setResult(spin.rewardLabel); }}>Spin Wheel</button>
    {result && <p className="font-display text-3xl font-bold text-[var(--gold)]">{result}</p>}
  </div>;
}

export function SubmissionStepper() {
  const steps = ["Select CircZles", "Enter time", "Choose video", "Upload mock", "Review", "Submit"];
  const [step, setStep] = useState(0);
  return <div className="game-card p-5"><div className="grid gap-2 md:grid-cols-6">{steps.map((s, i)=><button key={s} onClick={()=>setStep(i)} className={`rounded-md border px-3 py-3 text-sm font-semibold ${i === step ? "border-cyan-300 bg-cyan-300/15" : "border-white/10 bg-white/5"}`}>{s}</button>)}</div><div className="mt-5 rounded-md border border-white/10 bg-black/20 p-5"><h2 className="font-display text-3xl font-bold">{steps[step]}</h2><p className="mt-2 text-[var(--text-secondary)]">Mock submission state updates immediately; upload progress is isolated to this flow and not used for navigation.</p><button className="btn btn-primary mt-4" onClick={()=>setStep(Math.min(step+1, steps.length-1))}>Continue</button></div></div>;
}
