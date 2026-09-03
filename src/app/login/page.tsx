import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PublicShell } from "@/components/public/PublicShell";

export default function Page() {
  return (
    <PublicShell>
      <div className="mx-auto grid min-h-[70vh] max-w-md content-center px-4 py-16">
        <span className="cz-chip mx-auto">Player access</span>
        <h1 className="cz-display mt-4 text-center text-3xl font-bold">Enter the Player Hub</h1>
        <p className="mt-2 text-center text-sm text-[var(--cz-text-secondary)]">CircZles uses your Wix member identity — one account across the whole ecosystem.</p>

        <div className="cz-surface mt-6 grid gap-4 p-5">
          <Link href="/hub" className="cz-btn cz-btn-primary w-full" data-testid="wix-continue">Continue with CircZles Account<ArrowRight size={16} /></Link>
          <p className="text-center text-xs text-[var(--cz-text-tertiary)]">Uses the approved Wix member authentication handoff. If you already have a valid CircZles session, you continue straight to your hub.</p>

          <div className="flex items-center gap-3 text-xs text-[var(--cz-text-tertiary)]"><span className="h-px flex-1 bg-[var(--cz-hairline)]" />or continue with email<span className="h-px flex-1 bg-[var(--cz-hairline)]" /></div>

          <label className="grid gap-1 text-sm"><span className="text-[var(--cz-text-secondary)]">Email</span>
            <input type="email" aria-label="Email" placeholder="player@example.com" className="min-h-11 rounded-xl border border-[var(--cz-hairline-strong)] bg-[var(--cz-inset)] px-3.5 text-sm outline-none focus:border-[var(--cz-aqua)]" /></label>
          <label className="grid gap-1 text-sm"><span className="text-[var(--cz-text-secondary)]">Password</span>
            <input type="password" aria-label="Password" placeholder="••••••••" className="min-h-11 rounded-xl border border-[var(--cz-hairline-strong)] bg-[var(--cz-inset)] px-3.5 text-sm outline-none focus:border-[var(--cz-aqua)]" /></label>
          <Link href="/hub" className="cz-btn cz-btn-ghost w-full">Log In</Link>
        </div>
        <p className="mt-4 text-center text-sm text-[var(--cz-text-tertiary)]">New to CircZles? <Link href="/signup" className="text-[var(--cz-aqua)]">Create a profile</Link></p>
      </div>
    </PublicShell>
  );
}
