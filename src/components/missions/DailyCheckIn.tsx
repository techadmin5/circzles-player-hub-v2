"use client";
import { useState } from "react";
import { request } from "@/lib/apiClient";

export function DailyCheckIn({ onRecorded }: { onRecorded: () => void }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  return <section className="cz-inset mb-4 space-y-2 p-4" aria-label="Daily check-in">
    <button type="button" className="cz-btn" disabled={busy} onClick={async () => {
      setBusy(true); setMessage("");
      try {
        const result = await request<{ utcDate: string; idempotent: boolean }>("/api/missions/check-in", { method: "POST", body: "{}" });
        setMessage(`${result.idempotent ? "Already checked in" : "Check-in recorded"} for ${result.utcDate} UTC. Mission progress may take a moment; refresh to check it.`);
        onRecorded();
      } catch (error) { setMessage(error instanceof Error ? error.message : "Check-in failed. Please retry."); }
      finally { setBusy(false); }
    }}>{busy ? "Recording check-in…" : "Check in today"}</button>
    <p>One authenticated check-in per UTC date. Refreshing this page does not check you in.</p>
    {message && <p role="status">{message}</p>}
  </section>;
}
