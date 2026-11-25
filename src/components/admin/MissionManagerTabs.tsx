"use client";
import { useId } from "react";
export function MissionManagerTabs({ tabs, value, onChange, label, disabled = false }: { tabs: readonly string[]; value: string; onChange: (value: string) => void; label: string; disabled?: boolean }) {
  const id = useId();
  return <div role="tablist" aria-label={label} className="mm-tabs">{tabs.map((tab, index) => <button key={tab} id={id + "-" + index} type="button" role="tab" disabled={disabled} aria-selected={value === tab} tabIndex={value === tab ? 0 : -1} onClick={() => onChange(tab)} onKeyDown={event => {
    let target: number | null = null;
    if (event.key === "ArrowRight") target = (index + 1) % tabs.length;
    if (event.key === "ArrowLeft") target = (index - 1 + tabs.length) % tabs.length;
    if (event.key === "Home") target = 0;
    if (event.key === "End") target = tabs.length - 1;
    if (target !== null) { event.preventDefault(); onChange(tabs[target]); event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[target]?.focus(); }
  }}>{tab}</button>)}</div>;
}
