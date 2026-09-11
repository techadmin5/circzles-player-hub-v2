"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Gem, Sparkles, Zap } from "lucide-react";
import { duckMusic, playSound, useSound } from "@/hooks/useSound";
import { usePlayerUiState, type PlayerUiSnapshot } from "@/stores/playerUiState";
import { LevelUpOverlay, type ProgressionRewardPreview } from "@/components/progression/LevelUpOverlay";

export interface RewardFeedback {
  source: "MISSION" | "PREVIEW" | "REWARD";
  synapsePoints: number;
  xp: number;
  previousPlayerState: PlayerUiSnapshot;
  newPlayerState: PlayerUiSnapshot;
  label?: string;
  sourceElement?: HTMLElement | null;
  progressionRewards?: ProgressionRewardPreview[];
  onCollectProgressionRewards?: () => void;
}

interface QueuedFeedback extends RewardFeedback { id: number }
type Stage = "reveal" | "sp" | "xp" | "rank";
interface FeedbackState { active: QueuedFeedback | null; queue: QueuedFeedback[]; stage: Stage }
type FeedbackAction = { type: "enqueue"; feedback: QueuedFeedback } | { type: "stage"; stage: Stage } | { type: "finish" };

interface GameFeedbackApi {
  celebrateReward: (feedback: RewardFeedback) => void;
  showErrorFeedback: (message?: string) => void;
}

const GameFeedbackContext = createContext<GameFeedbackApi | null>(null);
let nextFeedbackId = 1;

export function GameFeedbackProvider({ children }: { children: ReactNode }) {
  const [{ active, stage }, dispatch] = useReducer(feedbackReducer, { active: null, queue: [], stage: "reveal" });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const reducedSetting = useSound((state) => state.reducedMotion);
  const systemReduced = useReducedMotion();
  const reducedMotion = reducedSetting || systemReduced;
  const timerRef = useRef<number | undefined>(undefined);

  const celebrateReward = useCallback((feedback: RewardFeedback) => {
    dispatch({ type: "enqueue", feedback: { ...feedback, id: nextFeedbackId++ } });
  }, []);

  const showErrorFeedback = useCallback((message = "That action could not be completed.") => {
    setErrorMessage(message);
    playSound("error");
    window.setTimeout(() => setErrorMessage(null), 2200);
  }, []);

  const finishActive = useCallback((finalBalance: number) => {
    usePlayerUiState.getState().setDisplayedSynapsePoints(finalBalance);
    dispatch({ type: "finish" });
  }, []);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const wait = (milliseconds: number) => new Promise<void>((resolve) => {
      timerRef.current = window.setTimeout(resolve, reducedMotion ? Math.min(milliseconds, 450) : milliseconds);
    });
    const run = async () => {
      if (active.source === "MISSION") { playSound("missionComplete"); duckMusic(1900); }
      else playSound("rewardReveal");
      await wait(950);
      if (cancelled) return;
      if (active.synapsePoints > 0) {
        dispatch({ type: "stage", stage: "sp" });
        playCoinSequence(active.synapsePoints);
        animateBalance(active.previousPlayerState.synapsePoints, active.newPlayerState.synapsePoints, Boolean(reducedMotion));
        await wait(1050);
      }
      if (cancelled) return;
      if (active.xp > 0) {
        dispatch({ type: "stage", stage: "xp" });
        playSound("xp");
        await wait(1150);
      }
      if (cancelled) return;
      if (active.newPlayerState.progressionLevel > active.previousPlayerState.progressionLevel) {
        dispatch({ type: "stage", stage: "rank" });
        return;
      }
      if (!cancelled) finishActive(active.newPlayerState.synapsePoints);
    };
    void run();
    return () => {
      cancelled = true;
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [active, finishActive, reducedMotion]);

  const value = useMemo(() => ({ celebrateReward, showErrorFeedback }), [celebrateReward, showErrorFeedback]);
  return (
    <GameFeedbackContext.Provider value={value}>
      {children}
      <GameFeedbackOverlay active={active} stage={stage} reducedMotion={Boolean(reducedMotion)} onDismiss={() => active && finishActive(active.newPlayerState.synapsePoints)} />
      <AnimatePresence>{errorMessage && <motion.div role="alert" className="fixed bottom-24 left-1/2 z-[110] -translate-x-1/2 rounded-lg border border-red-400/30 bg-[#190d12] px-4 py-3 text-sm text-red-100 shadow-2xl" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>{errorMessage}</motion.div>}</AnimatePresence>
    </GameFeedbackContext.Provider>
  );
}

function feedbackReducer(state: FeedbackState, action: FeedbackAction): FeedbackState {
  if (action.type === "enqueue") {
    return state.active ? { ...state, queue: [...state.queue, action.feedback] } : { active: action.feedback, queue: [], stage: "reveal" };
  }
  if (action.type === "stage") return { ...state, stage: action.stage };
  const [next, ...queue] = state.queue;
  return { active: next ?? null, queue, stage: "reveal" };
}

export function useGameFeedback() {
  const value = useContext(GameFeedbackContext);
  if (!value) throw new Error("useGameFeedback must be used within GameFeedbackProvider.");
  return value;
}

function GameFeedbackOverlay({ active, stage, reducedMotion, onDismiss }: { active: QueuedFeedback | null; stage: Stage; reducedMotion: boolean; onDismiss: () => void }) {
  return (
    <>
      <p className="sr-only" aria-live="polite" aria-atomic="true">{active ? rewardAnnouncement(active) : ""}</p>
      <AnimatePresence mode="wait">
        {active && stage !== "rank" && <motion.div key={`${active.id}-${stage}`} className="pointer-events-none fixed inset-0 z-[100] grid place-items-center overflow-hidden px-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          {stage === "reveal" && <RewardRevealStage reward={active} reducedMotion={reducedMotion} />}
          {stage === "sp" && <SynapseRewardEffect reward={active} reducedMotion={reducedMotion} />}
          {stage === "xp" && <XpGainEffect reward={active} reducedMotion={reducedMotion} />}
        </motion.div>}
      </AnimatePresence>
      {active && stage === "rank" && <LevelUpOverlay previousRankName={active.previousPlayerState.rankName} newRankName={active.newPlayerState.rankName} progressionLevel={active.newPlayerState.progressionLevel} rewards={active.progressionRewards} onCollectRewards={active.onCollectProgressionRewards} reducedMotion={reducedMotion} onDismiss={onDismiss} />}
    </>
  );
}

function RewardRevealStage({ reward, reducedMotion }: { reward: RewardFeedback; reducedMotion: boolean }) {
  return <motion.div aria-hidden="true" className="cz-elevate w-full max-w-sm rounded-2xl border border-[rgba(232,180,80,0.4)] bg-[#0c111d]/95 p-7 text-center shadow-[0_0_70px_rgba(232,180,80,0.16)]" initial={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.82, y: 18 }} animate={{ opacity: 1, scale: 1, y: 0 }}>
    <Sparkles aria-hidden="true" className="mx-auto mb-3 text-[var(--cz-gold)]" size={28} />
    <p className="cz-display text-xs font-bold uppercase text-[var(--cz-aqua)]">{reward.label ?? (reward.source === "MISSION" ? "Mission Complete" : "Reward Unlocked")}</p>
    <div className="mt-4 flex flex-wrap justify-center gap-3">
      {reward.synapsePoints > 0 && <RewardAmount icon={<Gem size={18} />} value={`+${reward.synapsePoints} SP`} tone="gold" />}
      {reward.xp > 0 && <RewardAmount icon={<Zap size={18} />} value={`+${reward.xp} XP`} tone="aqua" />}
    </div>
  </motion.div>;
}

function RewardAmount({ icon, value, tone }: { icon: ReactNode; value: string; tone: "gold" | "aqua" }) {
  return <span className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-lg font-bold ${tone === "gold" ? "border-amber-300/30 bg-amber-300/10 text-[var(--cz-gold)]" : "border-cyan-300/30 bg-cyan-300/10 text-[var(--cz-aqua)]"}`}>{icon}{value}</span>;
}

function SynapseRewardEffect({ reward, reducedMotion }: { reward: RewardFeedback; reducedMotion: boolean }) {
  const destination = getBalanceDestination();
  const source = getSourceOrigin(reward.sourceElement);
  return <div className="absolute inset-0" aria-hidden="true">
    <motion.div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-amber-300/30 bg-[#151107]/90 px-5 py-3 text-2xl font-bold text-[var(--cz-gold)] shadow-[0_0_50px_rgba(232,180,80,0.25)]" initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }}>+{reward.synapsePoints} SP</motion.div>
    {!reducedMotion && destination && Array.from({ length: 8 }, (_, index) => <motion.span key={index} className="absolute grid h-7 w-7 place-items-center rounded-full border border-amber-200/60 bg-[var(--cz-gold)] text-[#281b03] shadow-[0_0_16px_rgba(232,180,80,0.5)]" style={{ left: source.x, top: source.y }} initial={{ x: -14, y: -14, opacity: 0, scale: 0.4 }} animate={{ x: [index % 2 ? -50 : 50, (destination.x - source.x) * 0.45, destination.x - source.x], y: [index < 4 ? -45 : 45, -80 - index * 4, destination.y - source.y], opacity: [0, 1, 1, 0], scale: [0.4, 1, 0.7, 0.25] }} transition={{ duration: 0.9, delay: index * 0.035, ease: "easeInOut" }}><Gem size={13} /></motion.span>)}
  </div>;
}

function XpGainEffect({ reward, reducedMotion }: { reward: RewardFeedback; reducedMotion: boolean }) {
  const denominator = Math.max(reward.newPlayerState.xpNeeded ?? 0, reward.newPlayerState.xp, 1);
  const previous = Math.min(100, reward.previousPlayerState.xp / denominator * 100);
  const next = Math.min(100, reward.newPlayerState.xp / denominator * 100);
  return <motion.div aria-hidden="true" className="w-full max-w-md rounded-2xl border border-cyan-300/30 bg-[#09151b]/95 p-6 shadow-[0_0_60px_rgba(61,234,212,0.18)]" initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
    <div className="flex items-center justify-between"><span className="cz-display flex items-center gap-2 font-bold text-[var(--cz-aqua)]"><Zap size={20} /> XP GAIN</span><strong className="text-xl text-white">+{reward.xp} XP</strong></div>
    <div className="mt-5 h-3 overflow-hidden rounded-full bg-black/45"><motion.div className="h-full rounded-full bg-gradient-to-r from-[var(--cz-aqua)] to-[#7ef7e6] shadow-[0_0_18px_rgba(61,234,212,0.55)]" initial={{ width: `${previous}%` }} animate={{ width: `${next}%` }} transition={{ duration: reducedMotion ? 0.1 : 0.85, ease: "easeOut" }} /></div>
    <p className="mt-2 text-right text-xs text-[var(--cz-text-secondary)]">{reward.newPlayerState.xp.toLocaleString()} XP</p>
  </motion.div>;
}

function animateBalance(from: number, to: number, reducedMotion: boolean) {
  const store = usePlayerUiState.getState();
  if (reducedMotion) {
    store.setDisplayedSynapsePoints(to);
    pulseBalance();
    return;
  }
  const started = performance.now();
  const tick = (now: number) => {
    const progress = Math.min(1, (now - started) / 800);
    usePlayerUiState.getState().setDisplayedSynapsePoints(Math.round(from + (to - from) * (1 - Math.pow(1 - progress, 3))));
    if (progress < 1) requestAnimationFrame(tick); else pulseBalance();
  };
  requestAnimationFrame(tick);
}

function pulseBalance() {
  usePlayerUiState.getState().setBalancePulse(true);
  playSound("coinArrival");
  window.setTimeout(() => usePlayerUiState.getState().setBalancePulse(false), 650);
}

function playCoinSequence(amount: number) {
  const ticks = amount <= 25 ? 3 : amount <= 500 ? 5 : 6;
  const rates = [.96, 1, 1.04, 1.08];
  for (let index = 0; index < ticks; index += 1) {
    window.setTimeout(() => playSound("coin", { playbackRate: rates[index % rates.length] }), 90 + index * (620 / Math.max(1, ticks - 1)));
  }
}

function getBalanceDestination() {
  const rect = document.querySelector<HTMLElement>("[data-synapse-anchor]")?.getBoundingClientRect();
  return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
}

function getSourceOrigin(element?: HTMLElement | null) {
  const rect = element?.getBoundingClientRect();
  return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

function rewardAnnouncement(reward: RewardFeedback) {
  return `${reward.label ?? "Reward received"}. ${reward.synapsePoints > 0 ? `${reward.synapsePoints} Synapse Points. ` : ""}${reward.xp > 0 ? `${reward.xp} XP.` : ""}`;
}
