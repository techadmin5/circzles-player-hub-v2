"use client";

import { SecurityPanel } from "@/components/auth/SecurityPanel";
import { Volume2 } from "lucide-react";
import { useSound } from "@/hooks/useSound";
import { cn } from "@/lib/utils";
import { dataMode } from "@/config/dataMode";

function Toggle({ label, description, checked, onChange, testid }: { label: string; description: string; checked: boolean; onChange: (v: boolean) => void; testid: string }) {
  return (
    <label className="flex items-center justify-between gap-4 rounded-xl border border-[var(--cz-hairline)] bg-white/[0.02] px-4 py-3">
      <span>
        <span className="cz-display block text-sm font-semibold">{label}</span>
        <span className="block text-xs text-[var(--cz-text-tertiary)]">{description}</span>
      </span>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} data-testid={testid} onClick={() => onChange(!checked)}
        className={cn("relative h-6 w-11 shrink-0 overflow-hidden rounded-full border p-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cz-aqua)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--cz-surface)]", checked ? "border-transparent bg-[var(--cz-aqua)]" : "border-[var(--cz-hairline-strong)] bg-[var(--cz-inset)]")}>
        <span className={cn("pointer-events-none absolute left-0.5 top-0.5 h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform", checked ? "translate-x-5" : "translate-x-0")} />
      </button>
    </label>
  );
}

function VolumeSlider({ label, value, onChange, disabled }: { label: string; value: number; onChange: (value: number) => void; disabled: boolean }) {
  return <label className="grid gap-2 rounded-xl border border-[var(--cz-hairline)] bg-white/[0.02] px-4 py-3">
    <span className="flex justify-between text-sm"><span className="font-semibold">{label}</span><span className="cz-num text-[var(--cz-text-tertiary)]">{Math.round(value * 100)}%</span></span>
    <input type="range" min="0" max="1" step="0.05" value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} aria-label={label} className="accent-[var(--cz-aqua)]" />
  </label>;
}

const PROFILE_FIELDS = ["First Name", "Last Name", "Email", "Display Name", "Country", "State"];

export function SettingsPanel() {
  const { master, effects, music, reducedMotion, notifications, effectsVolume, musicVolume, setSound } = useSound();
  return (
    <div className={cn("grid min-w-0 gap-5", dataMode === "mock" && "lg:grid-cols-2")}>
      {dataMode === "mock" && <section className="cz-surface grid gap-3 p-5">
        <h2 className="cz-display text-base font-bold">Profile Settings</h2>
        <p className="text-xs text-[var(--cz-text-tertiary)]">Only <span className="text-[var(--cz-text-secondary)]">Display Name</span> is renameable. Your player IDs stay immutable.</p>
        {PROFILE_FIELDS.map((f) => (
          <label key={f} className="grid gap-1 text-sm">
            <span className="text-[var(--cz-text-secondary)]">{f}</span>
            <input aria-label={f} placeholder={f} className="min-h-11 rounded-xl border border-[var(--cz-hairline-strong)] bg-[var(--cz-inset)] px-3.5 text-sm outline-none focus:border-[var(--cz-aqua)]" />
          </label>
        ))}
        <button className="cz-btn cz-btn-primary mt-1 w-fit" data-testid="save-profile">Save Changes</button>
      </section>}

      {dataMode === "api" && <SecurityPanel />}
      <section className="cz-surface grid content-start gap-3 p-5">
        <h2 className="cz-display flex items-center gap-2 text-base font-bold"><Volume2 size={17} className="text-[var(--cz-aqua)]" />Game & Sound</h2>
        <Toggle label="Master Sound" description="Enable all game audio." checked={master} onChange={(v) => setSound({ master: v })} testid="toggle-master" />
        <Toggle label="Music" description="Loop approved hub music after interaction." checked={music} onChange={(v) => setSound({ music: v })} testid="toggle-music" />
        <Toggle label="Sound Effects" description="UI, reward and progression cues." checked={effects} onChange={(v) => setSound({ effects: v })} testid="toggle-effects" />
        <Toggle label="Reduced Motion" description="Minimize animations and wheel motion." checked={reducedMotion} onChange={(v) => setSound({ reducedMotion: v })} testid="toggle-motion" />
        <Toggle label="Notification Sounds" description="In-app notification alerts." checked={notifications} onChange={(v) => setSound({ notifications: v })} testid="toggle-notifications" />
        <VolumeSlider label="Effects Volume" value={effectsVolume} disabled={!master || !effects} onChange={(value) => setSound({ effectsVolume: value })} />
        <VolumeSlider label="Music Volume" value={musicVolume} disabled={!master || !music} onChange={(value) => setSound({ musicVolume: value })} />
      </section>
    </div>
  );
}
