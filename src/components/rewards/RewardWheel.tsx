"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Gem, Sparkles, X } from "lucide-react";
import type { RewardWheelResult, RewardWheelStatus } from "@/types";
import { rewardService } from "@/services";
import { dataMode } from "@/config/dataMode";
import { ApiClientError } from "@/lib/apiClient";
import { duckMusic, playSound } from "@/hooks/useSound";
import { formatNumber } from "@/lib/format";

type Tone = "aqua" | "gold" | "silver" | "blue" | "violet" | "graphite";
type DisplaySegment = { wheelSegmentIndex: number; label: string; tone: Tone };

const MOCK_SEGMENTS: DisplaySegment[] = [
  { wheelSegmentIndex: 0, label: "100 SP", tone: "aqua" },
  { wheelSegmentIndex: 1, label: "Coupon", tone: "violet" },
  { wheelSegmentIndex: 2, label: "250 SP", tone: "blue" },
  { wheelSegmentIndex: 3, label: "700 SP", tone: "gold" },
  { wheelSegmentIndex: 4, label: "Retry", tone: "graphite" },
  { wheelSegmentIndex: 5, label: "Badge", tone: "silver" },
  { wheelSegmentIndex: 6, label: "50 SP", tone: "aqua" },
  { wheelSegmentIndex: 7, label: "Frame", tone: "gold" },
];

const TONE_FILL: Record<Tone, { base: string; edge: string; text: string }> = {
  aqua: { base: "#0f2a2c", edge: "rgba(61,234,212,0.5)", text: "#7ef7e6" },
  gold: { base: "#2a2113", edge: "rgba(232,180,80,0.6)", text: "#f4d089" },
  silver: { base: "#1c2330", edge: "rgba(185,196,214,0.5)", text: "#d7deea" },
  blue: { base: "#12203a", edge: "rgba(76,141,255,0.5)", text: "#9fc0ff" },
  violet: { base: "#1e1836", edge: "rgba(138,109,255,0.5)", text: "#c3b4ff" },
  graphite: { base: "#141a26", edge: "rgba(255,255,255,0.14)", text: "#8b97ac" },
};

const R = 96;
const CX = 100;
const CY = 100;

function polar(angleDeg: number, radius: number) {
  const angle = ((angleDeg - 90) * Math.PI) / 180;
  return { x: CX + radius * Math.cos(angle), y: CY + radius * Math.sin(angle) };
}

function sectorPath(index: number, segmentAngle: number) {
  const start = index * segmentAngle;
  const end = start + segmentAngle;
  const p1 = polar(start, R);
  const p2 = polar(end, R);
  const largeArc = segmentAngle > 180 ? 1 : 0;
  return `M ${CX} ${CY} L ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} A ${R} ${R} 0 ${largeArc} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)} Z`;
}

export function RewardWheel() {
  const [status, setStatus] = useState<RewardWheelStatus | null>(dataMode === "mock" ? { available: true, wheel: null } : null);
  const [loadingStatus, setLoadingStatus] = useState(dataMode === "api");
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<RewardWheelResult | null>(null);
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intentKey = useRef<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (dataMode !== "api") return;
    const controller = new AbortController();
    rewardService.getWheelStatus(controller.signal).then(setStatus).catch((cause) => {
      if (!controller.signal.aborted) setError(errorMessage(cause, "Reward Wheel status could not be loaded."));
    }).finally(() => { if (!controller.signal.aborted) setLoadingStatus(false); });
    return () => controller.abort();
  }, []);

  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);

  const segments = useMemo<DisplaySegment[]>(() => {
    if (dataMode === "mock") return MOCK_SEGMENTS;
    return status?.wheel?.segments.map((segment, index) => ({
      wheelSegmentIndex: segment.wheelSegmentIndex,
      label: segment.label,
      tone: segmentTone(segment.displayMetadata.tone, segment.rewardType, index),
    })) ?? [];
  }, [status]);
  const segmentAngle = segments.length ? 360 / segments.length : 360;
  const canSpin = dataMode === "mock" || Boolean(status?.wheel?.canSpin && segments.length);

  function scheduleTicks(durationMs: number) {
    const count = 14;
    for (let index = 0; index < count; index += 1) {
      const time = (durationMs * (index + 1)) / count * (0.5 + index / (count * 1.5));
      timers.current.push(setTimeout(() => playSound("wheelTick"), Math.min(time, durationMs - 100)));
    }
  }

  async function spin() {
    if (spinning || !canSpin || !segments.length) return;
    setSpinning(true);
    setResult(null);
    setError(null);
    const key = intentKey.current ?? crypto.randomUUID();
    intentKey.current = key;
    try {
      const response = await rewardService.spinWheel(key);
      const displayIndex = segments.findIndex((segment) => segment.wheelSegmentIndex === response.wheelSegmentIndex);
      if (displayIndex < 0) throw new Error("The confirmed reward segment is not present in the loaded wheel configuration.");
      intentKey.current = null;
      playSound("wheelStart");
      const target = (360 - (displayIndex * segmentAngle + segmentAngle / 2) + 360) % 360;
      const current = ((rotation % 360) + 360) % 360;
      let delta = target - current;
      if (delta < 0) delta += 360;
      const durationMs = reduced ? 0 : 4400;
      setRotation((value) => value + 360 * 4 + delta);
      if (!reduced) scheduleTicks(durationMs);
      timers.current.push(setTimeout(() => {
        setResult(response);
        setReveal(true);
        setSpinning(false);
        setStatus((currentStatus) => currentStatus?.wheel ? { ...currentStatus, wheel: { ...currentStatus.wheel, canSpin: response.nextSpinAt ? false : currentStatus.wheel.canSpin, nextSpinAt: response.nextSpinAt ?? null, unavailableReason: response.nextSpinAt ? "WHEEL_COOLDOWN_ACTIVE" : currentStatus.wheel.unavailableReason } } : currentStatus);
        duckMusic(2200);
        playSound("wheelReward");
      }, durationMs + 60));
    } catch (cause) {
      setSpinning(false);
      setError(errorMessage(cause, "The spin could not be completed. Try again with the same request."));
    }
  }

  function closeReveal() {
    setReveal(false);
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }

  const wheel = status?.wheel;
  return (
    <div className="cz-surface cz-grain relative mx-auto grid w-full max-w-sm place-items-center gap-5 p-6" data-testid="reward-wheel">
      <div className="text-center">
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-[var(--cz-aqua)]">Daily Mechanic</p>
        <h2 className="cz-display text-xl font-bold">{wheel?.name ?? "Reward Wheel"}</h2>
        {dataMode === "api" && wheel && <p className="mt-1 text-xs text-[var(--cz-text-tertiary)]">{wheel.costSynapsePoints > 0 ? `${formatNumber(wheel.costSynapsePoints)} SP per spin` : "Free spin"}</p>}
      </div>

      <div className="relative grid aspect-square w-[min(300px,82vw)] place-items-center">
        <div className="pointer-events-none absolute inset-0 rounded-full blur-2xl" style={{ background: "radial-gradient(circle, rgba(61,234,212,0.12), transparent 65%)" }} />
        <svg className="absolute -top-1 z-20" width="30" height="26" viewBox="0 0 30 26" aria-hidden><path d="M15 26 L2 3 Q15 -4 28 3 Z" fill="var(--cz-gold)" stroke="#8a6a24" strokeWidth="0.5" /></svg>
        <div className="absolute inset-0 rounded-full" style={{ background: "conic-gradient(from 0deg, #2b3446, #10151f, #2b3446, #10151f, #2b3446)", padding: 8, boxShadow: "0 20px 50px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(255,255,255,0.06)" }}><div className="h-full w-full rounded-full" style={{ background: "#070a12" }} /></div>

        <motion.svg viewBox="0 0 200 200" className="relative z-10 h-[91%] w-[91%]" animate={{ rotate: rotation }} transition={{ duration: reduced ? 0 : 4.4, ease: [0.16, 1, 0.3, 1] }}>
          <defs><radialGradient id="cz-wheel-core" cx="50%" cy="45%" r="70%"><stop offset="0%" stopColor="#16202f" /><stop offset="100%" stopColor="#0a0e18" /></radialGradient></defs>
          <circle cx={CX} cy={CY} r={R} fill="url(#cz-wheel-core)" />
          {segments.map((segment, index) => {
            const fill = TONE_FILL[segment.tone];
            const middle = index * segmentAngle + segmentAngle / 2;
            const label = polar(middle, R * 0.66);
            return <g key={segment.wheelSegmentIndex}><path d={sectorPath(index, segmentAngle)} fill={fill.base} stroke={fill.edge} strokeWidth="0.6" /><text x={label.x} y={label.y} fill={fill.text} fontSize="8.5" fontWeight="700" textAnchor="middle" dominantBaseline="middle" transform={`rotate(${middle} ${label.x} ${label.y})`} style={{ fontFamily: "var(--font-manrope), sans-serif" }}>{segment.label}</text></g>;
          })}
          <circle cx={CX} cy={CY} r={R} fill="none" stroke="rgba(61,234,212,0.22)" strokeWidth="1" />
        </motion.svg>

        <div className="absolute z-20 grid h-16 w-16 place-items-center rounded-full border border-[rgba(61,234,212,0.4)] bg-[var(--cz-void)] shadow-[0_0_20px_rgba(61,234,212,0.2)]"><Sparkles size={22} className="text-[var(--cz-aqua)]" /></div>
      </div>

      <button onClick={spin} disabled={spinning || loadingStatus || !canSpin} data-sound="silent" className="cz-btn cz-btn-gold min-w-40" data-testid="wheel-spin">{loadingStatus ? "Loading..." : spinning ? "Resolving..." : "Spin Wheel"}</button>
      <p className="max-w-xs text-center text-xs text-[var(--cz-text-tertiary)]">{wheelStatusMessage(status, error)}</p>

      <AnimatePresence>
        {reveal && result && (
          <motion.div className="fixed inset-0 z-[90] grid place-items-center bg-black/75 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={closeReveal} data-testid="reward-reveal">
            <motion.div className="cz-surface cz-grain cz-ring-gold relative w-full max-w-sm overflow-hidden p-7 text-center" initial={{ scale: 0.9, y: 12, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} transition={{ type: "spring", damping: 22, stiffness: 260 }} onClick={(event) => event.stopPropagation()}>
              <button onClick={closeReveal} data-sound="silent" aria-label="Close" className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full text-[var(--cz-text-tertiary)] hover:text-[var(--cz-text-primary)]"><X size={16} /></button>
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

function segmentTone(configuredTone: unknown, rewardType: string, index: number): Tone {
  if (typeof configuredTone === "string" && configuredTone in TONE_FILL) return configuredTone as Tone;
  if (rewardType === "SYNAPSE_POINTS") return index % 2 ? "blue" : "aqua";
  if (rewardType === "XP") return "violet";
  if (rewardType === "FRAME" || rewardType === "AVATAR") return "gold";
  if (rewardType === "BADGE" || rewardType === "COSMETIC") return "silver";
  return "graphite";
}

function wheelStatusMessage(status: RewardWheelStatus | null, error: string | null) {
  if (error) return error;
  if (dataMode === "mock") return "Demo result is selected locally in mock mode.";
  if (!status) return "Loading server-authoritative wheel status.";
  if (!status.wheel) return "No Reward Wheel is currently available.";
  if (status.wheel.nextSpinAt && !status.wheel.canSpin) return `Next spin: ${new Date(status.wheel.nextSpinAt).toLocaleString()}`;
  if (!status.wheel.canSpin) return status.wheel.unavailableReason === "WHEEL_NO_ELIGIBLE_REWARDS" ? "You already own every unique reward currently available." : "This Reward Wheel is not currently available.";
  return "The server determines the reward and final balance before the wheel animates.";
}

function errorMessage(cause: unknown, fallback: string) {
  if (cause instanceof ApiClientError) return cause.message;
  return cause instanceof Error ? cause.message : fallback;
}
