"use client";
import { useEffect, useRef, type ReactNode } from "react";
export function AdminConfirmationDialog({ title, busy, onCancel, children }: { title: string; busy: boolean; onCancel: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current, previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (el?.showModal) el.showModal(); else if (el) el.open = true;
    el?.querySelector<HTMLButtonElement>('button[data-cancel]')?.focus();
    return () => previous?.focus();
  }, []);
  return <dialog ref={ref} className="mm-modal" aria-label={title} onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }} onKeyDown={event => {
    if (event.key !== "Tab") return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]')], first = buttons[0], last = buttons.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }}><h4>{title}</h4>{children}<button data-cancel type="button" disabled={busy} onClick={onCancel}>Cancel</button></dialog>;
}
