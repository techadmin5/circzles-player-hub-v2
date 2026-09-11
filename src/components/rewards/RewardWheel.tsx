"use client";

import { useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Gem, Sparkles, X } from "lucide-react";
import type { RewardWheelResult } from "@/types";
import { rewardService } from "@/services";
import { duckMusic, playSound } from "@/hooks/useSound";
import { formatNumber } from "@/lib/format";

type Tone = "aqua" | "gold" | "silver" | "blue" | "violet" | "graphite";

/** Visual display segments only. The winning result is service-authoritative. */
const SEGMENTS: { label: string; tone: Tone }[] = [
  { label: "100 SP", tone: "aqua" },
  { label: "Coupon", tone: "violet" },
  { label: "250 SP", tone: "blue" },
  { label: "700 SP", tone: "gold" },
  { label: "Retry", tone: "graphite" },
  { label: "Badge", tone: "silver" },
  { label: "50 SP", tone: "aqua" },
  { label: "Frame", tone: "gold" },
];

const TONE_FILL: Record<Tone, { base: string; edge: string; text: string }> = {
  aqua: { base: "#0f2a2c", edge: "rgba(61,234,212,0.5)", text: "#7ef7e6" },
  gold: { base: "#2a2113", edge: "rgba(232,180,80,0.6)", text: "#f4d089" },
  silver: { base: "#1c2330", edge: "rgba(185,196,214,0.5)", text: "#d7deea" },
  blue: { base: "#12203a", edge: "rgba(76,141,255,0.5)", text: "#9fc0ff" },
  violet: { base: "#1e1836", edge: "rgba(138,109,255,0.5)", text: "#c3b4ff" },
  graphite: { base: "#141a26", edge: "rgba(255,255,255,0.14)", text: "#8b97ac" },
};

const SEG = 360 / SEGMENTS.length;
const R = 96;
const CX = 100;
const CY = 100;

function polar(angleDeg: number, radius: number) {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return { x: CX + radius * Math.cos(a), y: CY + radius * Math.sin(a) };
}

function sectorPath(i: number) {
  const start = i * SEG;
  const end = start + SEG;
  const p1 = polar(start, R);
  const p2 = polar(end, R);
  return `M ${CX} ${CY} L ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} A ${R} ${R} 0 0 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)} Z`;
}

export function RewardWheel() {
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<RewardWheelResult | null>(null);
  const [reveal, setReveal] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const reduced = useReducedMotion();

  function scheduleTicks(durationMs: number) {
    const count = 14;
    for (let i = 0; i < count; i += 1) {
      const t = (durationMs * (i + 1)) / count * (0.5 + i / (count * 1.5));
      timers.current.push(setTimeout(() => playSound("wheelTick"), Math.min(t, durationMs - 100)));
    }
  }

  async function spin() {
    if (spinning) return;
    setSpinning(true);
    setResult(null);
    playSound("wheelStart");

    const res = await rewardService.spinWheel();
    const index = ((res.wheelSegmentIndex % SEGMENTS.length) + SEGMENTS.length) % SEGMENTS.length;

    // Land segment center under the top pointer.
    const target = (360 - (index * SEG + SEG / 2) + 360) % 360;
    const current = ((rotation % 360) + 360) % 360;
    let delta = target - current;
    if (delta < 0) delta += 360;
    const durationSec = reduced ? 0 : 4.4;

    setRotation((r) => r + 360 * 4 + delta);
    if (!reduced) scheduleTicks(durationSec * 1000);

    timers.current.push(setTimeout(() => {
      setResult(res);
      setReveal(true);
      setSpinning(false);
      duckMusic(2200);
      playSound("wheelReward");
    }, durationSec * 1000 + 60));
  }

  function closeReveal() {
    playSound("modalClose");
    setReveal(false);
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }

  return (
    <div className="cz-surface cz-grain relative mx-auto grid w-full max-w-sm place-items-center gap-5 p-6" data-testid="reward-wheel">
      <div className="text-center">
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[var(--cz-aqua)]">Daily Mechanic</p>
        <h2 className="cz-display text-xl font-bold">Reward Wheel</h2>
      </div>

      <div className="relative grid aspect-square w-[min(300px,82vw)] place-items-center">
        {/* controlled ambient illumination */}
        <div className="pointer-events-none absolute inset-0 rounded-full blur-2xl" style={{ background: "radial-gradient(circle, rgba(61,234,212,0.12), transparent 65%)" }} />
        {/* pointer */}
        <svg className="absolute -top-1 z-20" width="30" height="26" viewBox="0 0 30 26" aria-hidden><path d="M15 26 L2 3 Q15 -4 28 3 Z" fill="var(--cz-gold)" stroke="#8a6a24" strokeWidth="0.5" /></svg>
        {/* metallic rim */}
        <div className="absolute inset-0 rounded-full" style={{ background: "conic-gradient(from 0deg, #2b3446, #10151f, #2b3446, #10151f, #2b3446)", padding: 8, boxShadow: "0 20px 50px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(255,255,255,0.06)" }}>
          <div className="h-full w-full rounded-full" style={{ background: "#070a12" }} />
        </div>

        <motion.svg
          viewBox="0 0 200 200" className="relative z-10 h-[91%] w-[91%]"
          animate={{ rotate: rotation }} transition={{ duration: reduced ? 0 : 4.4, ease: [0.16, 1, 0.3, 1] }}
        >
          <defs>
            <radialGradient id="cz-wheel-core" cx="50%" cy="45%" r="70%">
              <stop offset="0%" stopColor="#16202f" />
              <stop offset="100%" stopColor="#0a0e18" />
            </radialGradient>
          </defs>
          <circle cx={CX} cy={CY} r={R} fill="url(#cz-wheel-core)" />
          {SEGMENTS.map((s, i) => {
            const fill = TONE_FILL[s.tone];
            const mid = i * SEG + SEG / 2;
            const label = polar(mid, R * 0.66);
            return (
              <g key={i}>
                <path d={sectorPath(i)} fill={fill.base} stroke={fill.edge} strokeWidth="0.6" />
                <text x={label.x} y={label.y} fill={fill.text} fontSize="8.5" fontWeight="700" textAnchor="middle" dominantBaseline="middle"
                  transform={`rotate(${mid} ${label.x} ${label.y})`} style={{ fontFamily: "var(--font-manrope), sans-serif" }}>{s.label}</text>
              </g>
            );
          })}
          <circle cx={CX} cy={CY} r={R} fill="none" stroke="rgba(61,234,212,0.22)" strokeWidth="1" />
        </motion.svg>

        {/* center hub */}
        <div className="absolute z-20 grid h-16 w-16 place-items-center rounded-full border border-[rgba(61,234,212,0.4)] bg-[var(--cz-void)] shadow-[0_0_20px_rgba(61,234,212,0.2)]">
          <Sparkles size={22} className="text-[var(--cz-aqua)]" />
        </div>
      </div>

      <button onClick={spin} disabled={spinning} className="cz-btn cz-btn-gold min-w-40" data-testid="wheel-spin">{spinning ? "Spinning…" : "Spin Wheel"}</button>
      <p className="max-w-xs text-center text-xs text-[var(--cz-text-tertiary)]">Result is decided server-side. The wheel only animates to the returned segment.</p>

      <AnimatePresence>
        {reveal && result && (
          <motion.div className="fixed inset-0 z-[90] grid place-items-center bg-black/75 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={closeReveal} data-testid="reward-reveal">
            <motion.div className="cz-surface cz-grain cz-ring-gold relative w-full max-w-sm overflow-hidden p-7 text-center"
              initial={{ scale: 0.9, y: 12, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} transition={{ type: "spring", damping: 22, stiffness: 260 }}
              onClick={(e) => e.stopPropagation()}>
              <button onClick={closeReveal} aria-label="Close" className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full text-[var(--cz-text-tertiary)] hover:text-[var(--cz-text-primary)]"><X size={16} /></button>
              <div className="pointer-events-none absolute inset-x-0 -top-10 h-40 blur-3xl" style={{ background: "radial-gradient(circle, rgba(232,180,80,0.28), transparent 70%)" }} />
              <span className="relative mx-auto grid h-16 w-16 place-items-center rounded-full border border-[rgba(232,180,80,0.5)] bg-[var(--cz-gold-dim)] text-[var(--cz-gold)]"><Sparkles size={30} /></span>
              <p className="relative mt-4 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[var(--cz-aqua)]">You won</p>
              <h3 className="cz-display relative mt-1 text-3xl font-bold text-[var(--cz-gold)]">{result.rewardLabel}</h3>
              <p className="relative mt-3 inline-flex items-center gap-1.5 text-sm text-[var(--cz-text-secondary)]"><Gem size={14} />New balance {formatNumber(result.resultingBalance)} SP</p>
              <button onClick={closeReveal} className="cz-btn cz-btn-primary relative mt-5 w-full">Collect</button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
