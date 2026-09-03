"use client";

import { useState } from "react";
import { CheckCircle2, Plus } from "lucide-react";
import { puzzleService } from "@/services";
import { playSound } from "@/hooks/useSound";

export function AddPuzzlePanel() {
  const [status, setStatus] = useState<"idle" | "busy" | "ok" | "err">("idle");
  const [message, setMessage] = useState<string>("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const sku = String(form.get("sku") ?? "");
    setStatus("busy");
    playSound("button");
    const result = await puzzleService.claimBySku(sku);
    if (result.success) {
      setStatus("ok");
      setMessage(`Added ${result.puzzle.name} to your Player Hub.`);
      playSound("success");
    } else {
      setStatus("err");
      setMessage("Enter a valid CircZles SKU or code from your physical puzzle.");
      playSound("error");
    }
  }

  return (
    <div className="cz-surface p-5" data-testid="add-puzzle-panel">
      <div className="mb-3 flex items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-lg border border-[rgba(61,234,212,0.3)] bg-[var(--cz-aqua-dim)] text-[var(--cz-aqua)]"><Plus size={17} /></span>
        <div>
          <h2 className="cz-display text-base font-bold">Add a Puzzle</h2>
          <p className="text-xs text-[var(--cz-text-tertiary)]">Enter the SKU / code printed on your physical CircZles puzzle.</p>
        </div>
      </div>
      <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row">
        <input name="sku" aria-label="CircZles SKU or code" placeholder="CZ-LION-100" data-testid="add-puzzle-input"
          className="min-h-11 flex-1 rounded-xl border border-[var(--cz-hairline-strong)] bg-[var(--cz-inset)] px-3.5 text-sm outline-none placeholder:text-[var(--cz-text-tertiary)] focus:border-[var(--cz-aqua)]" />
        <button type="submit" className="cz-btn cz-btn-primary" disabled={status === "busy"} data-testid="add-puzzle-submit">{status === "busy" ? "Adding…" : "Add Puzzle"}</button>
      </form>
      {message && (
        <p className={`mt-3 flex items-center gap-1.5 text-sm ${status === "ok" ? "text-[var(--cz-emerald)]" : "text-[var(--cz-danger)]"}`} data-testid="add-puzzle-message">
          {status === "ok" && <CheckCircle2 size={15} />}{message}
        </p>
      )}
    </div>
  );
}
