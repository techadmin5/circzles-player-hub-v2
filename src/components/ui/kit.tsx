import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({ title, kicker, subtitle, actions }: { title: string; kicker?: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {kicker && <p className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-[var(--cz-aqua)]">{kicker}</p>}
        <h1 className="cz-display truncate text-2xl font-bold sm:text-[1.75rem]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-[var(--cz-text-secondary)]">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Surface({ children, className, grain = false }: { children: ReactNode; className?: string; grain?: boolean }) {
  return <div className={cn("cz-surface", grain && "cz-grain", className)}>{children}</div>;
}

export function Raised({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("cz-raised", className)}>{children}</div>;
}

export function SectionHeader({ title, icon, action }: { title: string; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="cz-display flex items-center gap-2 text-base font-bold">
        {icon && <span className="text-[var(--cz-aqua)]">{icon}</span>}
        {title}
      </h2>
      {action}
    </div>
  );
}

export function Stat({ label, value, icon, tone = "default" }: { label: string; value: string; icon?: ReactNode; tone?: "default" | "gold" | "aqua" }) {
  const color = tone === "gold" ? "var(--cz-gold)" : tone === "aqua" ? "var(--cz-aqua)" : "var(--cz-text-primary)";
  return (
    <div className="cz-raised px-4 py-3">
      <p className="flex items-center gap-1.5 text-[0.68rem] font-medium uppercase tracking-wide text-[var(--cz-text-tertiary)]">
        {icon}
        {label}
      </p>
      <p className="cz-display cz-num mt-1 text-2xl font-bold" style={{ color }}>{value}</p>
    </div>
  );
}

export function ProgressBar({ value, gold = false, className }: { value: number; gold?: boolean; className?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className={cn("cz-track", className)}>
      <div className={cn("cz-track-fill", gold && "cz-track-fill-gold")} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Chip({ children, tone = "default", className }: { children: ReactNode; tone?: "default" | "aqua" | "gold" | "emerald" | "danger" | "violet"; className?: string }) {
  const styles: Record<string, string> = {
    default: "",
    aqua: "border-[rgba(61,234,212,0.4)] bg-[var(--cz-aqua-dim)] text-[var(--cz-aqua)]",
    gold: "border-[rgba(232,180,80,0.45)] bg-[var(--cz-gold-dim)] text-[var(--cz-gold)]",
    emerald: "border-[rgba(52,211,153,0.4)] bg-[rgba(52,211,153,0.12)] text-[var(--cz-emerald)]",
    danger: "border-[rgba(242,85,90,0.4)] bg-[rgba(242,85,90,0.12)] text-[var(--cz-danger)]",
    violet: "border-[rgba(138,109,255,0.4)] bg-[rgba(138,109,255,0.12)] text-[var(--cz-violet)]",
  };
  return <span className={cn("cz-chip", styles[tone], className)}>{children}</span>;
}

export function EmptyState({ title, body, icon, action }: { title: string; body: string; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="cz-surface grid place-items-center gap-3 px-6 py-12 text-center">
      {icon && <div className="grid h-14 w-14 place-items-center rounded-2xl border border-[var(--cz-hairline)] bg-[var(--cz-inset)] text-[var(--cz-text-tertiary)]">{icon}</div>}
      <div>
        <h3 className="cz-display text-lg font-bold">{title}</h3>
        <p className="mx-auto mt-1 max-w-md text-sm text-[var(--cz-text-secondary)]">{body}</p>
      </div>
      {action}
    </div>
  );
}

export function LoadingState({ rows = 3 }: { rows?: number }) {
  return (
    <div className="grid gap-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="cz-raised h-20 animate-pulse opacity-60" />
      ))}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="cz-surface grid gap-3 border-[rgba(242,85,90,0.4)] p-5 text-center">
      <p className="text-sm text-[var(--cz-danger)]">{message}</p>
      {onRetry && <button className="cz-btn cz-btn-ghost cz-btn-sm mx-auto" onClick={onRetry}>Try again</button>}
    </div>
  );
}
